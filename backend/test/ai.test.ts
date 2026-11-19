import { mkdirSync, writeFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GATE_DEMO } from '../src/db/seed-gate.js';
import { noAi, type Ai } from '../src/lib/ai.js';
import { periodIn } from '../src/lib/copilot.js';
import { coverage, ruleFinding } from '../src/lib/inspections.js';
import { categoryOf, priorityOf } from '../src/lib/triage.js';
import { testApp } from './helpers.js';

type Call = 'GET' | 'POST' | 'PUT' | 'DELETE';
type T = Awaited<ReturnType<typeof testApp>>;
const day = (offset: number) => new Date(Date.now() + 5.5 * 3600e3 + offset * 864e5).toISOString().slice(0, 10);
const P = 'http://api.test/files/';

describe('reading a complaint, by rule', () => {
  it('finds the trade and the urgency in plain words', () => {
    expect([categoryOf('No water in kitchen'), priorityOf('No water in kitchen')]).toEqual(['Plumbing', 'High']);
    expect([categoryOf('Sparks from the switch board'), priorityOf('Sparks from the switch board')]).toEqual(['Electrical', 'Emergency']);
    expect([categoryOf('Lift maintenance'), priorityOf('Lift maintenance')]).toEqual(['Lifts', 'Medium']);
    expect([categoryOf('Touch-up paint on the door'), priorityOf('Touch-up paint on the door')]).toEqual(['General maintenance', 'Low']);
  });
  it('knows which month a question means', () => {
    expect(periodIn('Show June collection', '2026-11-17')).toBe('2026-06');
    expect(periodIn('December collection', '2026-11-17')).toBe('2025-12'); // the most recent December
    expect(periodIn('collection last month', '2026-01-05')).toBe('2025-12');
    expect(periodIn('what may be pending', '2026-11-17')).toBe('2026-11');
  });
});

