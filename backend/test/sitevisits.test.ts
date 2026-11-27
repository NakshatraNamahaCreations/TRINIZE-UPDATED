import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO } from '../src/db/seed.js';
import { todayIst } from '../src/routes/sitevisits.js';
import { testApp } from './helpers.js';

let t: Awaited<ReturnType<typeof testApp>>;
let admin: string, vpm: string, resident: string, neighbour: string;
beforeAll(async () => {
  t = await testApp();
  admin = (await t.staffIn()).accessToken;
  vpm = (await t.signIn(DEMO.vpmPhone)).accessToken;
  resident = (await t.signIn(DEMO.residentPhone)).accessToken;
  neighbour = (await t.signIn('9900112233')).accessToken; // Rohit Sharma, another flat
});
afterAll(() => t.close());

const A = () => `/v1/admin/${t.associationId}/site-visits`;
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
const tomorrow = () => addDays(todayIst(), 1);
const weekdayOf = (d: string) => new Date(d + 'T00:00:00Z').getUTCDay();
const raise = async (token: string, title: string) => {
  const r = await t.call('POST', '/v1/issues', { token, body: { title, category: 'Plumbing', location: 'Kitchen', priority: 'Medium', via: 'form' } });
  expect(r.status).toBe(201);
  return (r.body.ref ?? r.body.id) as string;
};

describe('the property manager, as residents see them', () => {
  it('shows the assigned manager, and no visit until a regular slot is set', async () => {
    const me = (await t.call('GET', '/v1/manager', { token: resident })).body;
    expect(me.manager).toMatchObject({ name: 'Imran Qureshi', title: 'Property Manager' });
    expect(me.plan).toBeNull();
    expect(me.next).toBeNull();
    const r = await t.call('POST', '/v1/manager/requests', { token: resident, body: { note: 'Seepage on the balcony wall' } });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('no_visit');
  });

  it('lets the manager set the weekly slot, and residents then see the next visits on that day', async () => {
    const weekday = weekdayOf(tomorrow());
    expect((await t.call('PUT', `${A()}/plan`, { token: vpm, body: { weekday, start: '12:00', end: '09:00' } })).status).toBe(400);
    expect((await t.call('PUT', `${A()}/plan`, { token: vpm, body: { weekday, start: '09:00', end: '12:00' } })).status).toBe(200);
    const me = (await t.call('GET', '/v1/manager', { token: resident })).body;
    expect(me.plan).toEqual({ weekday, start: '09:00', end: '12:00' });
    expect(me.next).toMatchObject({ date: tomorrow(), start: '09:00', end: '12:00' });
    expect(me.visits.length).toBe(4);
    expect(me.visits.every((v: { date: string }) => weekdayOf(v.date) === weekday)).toBe(true);
  });
});

