import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { issues } from '../src/db/schema.js';
import { DEMO } from '../src/db/seed.js';
import { sweep } from '../src/lib/maintenance.js';
import { testApp } from './helpers.js';

let t: Awaited<ReturnType<typeof testApp>>;
let resident = '', admin = '', neighbour = '';
const A = () => `/v1/admin/${t.associationId}`;
const titles = async (token: string) => (await t.call('GET', '/v1/notifications', { token })).body.map((n: { title: string }) => n.title);

beforeAll(async () => {
  t = await testApp();
  resident = (await t.signIn(DEMO.residentPhone)).accessToken;
  neighbour = (await t.signIn('9900112233')).accessToken;
  admin = (await t.staffIn()).accessToken;
});
afterAll(async () => { await t?.close(); });

describe('a repair, from request to paid invoice', () => {
  let ref = '';
  let plumberId = '';

  it('takes the request; the office estimates it and the committee must approve a costly one', async () => {
    const created = await t.call('POST', '/v1/issues', { token: resident, body: { title: 'Bathroom ceiling leaking', details: 'Dripping near the light', category: 'Plumbing', location: 'My flat (T4-1108)', priority: 'High', via: 'form' } });
    ref = created.body.ref;
    expect(created.body.costEstimate).toBeUndefined(); // residents never see the money side

    const list = (await t.call('GET', `${A()}/vendor-list`, { token: admin })).body;
    plumberId = list.find((v: { name: string }) => v.name === 'Sunrise Plumbing Co.').id;

    await t.call('POST', `${A()}/issues/${ref}/status`, { token: admin, body: { to: 'Acknowledged' } });
    // ₹1,200 is under the society's ₹5,000 limit → no approval needed
    expect((await t.call('PUT', `${A()}/issues/${ref}/estimate`, { token: admin, body: { amount: 1200 } })).body.approval).toBe('none');
    // revised to ₹18,000 → the committee has to approve before work starts
    expect((await t.call('PUT', `${A()}/issues/${ref}/estimate`, { token: admin, body: { amount: 18000 } })).body.approval).toBe('pending');
    await t.call('POST', `${A()}/issues/${ref}/status`, { token: admin, body: { to: 'Assigned', vendorId: plumberId, accessNote: 'Call before coming; key with security' } });
    expect((await t.call('POST', `${A()}/issues/${ref}/status`, { token: admin, body: { to: 'In Progress' } })).body.error.code).toBe('approval_pending');
    // the vendor may confirm they'll take it, but nothing is scheduled until the money is approved
    expect((await t.call('POST', `${A()}/issues/${ref}/vendor-progress`, { token: admin, body: { state: 'Visited' } })).body.error.code).toBe('approval_pending');
    expect((await t.call('POST', `${A()}/issues/${ref}/approval`, { token: admin, body: { decision: 'approved', note: 'Go ahead' } })).body.approval).toBe('approved');
  });

  it('has no vendor login: vendors are records, and a vendor number cannot sign in', async () => {
    const v = await t.call('POST', `${A()}/vendor-list`, { token: admin, body: { name: 'PestAway Services', category: 'Pest control', contact: 'Ramesh K', phone: '9822200002' } });
    expect(v.status).toBe(201);
    expect((await t.call('POST', '/v1/auth/otp/request', { body: { phone: '9822200002' } })).body.error.code).toBe('not_registered');
    await t.call('PUT', `${A()}/vendor-list/${v.body.id}`, { token: admin, body: { active: false } });
    expect((await t.call('GET', `${A()}/vendor-list`, { token: admin })).body.find((x: { name: string }) => x.name === 'PestAway Services').active).toBe(false);
  });

  it('lets the manager record the vendor’s progress, telling the resident each time', async () => {
    const accepted = await t.call('POST', `${A()}/issues/${ref}/vendor-progress`, { token: admin, body: { state: 'Accepted' } });
    expect(accepted.body).toMatchObject({ status: 'In Progress', vendorState: 'Accepted' });
    expect((await t.call('POST', `${A()}/issues/${ref}/vendor-progress`, { token: admin, body: { state: 'Scheduled' } })).body.error.code).toBe('time_required');
    await t.call('POST', `${A()}/issues/${ref}/vendor-progress`, { token: admin, body: { state: 'Scheduled', scheduledAt: new Date(Date.now() + 864e5).toISOString() } });
    await t.call('POST', `${A()}/issues/${ref}/vendor-progress`, { token: admin, body: { state: 'Visited', note: 'Seal has failed, replacing' } });
    const done = await t.call('POST', `${A()}/issues/${ref}/vendor-progress`, { token: admin, body: { state: 'Completed', note: 'Drain resealed' } });
    expect(done.body.status).toBe('Resolved');

    const seen = (await t.call('GET', `/v1/issues/${ref}`, { token: resident })).body;
    expect(seen.vendorState).toBe('Completed');
    expect(seen.timeline.at(-1).note).toBe('Work completed · Drain resealed');
    expect(seen.timeline.some((e: { note: string }) => e.note === 'Sunrise Plumbing Co. confirmed the job')).toBe(true);
    expect(seen.accessNote).toBeUndefined();
    expect(await titles(resident)).toContain(`${ref} resolved — please confirm`);
    expect((await t.call('POST', `/v1/issues/${ref}/confirm`, { token: resident })).body.status).toBe('Closed');
  });

  it('carries the conversation between the resident and the office', async () => {
    await t.call('POST', `/v1/issues/${ref}/messages`, { token: resident, body: { text: 'Is the ceiling paint included?' } });
    await t.call('POST', `${A()}/issues/${ref}/messages`, { token: admin, body: { text: 'Yes, patch and repaint are included.' } });
    const forResident = (await t.call('GET', `/v1/issues/${ref}/messages`, { token: resident })).body;
    expect(forResident.map((m: { text: string }) => m.text)).toEqual(['Is the ceiling paint included?', 'Yes, patch and repaint are included.']);
    expect((await t.call('GET', `${A()}/issues/${ref}/messages`, { token: admin })).body).toHaveLength(2);
    expect((await t.call('GET', `/v1/issues/${ref}/messages`, { token: neighbour })).status).toBe(403);
    expect(await titles(resident)).toContain(`Message on ${ref}`);
  });

  it('records the vendor’s bill, takes it through approval to paid, and keeps the actual cost', async () => {
    const inv = await t.call('POST', `${A()}/issues/${ref}/invoices`, { token: admin, body: { amount: 17400, note: 'Labour + sealant + repaint' } });
    expect(inv.status).toBe(201);
    const list = (await t.call('GET', `${A()}/invoices`, { token: admin })).body;
    expect(list[0]).toMatchObject({ issue: ref, vendor: 'Sunrise Plumbing Co.', amount: 17400, status: 'Pending' });
    expect((await t.call('POST', `${A()}/invoices/${inv.body.id}/status`, { token: admin, body: { status: 'Paid' } })).body.error.code).toBe('bad_transition');
    await t.call('POST', `${A()}/invoices/${inv.body.id}/status`, { token: admin, body: { status: 'Approved' } });
    await t.call('POST', `${A()}/invoices/${inv.body.id}/status`, { token: admin, body: { status: 'Paid' } });
    expect((await t.call('GET', `${A()}/issues/${ref}`, { token: admin })).body.costActual).toBe(17400);
  });

  it('reports on the work: totals, vendors, spending', async () => {
    await t.call('POST', `/v1/issues/${ref}/rating`, { token: resident, body: { stars: 4 } });
    const r = (await t.call('GET', `${A()}/reports/maintenance`, { token: admin })).body;
    expect(r.totals.completed).toBe(1);
    expect(r.totals.sla_met).toBe(1);
    expect(r.byVendor.find((x: { vendor: string }) => x.vendor === 'Sunrise Plumbing Co.')).toMatchObject({ jobs: 1, completed: 1, rating: 4, spent: 17400 });
    expect(r.expenseByCategory).toEqual([{ category: 'Plumbing', amount: 17400 }]);
  });
});