describe('the staff assistant', () => {
  let t: T;
  let admin = '', auditor = '', guard = '';
  let flats: Record<string, string> = {};
  const A = (m: Call, path: string, body?: unknown, token = admin) => t.call(m, `/v1/admin/${t.associationId}${path}`, { token, body });
  const ask = async (text: string, token = admin) => (await A('POST', '/assistant/ask', { text }, token)).body;

  beforeAll(async () => {
    t = await testApp();
    admin = (await t.staffIn()).accessToken;
    guard = (await t.signIn(GATE_DEMO.guardPhone)).accessToken;
    await A('POST', '/finance/auditors', { name: 'Kavitha & Co', email: 'audit@kavitha.example', password: 'Audit@2026' });
    auditor = (await t.staffIn('audit@kavitha.example', 'Audit@2026')).accessToken;
    for (const u of (await A('GET', '/finance/units')).body) flats[u.code] = u.id;
    // the scene: one overdue bill, one paid bill, one emergency
    await A('POST', '/finance/bills', { unitId: flats['T1-1503'], chargeType: 'Water', amount: 800, dueDate: day(-5) });
    const paid = (await A('POST', '/finance/bills', { unitId: flats['T2-0704'], chargeType: 'Monthly maintenance', amount: 4500, dueDate: day(5) })).body;
    await A('POST', '/finance/payments', { unitId: flats['T2-0704'], amount: 4500, mode: 'UPI', reference: 'UPI123', billIds: [paid.id] });
    await A('POST', '/issues', { title: 'Sparks from the meter room panel', category: 'Electrical', location: 'Meter room', priority: 'Emergency', scope: 'common' });
  });
  afterAll(async () => { await t?.close(); });

  it('answers questions from the records, with the table behind the answer', async () => {
    const dues = await ask('Show pending dues');
    expect(dues.text).toBe('₹800 is owed by 1 flat.');
    expect(dues.cards[0]).toMatchObject({ title: 'Pending dues', columns: ['Flat', 'Resident', 'Owes'], rows: [['T1-1503', 'Arjun Mehta', '₹800']], link: '/accounts' });
    expect((await ask('Total maintenance collected this month?')).text).toContain('₹4,500 collected');
    const em = await ask('Show emergency complaints');
    expect(em.text).toBe('1 emergency complaint open.');
    expect(em.cards).toHaveLength(1); // the specific question is not also answered with "everything pending"
    expect(em.cards[0].rows[0]).toEqual(expect.arrayContaining(['Sparks from the meter room panel', 'Emergency']));
    expect((await ask('Which complaints are pending?')).cards[0].rows.length).toBe(2);
    expect((await ask('Which vendor is overloaded?')).text).toContain('FixIt Electricals has the most open work: 1 job');
    expect((await ask('Find flat 1108')).text).toContain('Ananya Iyer (Owner)');
    expect((await ask('Poll results')).cards[0].rows[0]).toEqual(expect.arrayContaining(['Approve CCTV upgrade in the play area? (₹1.4L from corpus)']));
    expect((await ask('AGM attendance')).text).toContain('Annual General Meeting');
    const none = await ask('What is the meaning of life?');
    expect(none.text).toContain('couldn’t match that');
    expect(none.chips.length).toBeGreaterThan(2);
  });

  it('shows each role only its own part of the society', async () => {
    const about = (await A('GET', '/assistant/about', undefined, auditor)).body;
    expect(about).toMatchObject({ role: 'Auditor', sees: ['money and accounts'], canAct: false });
    expect((await ask('Show pending dues', auditor)).cards[0].rows).toHaveLength(1);
    const no = await ask('Visitors entered today', auditor);
    expect(no).toMatchObject({ refused: true, cards: [] });
    expect(no.text).toContain('money and accounts only');
    // the guard sees the gate, and nothing about money
    expect((await ask('Visitors entered today', guard)).cards[0].title).toBe('Gate entries today');
    expect((await ask('Show pending dues', guard)).refused).toBe(true);
    // a question that reaches into two areas is answered for the one the role may see, and says what was left out
    const mixed = await ask('Show pending dues and visitors today', auditor);
    expect(mixed.cards.map((c: { key: string }) => c.key)).toEqual(['dues']);
    expect(mixed.text).toContain('left out visitors and the gate');
    // and nobody who only reads can make it do things
    expect((await ask('Send payment reminders to all pending residents', auditor)).refused).toBe(true);
  });

  it('proposes an action and does it only on a yes', async () => {
    const p = await ask('Send payment reminders to all pending residents');
    expect(p.action).toMatchObject({ kind: 'send_reminders', flats: 1, amount: 800 });
    expect(t.messenger.sent).toHaveLength(0); // nothing has gone out yet
    // only the person it was offered to may confirm it — and not a role that cannot send
    expect((await A('POST', `/assistant/actions/${p.id}/confirm`, undefined, auditor)).status).toBe(403);
    const done = (await A('POST', `/assistant/actions/${p.id}/confirm`)).body;
    expect(done).toMatchObject({ status: 'done', link: '/communication' });
    expect(done.outcome).toContain('1 resident in 1 flat');
    expect(t.messenger.sent.some(m => m.channel === 'whatsapp' || m.channel === 'sms')).toBe(false); // reminders go as app alerts now
    expect((await A('POST', `/assistant/actions/${p.id}/confirm`)).body.error.code).toBe('already_decided');

    const w = await ask('Create work order for lift maintenance');
    expect(w.action).toMatchObject({ kind: 'create_work_order', title: 'Lift maintenance', category: 'Lifts', priority: 'Medium', asset: 'Lift', vendor: 'OTIS AMC' });
    const made = (await A('POST', `/assistant/actions/${w.id}/confirm`)).body;
    expect(made.outcome).toMatch(/^Work order ISS-\d+ raised and assigned to OTIS AMC/);
    const iss = (await A('GET', `/issues/${/ISS-\d+/.exec(made.outcome)![0]}`)).body;
    expect(iss).toMatchObject({ status: 'Assigned', vendor: 'OTIS AMC', scope: 'common', asset: 'Lift' });

    // an action that is turned down does nothing, and is on record as turned down
    const c = await ask('Create work order for pump room cleaning');
    expect((await A('POST', `/assistant/actions/${c.id}/cancel`)).body.status).toBe('cancelled');
    expect((await A('GET', '/issues')).body.some((x: { title: string }) => /pump room/i.test(x.title))).toBe(false);
    expect((await ask('Create work order')).text).toContain('What is the work order for?');
  });

  it('drafts messages without sending them, and reads complaints', async () => {
    const d = await ask('Draft a water shutdown notice for Tower 4 tomorrow 10am to 2pm');
    expect(d.draft).toMatchObject({ kind: 'Water shutdown notice', title: 'Water supply interruption', by: 'rules' });
    expect(d.link).toBe('/communication');
    const f = (await A('POST', '/assistant/draft', { kind: 'Festival greetings', details: 'Diwali' })).body;
    expect(f.body).toContain('very happy Diwali');
    expect(f.body).toContain('Prestige Lakeside Habitat');
    expect((await A('POST', '/assistant/draft', { kind: 'Meeting invitation' })).body.body).toContain('[date]'); // what it does not know, it leaves for the office
    const tr = (await A('POST', '/assistant/triage', { text: 'No water in kitchen since morning' })).body;
    expect(tr).toMatchObject({ category: 'Plumbing', priority: 'High', slaHours: 24, vendor: { name: 'Sunrise Plumbing Co.' }, by: 'rules' });
    const s = (await A('GET', '/issues/ISS-1043/suggestion')).body;
    expect(s).toMatchObject({ category: 'Electrical', vendor: { name: 'FixIt Electricals' }, differs: false });
  });

  it('the assistant writes the monthly report from the books, and the search finds records', async () => {
    const report = await ask('Generate monthly report');
    expect(report.text).toContain('₹4,500 collected');
    expect(report).toMatchObject({ by: 'rules', link: '/accounts' });

    // three plumbing complaints for the same flat, and a bill 40 days late
    const rohit = (await t.signIn('9900112233')).accessToken;
    for (const title of ['Kitchen tap leaking', 'Bathroom tap leaking again', 'Leak under the sink']) await t.call('POST', '/v1/issues', { token: rohit, body: { title, category: 'Plumbing', location: 'My flat', priority: 'Medium', via: 'form' } });
    await A('POST', '/finance/bills', { unitId: flats['T5-0110'], chargeType: 'Monthly maintenance', amount: 4000, dueDate: day(-40), period: day(-40).slice(0, 7) });
    expect((await ask('Show residents with more than two complaints')).cards[0].rows[0]).toEqual(['Rohit Sharma', 'T2-0704', '3']);

    const hits = (await A('GET', '/search?q=1108')).body as { kind: string; label: string; sub: string }[];
    expect(hits.find(h => h.kind === 'Flat')).toMatchObject({ label: 'T4-1108', sub: 'Ananya Iyer, Karthik Iyer' });
    expect(((await A('GET', '/search?q=plumb')).body as { kind: string; label: string }[]).map(h => h.label)).toEqual(expect.arrayContaining(['Sunrise Plumbing Co.']));
    expect(((await A('GET', '/search?q=unpaid')).body as { kind: string; label: string }[])[0]).toMatchObject({ kind: 'Page', label: 'Accounts' });
    // the auditor's search never reaches flats or vendors
    expect(((await A('GET', '/search?q=1108', undefined, auditor)).body as { kind: string }[]).filter(h => h.kind === 'Flat')).toEqual([]);
  });

  it('keeps a record of everything it was asked and did', async () => {
    const log = (await A('GET', '/ai-audit')).body as { user: string; role: string; prompt: string; status: string; dataAccessed: string[]; approvalRequired: boolean; outcome: string; action: string | null }[];
    expect(log.find(l => l.prompt === 'Show pending dues' && l.role === 'Society admin')).toMatchObject({ user: 'Sanjana Rao', status: 'answered', dataAccessed: ['dues'], approvalRequired: false });
    expect(log.find(l => l.prompt === 'Visitors entered today' && l.role === 'Auditor')!.status).toBe('refused');
    const acts = (await A('GET', '/ai-audit?only=actions')).body as typeof log;
    expect(acts.every(l => l.approvalRequired)).toBe(true);
    expect(acts.find(l => l.action === 'send_reminders' && l.role === 'Society admin')).toMatchObject({ status: 'done' });
    expect(acts.find(l => l.action === 'create_work_order' && l.status === 'cancelled')).toBeTruthy();
    expect((await A('GET', '/ai-audit', undefined, auditor)).status).toBe(403);
  });

  it('answers a resident about their own account, and passes on what it cannot answer', async () => {
    const arjun = (await t.signIn('9900778899')).accessToken, rohit = (await t.signIn('9900112233')).accessToken;
    const chat = async (text: string, token: string) => (await t.call('POST', '/v1/assistant/chat', { token, body: { text } })).body;
    const due = await chat('When is my maintenance due?', arjun);
    expect(due.text).toContain('Your flat T1-1503 owes ₹800');
    expect(due.link).toEqual({ label: 'Open Dues', href: '/dues' });
    const rc = await chat('Download my receipt', rohit);
    expect(rc.text).toContain('₹4,500 paid by UPI');
    expect(rc.link.href).toMatch(/^\/dues\/receipt\/[0-9a-f-]{36}$/);
    expect((await chat('Download my receipt', arjun)).text).toContain('there is no receipt');
    // a handbook question is still answered from the handbook
    expect((await chat('Where do visitors park?', arjun)).text).toContain('Basement 2');
    const lost = await chat('I forgot my parking slot number', arjun);
    expect(lost.offer).toBe('ask_office');
    const sent = await t.call('POST', '/v1/assistant/ask-office', { token: arjun, body: { text: 'I forgot my parking slot number' } });
    expect(sent.status).toBe(201);
    const inbox = (await A('GET', '/conversations')).body;
    expect(inbox[0]).toMatchObject({ resident: 'Arjun Mehta', unit: 'T1-1503', subject: 'I forgot my parking slot number' });
    expect(((await A('GET', '/ai-audit?only=actions')).body as { action: string; role: string }[])[0]).toMatchObject({ action: 'ask_office', role: 'Resident' });
  });
});