describe('asking for something on the visit', () => {
  let ref = '', requestId = '';
  it('adds a resident’s own request to the next visit and tells the office', async () => {
    ref = await raise(resident, 'Low water pressure in the kitchen');
    const r = await t.call('POST', '/v1/manager/requests', { token: resident, body: { issueRef: ref, note: 'Mornings are worst' } });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'Requested', kind: 'Request', date: tomorrow(), title: 'Low water pressure in the kitchen' });
    requestId = r.body.id;
    // the same request twice is refused
    expect((await t.call('POST', '/v1/manager/requests', { token: resident, body: { issueRef: ref } })).body.error.code).toBe('already_on_visit');
    const told = (await t.call('GET', '/v1/notifications', { token: vpm })).body;
    expect(told.some((n: { title: string }) => n.title.includes('added a request for the on-site visit'))).toBe(true);
  });

  it('won’t let a resident put someone else’s request on the visit', async () => {
    const r = await t.call('POST', '/v1/manager/requests', { token: neighbour, body: { issueRef: ref } });
    expect(r.status).toBe(404);
  });

  it('lets the manager schedule it, and keeps it private to the flat that asked', async () => {
    const office = (await t.call('GET', A(), { token: vpm })).body;
    expect(office.requests.map((i: { id: string }) => i.id)).toContain(requestId);
    expect(office.requests[0].resident).toMatchObject({ name: 'Ananya Iyer', unit: 'T4-1108' });

    const s = await t.call('PUT', `${A()}/items/${requestId}`, { token: vpm, body: { status: 'Scheduled', time: '10:15', reply: 'I’ll check the pump first' } });
    expect(s.body).toMatchObject({ status: 'Scheduled', time: '10:15', date: tomorrow() });
    // a common-area item the manager plans is shown to everyone
    expect((await t.call('POST', `${A()}/items`, { token: vpm, body: { date: tomorrow(), time: '09:00', title: 'Tower 1 water pressure check', kind: 'Inspection', location: 'Tower 1' } })).status).toBe(201);

    const mine = (await t.call('GET', '/v1/manager', { token: resident })).body;
    const day = mine.visits.find((v: { date: string }) => v.date === tomorrow());
    expect(day.items.map((i: { title: string }) => i.title)).toEqual(['Tower 1 water pressure check', 'Low water pressure in the kitchen']);
    expect(day.items[1]).toMatchObject({ mine: true, ref, time: '10:15' });
    expect(mine.requests[0]).toMatchObject({ status: 'Scheduled', reply: 'I’ll check the pump first' });

    const theirs = (await t.call('GET', '/v1/manager', { token: neighbour })).body;
    const same = theirs.visits.find((v: { date: string }) => v.date === tomorrow());
    expect(same.items.map((i: { title: string }) => i.title)).toEqual(['Tower 1 water pressure check']);
    expect(same.others).toBe(1);
    expect(theirs.requests).toEqual([]);
  });

  it('takes a request for a visit outside the schedule, which needs a day before it can be scheduled', async () => {
    const r = await t.call('POST', '/v1/manager/requests', { token: neighbour, body: { note: 'Need someone to see the terrace leak before the rains', extra: true } });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ extra: true, date: null, status: 'Requested' });
    expect((await t.call('PUT', `${A()}/items/${r.body.id}`, { token: vpm, body: { status: 'Scheduled' } })).body.error.code).toBe('date_required');
    const d = addDays(todayIst(), 3);
    expect((await t.call('PUT', `${A()}/items/${r.body.id}`, { token: vpm, body: { status: 'Scheduled', date: d, time: '17:00' } })).body).toMatchObject({ date: d, status: 'Scheduled' });
    // the extra day now shows up for residents too
    expect((await t.call('GET', '/v1/manager', { token: neighbour })).body.visits.some((v: { date: string }) => v.date === d)).toBe(true);
  });

  it('on cancelling a visit, puts residents’ requests back on the list, tells them, and accepts nothing new for that day', async () => {
    const r = await t.call('PUT', `${A()}/days/${tomorrow()}`, { token: vpm, body: { status: 'Cancelled', note: 'Unwell' } });
    expect(r.body.status).toBe('Cancelled');
    const told = (await t.call('GET', '/v1/notifications', { token: resident })).body;
    expect(told.some((n: { title: string }) => n.title.includes('is cancelled'))).toBe(true);

    const me = (await t.call('GET', '/v1/manager', { token: resident })).body;
    expect(me.next.date).not.toBe(tomorrow()); // the extra visit added above, three days out, is next now
    expect(me.requests[0]).toMatchObject({ id: requestId, status: 'Requested', date: null, time: null });
    // the manager's own items stay on the cancelled day; the request is waiting again
    const office = (await t.call('GET', A(), { token: vpm })).body;
    expect(office.requests.map((i: { id: string }) => i.id)).toContain(requestId);

    // nothing can be scheduled or added onto the cancelled day…
    expect((await t.call('PUT', `${A()}/items/${requestId}`, { token: vpm, body: { status: 'Scheduled', date: tomorrow() } })).body.error.code).toBe('visit_cancelled');
    expect((await t.call('POST', `${A()}/items`, { token: vpm, body: { date: tomorrow(), title: 'Lift check', kind: 'Inspection' } })).body.error.code).toBe('visit_cancelled');
    // …but it can go on the next one
    expect((await t.call('PUT', `${A()}/items/${requestId}`, { token: vpm, body: { status: 'Scheduled', date: addDays(tomorrow(), 7) } })).body).toMatchObject({ status: 'Scheduled', date: addDays(tomorrow(), 7) });
    // and a restored day takes new items again
    await t.call('PUT', `${A()}/days/${tomorrow()}`, { token: vpm, body: { status: 'Planned' } });
    expect((await t.call('POST', `${A()}/items`, { token: vpm, body: { date: tomorrow(), title: 'Lift check', kind: 'Inspection' } })).status).toBe(201);
  });

  it('keeps visits to the manager’s own societies', async () => {
    expect((await t.call('GET', `/v1/admin/${t.lakeView}/site-visits`, { token: vpm })).status).toBe(403);
    expect((await t.call('GET', A(), { token: resident })).status).toBe(403);
  });
});