describe('common areas, emergencies, holds and follow-ups', () => {
  it('takes a common-area request from any resident, with no flat attached', async () => {
    const r = await t.call('POST', '/v1/issues/common', { token: neighbour, body: { title: 'Lift 2 stuck between floors', category: 'Lifts', asset: 'Lift', location: 'Tower 1', priority: 'Emergency' } });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ scope: 'common', asset: 'Lift', unit: null, priority: 'Emergency' });
    // an emergency reaches the office at once, and is due in 4 hours, not days
    expect(await titles(admin)).toContain(`EMERGENCY: ${r.body.ref}`);
    expect(new Date(r.body.slaDueAt).getTime() - Date.now()).toBeLessThan(4.1 * 3600e3);
    expect((await t.call('GET', '/v1/maintenance/options', { token: neighbour })).body.commonAssets).toContain('STP');
  });

  it('lets the office log a call-in request and park a job on hold', async () => {
    const logged = await t.call('POST', `${A()}/issues`, { token: admin, body: { title: 'Generator not starting', category: 'Electrical', asset: 'Generator', location: 'Basement 1', priority: 'High' } });
    expect(logged.body.via).toBe('admin');
    const ref = logged.body.ref;
    const fixit = (await t.call('GET', `${A()}/vendor-list`, { token: admin })).body.find((v: { name: string }) => v.name === 'FixIt Electricals');
    await t.call('POST', `${A()}/issues/${ref}/status`, { token: admin, body: { to: 'Acknowledged' } });
    await t.call('POST', `${A()}/issues/${ref}/status`, { token: admin, body: { to: 'Assigned', vendorId: fixit.id } });
    expect((await t.call('POST', `${A()}/issues/${ref}/status`, { token: admin, body: { to: 'On Hold', note: 'Waiting for the starter motor' } })).body.status).toBe('On Hold');
    // back from hold without naming the vendor again
    expect((await t.call('POST', `${A()}/issues/${ref}/status`, { token: admin, body: { to: 'Assigned' } })).body).toMatchObject({ status: 'Assigned', vendor: 'FixIt Electricals' });
  });

  it('reminds the manager to chase a silent vendor after 24 hours, and escalates an overdue ticket, once each', async () => {
    const created = await t.call('POST', '/v1/issues', { token: resident, body: { title: 'Kitchen tap dripping', category: 'Plumbing', location: 'My flat (T4-1108)', priority: 'Low', via: 'form' } });
    const ref = created.body.ref;
    const plumber = (await t.call('GET', `${A()}/vendor-list`, { token: admin })).body.find((v: { name: string }) => v.name === 'Sunrise Plumbing Co.');
    await t.call('POST', `${A()}/issues/${ref}/status`, { token: admin, body: { to: 'Acknowledged' } });
    await t.call('POST', `${A()}/issues/${ref}/status`, { token: admin, body: { to: 'Assigned', vendorId: plumber.id } });

    expect(await sweep(t.db)).toMatchObject({ reminded: 0 }); // nothing is quiet yet
    // two days pass with nothing recorded, and the response time runs out
    await t.db.update(issues).set({ lastActivityAt: new Date(Date.now() - 48 * 3600e3), slaDueAt: new Date(Date.now() - 3600e3) }).where(eq(issues.number, Number(ref.slice(4))));
    const first = await sweep(t.db);
    expect(first.reminded).toBe(1);
    expect(first.escalated).toBeGreaterThanOrEqual(1);
    const mine = await titles(admin);
    expect(mine).toContain(`Chase Sunrise Plumbing Co.: ${ref}`);
    expect(mine).toContain(`Overdue: ${ref}`);
    // running it again straight away does nothing — no reminder spam
    expect(await sweep(t.db)).toEqual({ reminded: 0, escalated: 0 });
    expect((await t.call('GET', `${A()}/issues/${ref}`, { token: admin })).body.escalated).toBe(true);
  });
});