describe('inspections', () => {
  let t: T;
  let admin = '', ananya = '', karthik = '', rohit = '';
  let flat = '';
  const A = (m: Call, path: string, body?: unknown, token = admin) => t.call(m, `/v1/admin/${t.associationId}${path}`, { token, body });
  type Sec = { name: string; items: { id: string; item: string; photoRequired: boolean; condition: string | null; finding: string; severity: string | null; recommendation: string | null; category: string | null; workOrder: { ref: string; status: string; approval?: string } | null }[] };
  const items = (r: { sections: Sec[] }) => r.sections.flatMap(s => s.items.map(i => ({ ...i, section: s.name })));
  const item = (r: { sections: Sec[] }, section: string, name: string) => items(r).find(i => i.section === section && i.item === name)!;
  /** walk the whole checklist: everything Good with a photo where one is required, except what `bad` says */
  const walk = async (id: string, bad: Record<string, { condition: string; note?: string; photos?: string[] }> = {}) => {
    let r = (await A('GET', `/inspections/${id}`)).body;
    for (const i of items(r)) {
      const b = bad[`${i.section}|${i.item}`];
      r = (await A('PUT', `/inspections/${id}/items/${i.id}`, b ?? { condition: 'Good', photos: i.photoRequired ? [P + 'ok.jpg'] : [] })).body;
    }
    return r;
  };

  beforeAll(async () => {
    t = await testApp();
    admin = (await t.staffIn()).accessToken;
    ananya = (await t.signIn()).accessToken;
    karthik = (await t.signIn('9845012345')).accessToken;
    rohit = (await t.signIn('9900112233')).accessToken;
    flat = ((await A('GET', '/finance/units')).body as { code: string; id: string }[]).find(u => u.code === 'T4-1108')!.id;
  });
  afterAll(async () => { await t?.close(); });

  it('knows what is missing and what a rating means, by rule', () => {
    const base = { section: 'Bathroom', item: 'Sink & taps', photoRequired: true, photos: [] as string[] };
    expect(coverage([{ ...base, condition: null }])).toEqual(['Bathroom · Sink & taps: not rated']);
    expect(coverage([{ ...base, condition: 'Good' }])).toEqual(['Bathroom · Sink & taps: photo missing']);
    expect(coverage([{ ...base, condition: 'Missing' }])).toEqual([]); // nothing there to photograph
    expect(coverage([{ ...base, photoRequired: false, condition: 'Damaged' }])[0]).toContain('add a photo as evidence');
    expect(ruleFinding({ section: 'Bathroom', item: 'Sink & taps', condition: 'Poor', note: 'Tap leaking' })).toMatchObject({ severity: 'Medium', recommendation: 'Repair', category: 'Plumbing' });
    expect(ruleFinding({ section: 'Living room', item: 'Electrical points', condition: 'Damaged', note: 'socket burnt' })).toMatchObject({ severity: 'Critical', recommendation: 'Replace', category: 'Electrical' });
    expect(ruleFinding({ section: 'Bedroom', item: 'Walls', condition: 'Good', note: '' })).toBeNull();
  });

  it('offers checklists and lets a society add its own', async () => {
    const o = (await A('GET', '/inspections/options')).body;
    expect(o.templates.map((x: { key: string }) => x.key)).toEqual(['flat', 'common', 'fire']);
    expect(o.types).toContain('Move-out');
    expect(o.conditions).toEqual(['Good', 'Fair', 'Poor', 'Damaged', 'Missing']);
    const mine = await A('POST', '/inspections/templates', { name: 'Pool weekly', scope: 'common', sections: [{ name: 'Pool', items: [{ name: 'Water clarity', photo: true }, { name: 'Life buoy' }] }] });
    expect(mine.status).toBe(201);
    const run = (await A('POST', '/inspections', { type: 'Monthly', template: mine.body.key, place: 'Swimming pool' })).body;
    expect(run).toMatchObject({ ref: 'INS-101', template: 'Pool weekly', where: 'Swimming pool', status: 'In progress', counts: { total: 2, rated: 0 } });
    expect(run.missing).toHaveLength(2);
    // a flat checklist needs a flat; a move-in cannot be done on a common-area checklist
    expect((await A('POST', '/inspections', { type: 'Move-in', template: 'flat' })).body.error.code).toBe('unit_required');
    expect((await A('POST', '/inspections', { type: 'Move-in', template: 'common' })).body.error.code).toBe('wrong_checklist');
  });

  it('move-in: walk through, submit only when complete, and share the report for acknowledgement', async () => {
    const started = (await A('POST', '/inspections', { type: 'Move-in', template: 'flat', unitId: flat })).body;
    expect(started).toMatchObject({ type: 'Move-in', where: 'Tower 4, Flat 1108', unit: 'T4-1108', inspector: 'Sanjana Rao' });
    expect(started.sections.map((s: Sec) => s.name)).toEqual(['Living room', 'Kitchen', 'Bedroom', 'Bathroom', 'Balcony', 'Parking']);
    const early = await A('POST', `/inspections/${started.id}/submit`);
    expect(early.body.error).toMatchObject({ code: 'incomplete' });
    expect(early.body.error.message).toContain('Living room · Walls: not rated');
    // photos must be files this server stored
    expect((await A('PUT', `/inspections/${started.id}/items/${started.sections[0].items[0].id}`, { condition: 'Good', photos: ['https://evil.example/x.jpg'] })).body.error.code).toBe('invalid_file');
    await walk(started.id);
    const done = (await A('POST', `/inspections/${started.id}/submit`)).body;
    expect(done).toMatchObject({ status: 'Submitted', counts: { total: 29, Good: 29, findings: 0 }, summaryBy: 'rules', comparison: null });
    expect(done.summary).toContain('Nothing needs attention');
    // submitted is final
    expect((await A('PUT', `/inspections/${started.id}/items/${started.sections[0].items[0].id}`, { condition: 'Poor' })).body.error.code).toBe('submitted');

    // not shared → the resident cannot see it
    expect((await t.call('GET', '/v1/inspections', { token: ananya })).body).toEqual([]);
    expect((await t.call('GET', `/v1/inspections/${started.id}`, { token: ananya })).status).toBe(404);
    await A('PUT', `/inspections/${started.id}/share`, { owner: true, tenant: false });
    expect((await t.call('GET', '/v1/notifications', { token: ananya })).body[0]).toMatchObject({ title: 'Move-in inspection report', href: '/inspections/' + started.id });
    const seen = (await t.call('GET', `/v1/inspections/${started.id}`, { token: ananya })).body;
    expect(seen).toMatchObject({ ref: 'INS-102', status: 'Submitted', ack: null });
    expect(seen.missing).toBeUndefined();
    // shared with the owner only: a family member of the same flat and a neighbour see nothing
    expect((await t.call('GET', '/v1/inspections', { token: karthik })).body).toEqual([]);
    expect((await t.call('GET', `/v1/inspections/${started.id}`, { token: rohit })).status).toBe(404);
    const ack = (await t.call('POST', `/v1/inspections/${started.id}/ack`, { token: ananya, body: { note: 'Agreed, all in order.' } })).body;
    expect(ack.ack).toMatchObject({ name: 'Ananya Iyer', role: 'Owner', note: 'Agreed, all in order.' });
    expect((await t.call('POST', `/v1/inspections/${started.id}/ack`, { token: ananya, body: {} })).body.error.code).toBe('already_acknowledged');
  });

  it('move-out: findings, the comparison with move-in, and work orders in bulk', async () => {
    const out = (await A('POST', '/inspections', { type: 'Move-out', template: 'flat', unitId: flat })).body;
    await walk(out.id, {
      'Bathroom|Sink & taps': { condition: 'Poor', note: 'Tap leaking at the base', photos: [P + 'tap1.jpg', P + 'tap2.jpg'] },
      'Living room|Electrical points': { condition: 'Damaged', note: 'socket burnt near the TV unit', photos: [P + 'socket.jpg'] },
      'Bedroom|Wardrobe': { condition: 'Fair', note: 'Hinge slightly loose' },
      'Balcony|Railing': { condition: 'Missing' },
    });
    // findings can be previewed before submitting
    const pre = (await A('POST', `/inspections/${out.id}/analyse`)).body;
    expect(item(pre, 'Bathroom', 'Sink & taps')).toMatchObject({ severity: 'Medium', recommendation: 'Repair', category: 'Plumbing', findingBy: 'rules' });
    const done = (await A('POST', `/inspections/${out.id}/submit`)).body;
    expect(done.counts).toMatchObject({ Good: 25, Fair: 1, Poor: 1, Damaged: 1, Missing: 1, findings: 4, critical: 2 });
    expect(done.summary).toContain('4 findings');
    expect(done.summary).toContain('Living room · Electrical points (Critical, replace)');
    expect(item(done, 'Balcony', 'Railing')).toMatchObject({ severity: 'Critical', recommendation: 'Replace' });
    expect(done.comparison).toMatchObject({ ref: 'INS-102', worse: 4, better: 0 });
    expect(done.comparison.changes.find((c: { item: string }) => c.item === 'Sink & taps')).toMatchObject({ before: 'Good', after: 'Poor', worse: true, afterPhoto: P + 'tap1.jpg' });

    // two findings become two work orders; the costly one waits for the committee
    const tap = item(done, 'Bathroom', 'Sink & taps'), socket = item(done, 'Living room', 'Electrical points'), wall = item(done, 'Living room', 'Walls');
    const made = (await A('POST', `/inspections/${out.id}/work-orders`, { items: [{ id: tap.id }, { id: socket.id, estimate: 9000 }, { id: wall.id }] })).body;
    expect(made.created).toHaveLength(2); // the wall was Good: nothing to fix
    const tapOrder = item(made.inspection, 'Bathroom', 'Sink & taps').workOrder!, socketOrder = item(made.inspection, 'Living room', 'Electrical points').workOrder!;
    expect(tapOrder).toMatchObject({ status: 'Submitted', approval: 'none' });
    expect(socketOrder).toMatchObject({ approval: 'pending' });
    const iss = (await A('GET', `/issues/${tapOrder.ref}`)).body;
    expect(iss).toMatchObject({ title: 'Sink & taps — Bathroom', category: 'Plumbing', priority: 'Medium', unit: 'T4-1108', location: 'Tower 4, Flat 1108' });
    expect(iss.updates.map((u: { photoUrl: string }) => u.photoUrl)).toEqual([P + 'tap1.jpg', P + 'tap2.jpg']); // the evidence travels with the job
    expect(iss.updates[0].text).toContain('From inspection INS-103 (Move-out), rated Poor');
    expect((await A('GET', `/issues/${socketOrder.ref}`)).body).toMatchObject({ priority: 'Emergency', costEstimate: 9000 });
    // asking twice raises nothing twice
    expect((await A('POST', `/inspections/${out.id}/work-orders`, { items: [{ id: tap.id }] })).body.created).toEqual([]);
    // progress on the job shows in the report — for the resident too, once shared (without the money)
    await A('POST', `/issues/${tapOrder.ref}/status`, { to: 'Acknowledged' });
    await A('PUT', `/inspections/${out.id}/share`, { owner: true, tenant: true });
    const mine = (await t.call('GET', `/v1/inspections/${out.id}`, { token: karthik })).body;
    expect(item(mine, 'Bathroom', 'Sink & taps').workOrder).toEqual({ ref: tapOrder.ref, status: 'Acknowledged', vendor: null });
    expect(mine.comparison.worse).toBe(4);

    const list = (await A('GET', '/inspections')).body as { ref: string; counts: { findings: number; workOrders: number } }[];
    expect(list.find(l => l.ref === 'INS-103')!.counts).toMatchObject({ findings: 4, workOrders: 2 });
    const csv = await t.app.inject({ method: 'GET', url: `/v1/admin/${t.associationId}/inspections/${out.id}/report.csv`, headers: { authorization: 'Bearer ' + admin } });
    expect(csv.body).toContain('"Bathroom","Sink & taps","Poor","Tap leaking at the base"');
    expect(csv.body).toContain(tapOrder.ref);
  });
});