describe('chatting with the property manager', () => {
  it('lets the manager see and answer a resident’s message, and counts what is waiting on their home screen', async () => {
    const started = await t.call('POST', '/v1/conversations', { token: resident, body: { subject: 'Question for Imran Qureshi', text: 'Is the pump being serviced this week?' } });
    expect(started.status).toBe(201);
    const me = (await t.call('GET', '/v1/vpm/me', { token: vpm })).body;
    const here = me.societies.find((s: { id: string }) => s.id === t.associationId);
    expect(here.unread).toBeGreaterThanOrEqual(1);
    expect(typeof here.visitRequests).toBe('number');

    const inbox = (await t.call('GET', `/v1/admin/${t.associationId}/conversations`, { token: vpm })).body;
    expect(inbox.find((c: { id: string }) => c.id === started.body.id)).toMatchObject({ resident: 'Ananya Iyer', unread: 1 });
    const replied = await t.call('POST', `/v1/admin/${t.associationId}/conversations/${started.body.id}/messages`, { token: vpm, body: { text: 'Yes, on Friday morning.' } });
    expect(replied.status).toBe(200);

    const thread = (await t.call('GET', `/v1/conversations/${started.body.id}`, { token: resident })).body;
    expect(thread.messages.at(-1)).toMatchObject({ from: 'staff', by: 'Imran Qureshi', text: 'Yes, on Friday morning.' });
  });
});

describe('operations numbers', () => {
  it('reports resolution time, satisfaction and vendor workload', async () => {
    const r = await t.call('GET', `/v1/admin/${t.associationId}/stats/operations`, { token: admin });
    expect(r.status).toBe(200);
    expect(r.body.satisfaction.dist.map((d: { star: number }) => d.star)).toEqual([5, 4, 3, 2, 1]);
    expect(r.body.buckets).toEqual(expect.objectContaining({ open: expect.any(Number), inProgress: expect.any(Number), pendingVendor: expect.any(Number), resolved: expect.any(Number) }));
    expect(Array.isArray(r.body.vendors)).toBe(true);
  });

  it('counts a request raised and resolved today in the timeline, the week and its category', async () => {
    const stats = async () => (await t.call('GET', `/v1/admin/${t.associationId}/stats/operations`, { token: vpm })).body;
    const before = await stats();
    expect(before.timeline).toHaveLength(7);
    expect(before.timeline.at(-1).date).toBe(todayIst());
    const ref = await raise(resident, 'Bathroom tap leaking');
    for (const to of ['Acknowledged', 'Resolved']) {
      expect((await t.call('POST', `/v1/admin/${t.associationId}/issues/${ref}/status`, { token: vpm, body: { to, note: 'Washer replaced' } })).status).toBe(200);
    }
    const after = await stats();
    expect(after.timeline.at(-1).created).toBe(before.timeline.at(-1).created + 1);
    expect(after.timeline.at(-1).resolved).toBe(before.timeline.at(-1).resolved + 1);
    expect(after.totals.all).toBe(before.totals.all + 1);
    expect(after.totals.week).toBe(before.totals.week + 1);
    const n = (s: { categories: { category: string; n: number }[] }) => s.categories.find(c => c.category === 'Plumbing')?.n ?? 0;
    expect(n(after)).toBe(n(before) + 1);
    expect(after.buckets.resolved).toBe(before.buckets.resolved + 1);
    expect(after.resolution.hours).not.toBeNull();
  });
});