describe('virtual property managers', () => {
  let op = '', vpm = '';
  beforeAll(async () => {
    op = (await t.staffIn(DEMO.operatorEmail, DEMO.operatorPassword)).accessToken;
    vpm = (await t.signIn(DEMO.vpmPhone)).accessToken;
  });

  it('shows a VPM the societies assigned to them, with what is waiting in each', async () => {
    const me = (await t.call('GET', '/v1/vpm/me', { token: vpm })).body;
    expect(me.user.name).toBe('Imran Qureshi');
    expect(me.societies.map((s: { short: string }) => s.short)).toEqual(['Green Meadows', 'Prestige Lakeside']);
    const lakeside = me.societies.find((s: { short: string }) => s.short === 'Prestige Lakeside');
    expect(lakeside.open).toBeGreaterThan(0);
    expect(lakeside.emergencies).toBe(1);
    // the home screen's figures, and the requests that most need attention across every society
    expect(lakeside.homes).toBeGreaterThan(0);
    expect(lakeside.residents).toBeGreaterThan(0);
    expect(lakeside).toMatchObject({ approvals: expect.any(Number), resolvedWeek: expect.any(Number) });
    expect(me.attention.length).toBeGreaterThan(0);
    expect(me.attention[0]).toMatchObject({ priority: 'Emergency', society: 'Prestige Lakeside', aid: lakeside.id });
    expect(me.attention[0].ref).toMatch(/^ISS-\d+$/);
    // a resident or a society admin is not a VPM
    expect((await t.call('GET', '/v1/vpm/me', { token: resident })).status).toBe(403);
    expect((await t.call('GET', '/v1/vpm/me', { token: admin })).status).toBe(403);
    // and a VPM is not a resident
    expect((await t.call('GET', '/v1/me', { token: vpm })).status).toBe(403);
  });

  it('lets a VPM run an assigned society, and keeps them out of the others', async () => {
    const queue = await t.call('GET', `${A()}/issues`, { token: vpm });
    expect(queue.status).toBe(200);
    const fresh = queue.body.find((i: { status: string }) => i.status === 'Submitted');
    const moved = await t.call('POST', `${A()}/issues/${fresh.ref}/status`, { token: vpm, body: { to: 'Acknowledged', note: 'Looking into it' } });
    expect(moved.body.status).toBe('Acknowledged');
    expect((await t.call('GET', `${A()}/audit`, { token: vpm })).body[0]).toMatchObject({ actor: 'Imran Qureshi' });
    // Lake View Residency was never assigned to this VPM
    expect((await t.call('GET', `/v1/admin/${t.lakeView}/issues`, { token: vpm })).status).toBe(403);
    // operator-only screens stay closed
    expect((await t.call('GET', '/v1/ops/associations', { token: vpm })).status).toBe(403);
    // new requests reach the VPM like they reach the admin
    const made = await t.call('POST', '/v1/issues', { token: resident, body: { title: 'Intercom not working', category: 'Electrical', location: 'My flat (T4-1108)', priority: 'Medium', via: 'form' } });
    expect(await titles(vpm)).toContain(`New request ${made.body.ref}`);
  });

  it('lets the operator create a VPM, change their societies and remove them', async () => {
    expect((await t.call('GET', '/v1/ops/vpms', { token: op })).body.map((v: { name: string }) => v.name)).toEqual(['Imran Qureshi']);
    const made = await t.call('POST', '/v1/ops/vpms', { token: op, body: { name: 'Lalitha Gowda', phone: '9844400004', associationIds: [t.nandiHills] } });
    expect(made.status).toBe(201);
    expect(made.body.societies.map((s: { name: string }) => s.name)).toEqual(['Nandi Hills Plotted Layout']);
    // the same number can't be made a VPM twice, and a VPM needs at least one society
    expect((await t.call('POST', '/v1/ops/vpms', { token: op, body: { name: 'Again', phone: '9844400004', associationIds: [t.nandiHills] } })).body.error.code).toBe('already_vpm');
    expect((await t.call('POST', '/v1/ops/vpms', { token: op, body: { name: 'Nobody', phone: '9844400005', associationIds: [] } })).status).toBe(400);

    const lalitha = await t.signIn('9844400004');
    expect((await t.call('GET', `/v1/admin/${t.nandiHills}/issues`, { token: lalitha.accessToken })).status).toBe(200);
    // moved to Green Meadows (an active society; a suspended one is closed to everyone): Nandi Hills closes to her at once
    await t.call('PUT', `/v1/ops/vpms/${made.body.id}/societies`, { token: op, body: { associationIds: [t.greenMeadows] } });
    expect((await t.call('GET', `/v1/admin/${t.nandiHills}/issues`, { token: lalitha.accessToken })).status).toBe(403);
    expect((await t.call('GET', `/v1/admin/${t.greenMeadows}/issues`, { token: lalitha.accessToken })).status).toBe(200);
    // removed: no access, and her sign-in is ended
    expect((await t.call('DELETE', `/v1/ops/vpms/${made.body.id}`, { token: op })).status).toBe(204);
    expect((await t.call('GET', '/v1/vpm/me', { token: lalitha.accessToken })).status).toBe(403);
    expect((await t.call('POST', '/v1/auth/refresh', { body: { refreshToken: lalitha.refreshToken } })).status).toBe(401);
    // only the operator manages VPMs
    expect((await t.call('GET', '/v1/ops/vpms', { token: admin })).status).toBe(403);
  });
});