describe('with a model connected', () => {
  it('looks at the photos, writes the summary, and words the answers — within the same rules', async () => {
    const looked: { user: string; images: number }[] = [];
    const fake: Ai = {
      ...noAi, enabled: true,
      compose: async system => (system.includes('inspection report') ? 'The flat is in fair shape; the bathroom tap needs a plumber first.' : system.includes('monthly report') ? 'A quiet month.' : 'Model answer.'),
      extract: async o => {
        if (o.name === 'finding') {
          looked.push({ user: o.user, images: o.images?.length ?? 0 });
          return (o.user.includes('Sink & taps')
            ? { finding: 'Water stains and a slow drip are visible at the base of the tap.', condition: 'Poor', severity: 'High', recommendation: 'Repair', category: 'Plumbing', damage: true }
            : { finding: 'Hairline crack with a damp patch near the skirting.', condition: 'Poor', severity: 'Medium', recommendation: 'Repair', category: 'General maintenance', damage: true }) as never;
        }
        if (o.name === 'triage') return { category: 'Plumbing', priority: 'High', title: 'No water in the kitchen', reason: 'A home without water.' } as never;
        if (o.name === 'pick') return { tools: ['dues', 'visitors', 'nonsense'] } as never;
        if (o.name === 'draft') return { title: 'Diwali wishes', body: 'Happy Diwali from all of us.' } as never;
        return null;
      },
    };
    const t = await testApp({ ai: fake });
    try {
      const admin = (await t.staffIn()).accessToken;
      const A = (m: Call, path: string, body?: unknown, token = admin) => t.call(m, `/v1/admin/${t.associationId}${path}`, { token, body });
      mkdirSync('uploads-test', { recursive: true });
      for (const f of ['tap.jpg', 'wall.jpg']) writeFileSync('uploads-test/' + f, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));

      const mine = (await A('POST', '/inspections/templates', { name: 'Quick bathroom', scope: 'unit', sections: [{ name: 'Bathroom', items: [{ name: 'Sink & taps', photo: true }, { name: 'Walls & tiles', photo: true }, { name: 'Door' }] }] })).body;
      const flat = ((await A('GET', '/finance/units')).body as { code: string; id: string }[])[0]!.id;
      const ins = (await A('POST', '/inspections', { type: 'Monthly', template: mine.key, unitId: flat })).body;
      const [tap, wall, door] = ins.sections[0].items as { id: string }[];
      await A('PUT', `/inspections/${ins.id}/items/${tap!.id}`, { condition: 'Fair', note: 'drips', photos: [P + 'tap.jpg'] });
      await A('PUT', `/inspections/${ins.id}/items/${wall!.id}`, { condition: 'Good', photos: [P + 'wall.jpg'] });
      await A('PUT', `/inspections/${ins.id}/items/${door!.id}`, { condition: 'Good' });
      const done = (await A('POST', `/inspections/${ins.id}/submit`)).body;
      expect(looked).toHaveLength(2); // only items with photos are shown to the model
      expect(looked.every(l => l.images === 1)).toBe(true);
      const [t1, w1, d1] = done.sections[0].items;
      expect(t1).toMatchObject({ condition: 'Fair', finding: 'Water stains and a slow drip are visible at the base of the tap.', severity: 'High', findingBy: 'ai' }); // the inspector's rating stands
      expect(w1).toMatchObject({ condition: 'Good', recommendation: 'Monitor', findingBy: 'ai' });
      expect(w1.finding).toMatch(/^Possible issue, rated Good by the inspector: Hairline crack/);
      expect(d1).toMatchObject({ finding: '', severity: null });
      expect(done).toMatchObject({ summary: 'The flat is in fair shape; the bathroom tap needs a plumber first.', summaryBy: 'ai' });

      // free wording: the model chooses look-ups, but only from the ones this role has — and invented ones are dropped
      await A('POST', '/finance/auditors', { name: 'Kavitha & Co', email: 'audit@kavitha.example', password: 'Audit@2026' });
      const auditor = (await t.staffIn('audit@kavitha.example', 'Audit@2026')).accessToken;
      const free = (await A('POST', '/assistant/ask', { text: 'Anything I should chase up?' }, auditor)).body;
      expect(free.cards.map((c: { key: string }) => c.key)).toEqual(['dues']);
      expect(free).toMatchObject({ text: 'Model answer.', by: 'ai' });
      expect((await A('POST', '/assistant/triage', { text: 'paani nahi aa raha kitchen mein' })).body).toMatchObject({ title: 'No water in the kitchen', category: 'Plumbing', priority: 'High', by: 'ai' });
      expect((await A('POST', '/assistant/draft', { kind: 'Festival greetings', details: 'Diwali' })).body).toEqual({ title: 'Diwali wishes', body: 'Happy Diwali from all of us.', by: 'ai' });
      expect(await (async () => (await A('POST', '/assistant/ask', { text: 'Generate monthly report' })).body)()).toMatchObject({ text: 'A quiet month.', by: 'ai' });
    } finally { await t.close(); }
  });
});