describe('the property manager’s dashboard helpers', () => {
  it('answers the assistant’s dashboard questions from records, even without the AI model', async () => {
    for (const text of ['Which complaints are pending?', 'Which work order is overdue?']) {
      const r = await t.call('POST', `/v1/admin/${t.associationId}/assistant/ask`, { token: vpm, body: { text } });
      expect(r.status).toBe(200);
      expect(r.body.cards.length).toBeGreaterThan(0);
    }
    const d = await t.call('POST', `/v1/admin/${t.associationId}/assistant/draft`, { token: vpm, body: { kind: 'Maintenance notice', details: 'Water tank cleaning on Sunday' } });
    expect(d.status).toBe(200);
    expect(d.body.title.length).toBeGreaterThan(3);
    expect(d.body.body.length).toBeGreaterThan(10);
  });

  it('keeps notes private to the person who wrote them', async () => {
    const N = `/v1/admin/${t.associationId}/my-notes`;
    const made = await t.call('POST', N, { token: vpm, body: { text: 'Follow up with the lift AMC vendor' } });
    expect(made.status).toBe(201);
    expect((await t.call('PUT', `${N}/${made.body.id}`, { token: vpm, body: { done: true } })).body.done).toBe(true);
    expect((await t.call('GET', N, { token: vpm })).body.map((x: { text: string }) => x.text)).toContain('Follow up with the lift AMC vendor');
    // the society admin has their own list and cannot touch the manager's
    expect((await t.call('GET', N, { token: admin })).body).toEqual([]);
    expect((await t.call('PUT', `${N}/${made.body.id}`, { token: admin, body: { done: false } })).status).toBe(404);
    expect((await t.call('DELETE', `${N}/${made.body.id}`, { token: admin })).status).toBe(404);
    expect((await t.call('DELETE', `${N}/${made.body.id}`, { token: vpm })).status).toBe(204);
  });
});

describe('the primary property manager, when a society has several', () => {
  it('shows residents the one the operator picks, and falls back when that one leaves', async () => {
    const op = (await t.staffIn(DEMO.operatorEmail, DEMO.operatorPassword)).accessToken;
    const shown = async () => (await t.call('GET', '/v1/manager', { token: resident })).body.manager?.name;
    expect(await shown()).toBe('Imran Qureshi');
    // Imran has been using the app in these tests, so residents see him online
    await t.call('GET', '/v1/vpm/me', { token: vpm });
    expect((await t.call('GET', '/v1/manager', { token: resident })).body.manager.online).toBe(true);

    // a second manager for the same society: residents still see the longest-standing one
    const made = await t.call('POST', '/v1/ops/vpms', { token: op, body: { name: 'Lalitha Gowda', phone: '9844400004', associationIds: [t.associationId] } });
    expect(made.status).toBe(201);
    expect(made.body.societies[0]).toMatchObject({ id: t.associationId, primary: false, shared: 2 });
    expect(await shown()).toBe('Imran Qureshi');

    // the operator makes her primary
    const list = (await t.call('PUT', `/v1/ops/vpms/${made.body.id}/primary`, { token: op, body: { associationId: t.associationId } })).body;
    const here = (name: string) => list.find((v: { name: string }) => v.name === name).societies.find((s: { id: string }) => s.id === t.associationId);
    expect(here('Lalitha Gowda').primary).toBe(true);
    expect(here('Imran Qureshi').primary).toBe(false);
    expect(await shown()).toBe('Lalitha Gowda');
    // she has never opened the app: nothing is said about being online
    expect((await t.call('GET', '/v1/manager', { token: resident })).body.manager.online).toBe(false);

    // only for a society she manages
    expect((await t.call('PUT', `/v1/ops/vpms/${made.body.id}/primary`, { token: op, body: { associationId: t.lakeView } })).status).toBe(404);
    // and only the operator may choose
    expect((await t.call('PUT', `/v1/ops/vpms/${made.body.id}/primary`, { token: admin, body: { associationId: t.associationId } })).status).toBe(403);

    // moved to another society: residents see Imran again, and the choice doesn't come back if she returns
    await t.call('PUT', `/v1/ops/vpms/${made.body.id}/societies`, { token: op, body: { associationIds: [t.lakeView] } });
    expect(await shown()).toBe('Imran Qureshi');
    await t.call('PUT', `/v1/ops/vpms/${made.body.id}/societies`, { token: op, body: { associationIds: [t.associationId] } });
    expect(await shown()).toBe('Imran Qureshi');
    await t.call('DELETE', `/v1/ops/vpms/${made.body.id}`, { token: op });
  });
});

describe('the visit cycle: check in, the agenda, check out with a report', () => {
  it('records the visit, shows residents the report, and counts the hours on site', async () => {
    const today = todayIst();
    // only on the day itself
    expect((await t.call('POST', `${A()}/days/${addDays(today, 2)}/check-in`, { token: vpm })).body.error.code).toBe('not_today');
    const inn = await t.call('POST', `${A()}/days/${today}/check-in`, { token: vpm });
    expect(inn.status).toBe(200);
    expect(inn.body.checkedInAt).toBeTruthy();
    expect((await t.call('POST', `${A()}/days/${today}/check-in`, { token: vpm })).body.error.code).toBe('already_checked_in');
    // on site now: residents can see it
    const now = (await t.call('GET', '/v1/manager', { token: resident })).body.visits.find((v: { date: string }) => v.date === today);
    expect(now?.onSite).toBe(true);
    // once on site, the day can't be cancelled or closed without a report
    expect((await t.call('PUT', `${A()}/days/${today}`, { token: vpm, body: { status: 'Cancelled' } })).body.error.code).toBe('visit_in_progress');
    // the agenda: one item planned and done
    const item = await t.call('POST', `${A()}/items`, { token: vpm, body: { date: today, time: '09:00', title: 'Pump room check', kind: 'Inspection', location: 'Basement' } });
    expect((await t.call('PUT', `${A()}/items/${item.body.id}`, { token: vpm, body: { status: 'Done' } })).body.status).toBe('Done');
    // leaving needs a report
    expect((await t.call('POST', `${A()}/days/${today}/check-out`, { token: vpm, body: { report: 'ok' } })).status).toBe(400);
    const out = await t.call('POST', `${A()}/days/${today}/check-out`, { token: vpm, body: { report: 'Checked the pump room: pressure valve replaced, water pressure normal again.' } });
    expect(out.status).toBe(200);
    expect(out.body.status).toBe('Done');
    const after = (await t.call('GET', '/v1/manager', { token: resident })).body.visits.find((v: { date: string }) => v.date === today);
    expect(after).toMatchObject({ status: 'Done', onSite: false, report: 'Checked the pump room: pressure valve replaced, water pressure normal again.' });
    // a finished visit with its report is final
    expect((await t.call('PUT', `${A()}/days/${today}`, { token: vpm, body: { status: 'Planned' } })).body.error.code).toBe('visit_finished');
    // the manager's week
    const me = (await t.call('GET', '/v1/vpm/me', { token: vpm })).body;
    expect(me.band).toEqual({ min: 9, max: 12 });
    expect(me.week.visits).toBeGreaterThanOrEqual(1);
    expect(me.week.hours).toBeGreaterThanOrEqual(0);
  });
  it('keeps a visit left open on an earlier day on the board, so it can still be finished, and caps its hours', async () => {
    const past = addDays(todayIst(), -3);
    // checked in three days ago (03:00 to 06:00 IST) and never checked out
    await t.db.execute(sql`insert into site_visits (association_id, date, start, "end", status, checked_in_at) values (${t.associationId}, ${past}, '03:00', '06:00', 'Planned', ${past + 'T03:00:00+05:30'}::timestamptz)`);
    const open = (await t.call('GET', A(), { token: vpm })).body.days.find((d: { date: string }) => d.date === past);
    expect(open).toMatchObject({ checkedInAt: expect.any(String), checkedOutAt: null });
    // the open visit counts at most to its planned end (3 h), not to now
    const me = (await t.call('GET', '/v1/vpm/me', { token: vpm })).body;
    expect(me.week).not.toBeNull();
    expect(me.week.hours).toBeLessThan(24);
    const out = await t.call('POST', `${A()}/days/${past}/check-out`, { token: vpm, body: { report: 'Forgot to check out; the work on the day is in the agenda.' } });
    expect(out.status).toBe(200);
    expect((await t.call('GET', A(), { token: vpm })).body.days.some((d: { date: string }) => d.date === past)).toBe(false);
  });
});
