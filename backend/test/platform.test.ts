import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO } from '../src/db/seed.js';
import { testApp } from './helpers.js';

type Call = 'GET' | 'POST' | 'PUT' | 'DELETE';

describe('the platform: plans, societies, super admins and support', () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let op = '', admin = '';
  const O = (m: Call, path: string, body?: unknown, token = op) => t.call(m, '/v1/ops' + path, { token, body });
  const A = (m: Call, path: string, body?: unknown, token = admin) => t.call(m, `/v1/admin/${t.associationId}${path}`, { token, body });

  beforeAll(async () => {
    t = await testApp();
    op = (await t.staffIn(DEMO.operatorEmail, DEMO.operatorPassword)).accessToken;
    admin = (await t.staffIn()).accessToken;
  });
  afterAll(async () => { await t?.close(); });

  it('holds a society to its plan, and changes at once when the plan does', async () => {
    // Prestige Lakeside is on Enterprise: everything is open
    const full = (await A('GET', '/plan')).body;
    expect(full).toMatchObject({ plan: 'Enterprise', state: 'Active', suspended: false, needs: {} });
    expect(Object.values(full.features).every(Boolean)).toBe(true);
    expect((await A('GET', '/inspections')).status).toBe(200);

    // moved down to Starter: the parts that belong to higher plans answer with the plan they need
    await O('PUT', `/associations/${t.associationId}/subscription`, { plan: 'Starter', note: 'test' });
    const starter = (await A('GET', '/plan')).body;
    expect(starter.features).toEqual({ gate: false, inspections: false, assistant: false, accounting: false, owners: false, workorders: false });
    expect(starter.needs).toMatchObject({ gate: 'Professional', inspections: 'Enterprise', accounting: 'Professional' });
    const blocked = await A('GET', '/inspections');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toMatchObject({ code: 'plan_required', feature: 'inspections', plan: 'Enterprise' });
    expect(blocked.body.error.message).toBe('Inspections is part of the Enterprise plan. This society is on Starter.');
    // the modules that were taken out of the product are gone, not merely locked
    expect((await A('GET', '/leasing/options')).status).toBe(404);
    expect((await A('GET', '/insights')).status).toBe(404);
    expect((await A('GET', '/reports/monthly')).status).toBe(404);
    expect((await A('GET', '/visits')).body.error.code).toBe('plan_required');
    expect((await A('POST', '/assistant/ask', { text: 'Show pending dues' })).body.error.code).toBe('plan_required');
    expect((await A('GET', '/finance/expenses')).body.error.code).toBe('plan_required');
    // what every plan has still works: issues, notices, billing, residents
    expect((await A('GET', '/issues')).status).toBe(200);
    expect((await A('GET', '/finance/bills')).status).toBe(200);
    expect((await A('GET', '/finance/dashboard')).status).toBe(200);
    expect((await A('GET', '/units')).status).toBe(200);

    // Professional opens the middle tier and nothing above it
    await O('PUT', `/associations/${t.associationId}/subscription`, { plan: 'Professional' });
    expect((await A('GET', '/visits')).status).toBe(200);
    expect((await A('GET', '/finance/expenses')).status).toBe(200);
    expect((await A('GET', '/inspections')).status).toBe(403);

    // suspended: the console is closed, except to see why and to write to support
    await O('PUT', `/associations/${t.associationId}/subscription`, { state: 'Suspended' });
    expect((await A('GET', '/issues')).body.error).toMatchObject({ code: 'subscription_suspended' });
    expect((await A('GET', '/plan')).body).toMatchObject({ suspended: true, state: 'Suspended' });
    expect((await A('GET', '/support')).status).toBe(200);
    // someone who is not signed in learns nothing about the plan
    expect((await t.call('GET', `/v1/admin/${t.associationId}/issues`)).status).toBe(401);

    await O('PUT', `/associations/${t.associationId}/subscription`, { plan: 'Enterprise', state: 'Active' });
    expect((await A('GET', '/inspections')).status).toBe(200);
  });

  it('lets the super admin decide what each plan includes', async () => {
    const p = (await O('GET', '/plans')).body;
    expect(Object.keys(p.plans)).toEqual(['Starter', 'Professional', 'Enterprise']);
    expect(p.modules.find((m: { name: string }) => m.name === 'Visitor Management').from).toBe('Professional');
    expect(p.features.gate).toMatchObject({ module: 'Visitor Management', from: 'Professional' });

    // visitor management moves into Starter; AI inspections stay Enterprise
    await O('PUT', `/associations/${t.associationId}/subscription`, { plan: 'Starter' });
    expect((await A('GET', '/visits')).status).toBe(403);
    const saved = (await O('PUT', '/plans', { moduleFrom: { 'Visitor Management': 'Starter' }, plans: { Starter: { tag: 'The essentials', price: 24000 } } })).body;
    expect(saved.modules.find((m: { name: string }) => m.name === 'Visitor Management').from).toBe('Starter');
    expect(saved.plans.Starter).toMatchObject({ tag: 'The essentials', price: 24000 });
    expect(saved.plans.Professional.tag).toBe('Run it properly'); // untouched plans keep their words
    expect((await A('GET', '/visits')).status).toBe(200); // applies to every Starter society at once
    expect((await A('GET', '/inspections/options')).status).toBe(403);
    // the portal's own numbers follow: every society now has the module
    const boot = (await O('GET', '/bootstrap')).body;
    expect(boot.modules.find((m: { name: string }) => m.name === 'Visitor Management')).toMatchObject({ from: 'Starter', adoption: 100 });
    expect(boot.plans.Starter.price).toBe(24000);
    expect((await O('PUT', '/plans', { moduleFrom: { 'Time Travel': 'Starter' } })).body.error.code).toBe('unknown_module');
    expect((await O('PUT', '/plans', { moduleFrom: { 'Visitor Management': 'Gold' } })).status).toBe(400);
    expect((await O('GET', '/plans', undefined, admin)).status).toBe(403);
    await O('PUT', '/plans', { moduleFrom: { 'Visitor Management': 'Professional' } });
    await O('PUT', `/associations/${t.associationId}/subscription`, { plan: 'Enterprise' });
  });

  it('lets a society write to Trinize, and the two sides talk on the same issue', async () => {
    expect((await A('POST', '/support', { category: 'Billing', title: 'Hi', details: 'short' })).status).toBe(400);
    const made = await A('POST', '/support', { category: 'Billing', title: 'Maintenance bills show the wrong rate', details: 'November bills were generated at last year’s per-sqft rate for Tower 4.', priority: 'High' });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ category: 'Billing', priority: 'High', status: 'Open', raisedBy: 'Sanjana Rao', slaState: 'ok' });
    expect(made.body.ref).toMatch(/^ISS-\d+$/);
    expect(made.body.replies).toEqual([expect.objectContaining({ by: 'Sanjana Rao', mine: true, text: expect.stringContaining('per-sqft rate') })]);
    // it is in the super admin's list, for the right society
    const seen = (await O('GET', '/tickets')).body.find((x: { ref: string }) => x.ref === made.body.ref);
    expect(seen).toMatchObject({ association: 'Prestige Lakeside Habitat', source: 'Society office · Secretary', status: 'Open' });
    await O('POST', `/tickets/${seen.id}/reply`, { text: 'Rate corrected; please regenerate the run.', resolve: true });
    const back = (await A('GET', `/support/${made.body.id}`)).body;
    expect(back.status).toBe('Resolved');
    expect(back.replies.map((r: { by: string; mine: boolean }) => [r.by, r.mine])).toEqual([['Sanjana Rao', true], ['Ravi Kulkarni', false]]);
    // writing again reopens it
    expect((await A('POST', `/support/${made.body.id}/reply`, { text: 'Tower 5 is still wrong.' })).body).toMatchObject({ status: 'In progress' });
    expect((await A('GET', '/support')).body.tickets.find((x: { ref: string }) => x.ref === made.body.ref).status).toBe('In progress');
    // another society's issue is not theirs to read
    const other = (await O('GET', '/tickets')).body.find((x: { association: string }) => x.association !== 'Prestige Lakeside Habitat');
    expect((await A('GET', `/support/${other.id}`)).status).toBe(404);
  });

  it('raises an invoice and sends the reminder to the society’s contact', async () => {
    const made = await O('POST', '/invoices', { associationId: t.associationId, amount: 25000, dueAt: new Date(Date.now() - 3 * 864e5).toISOString() });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ amount: 25000, state: 'Overdue' });
    expect(made.body.number).toMatch(/^TRZ-INV-\d{4}-\d{4}$/);
    const chased = (await O('POST', `/invoices/${made.body.id}/chase`)).body;
    expect(chased).toMatchObject({ chases: 1, delivered: true, delivery: 'Sent' });
    const mail = t.messenger.sent.at(-1)!;
    expect(mail).toMatchObject({ channel: 'email', subject: `Payment reminder: ${made.body.number}` });
    expect(mail.body).toContain('₹25,000 outstanding and is 3 days past its due date');
    expect((await O('GET', '/activity')).body[0].what).toContain('email sent');
  });

  it('edits a society, and removes one only when its name is typed', async () => {
    expect((await O('PUT', `/associations/${t.greenMeadows}`, { name: 'Prestige Lakeside Habitat' })).body.error.code).toBe('name_taken');
    expect((await O('PUT', `/associations/${t.greenMeadows}`, { name: 'Green Meadows Villas Phase 2', city: 'Mysuru', plots: 120, adminName: 'Bhagya L', adminEmail: 'Bhagya@GreenMeadows.example' })).status).toBe(200);
    const row = (await O('GET', '/associations')).body.find((a: { id: string }) => a.id === t.greenMeadows);
    expect(row).toMatchObject({ name: 'Green Meadows Villas Phase 2', city: 'Mysuru', plots: 120, contact: { name: 'Bhagya L', email: 'bhagya@greenmeadows.example' } });
    expect((await O('PUT', `/associations/${t.greenMeadows}`, {})).body.error.code).toBe('nothing_to_change');

    const before = (await O('GET', '/associations')).body.length;
    expect((await O('DELETE', `/associations/${t.lakeView}`, { confirm: 'lake view' })).body.error.code).toBe('confirm_name');
    expect((await O('DELETE', `/associations/${t.lakeView}`, { confirm: 'Lake View Residency' })).status).toBe(204);
    expect((await O('GET', '/associations')).body).toHaveLength(before - 1);
    expect((await O('GET', '/invoices')).body.some((i: { associationId: string }) => i.associationId === t.lakeView)).toBe(false);
    // a society with real records under it goes too: flats, bills, tickets, staff sign-ins
    expect((await O('DELETE', `/associations/${t.associationId}`, { confirm: 'Prestige Lakeside Habitat' })).status).toBe(204);
    // its secretary has no console left to sign in to
    expect((await t.call('POST', '/v1/auth/staff/login', { body: { email: DEMO.adminEmail, password: DEMO.adminPassword } })).status).toBe(401);
    expect((await O('GET', '/bootstrap')).status).toBe(200);
  });

  it('adds and removes super admins, and resets a lost password', async () => {
    expect((await O('GET', '/operators')).body).toEqual([expect.objectContaining({ name: 'Ravi Kulkarni', me: true })]);
    expect((await O('DELETE', `/operators/${(await O('GET', '/operators')).body[0].id}`)).body.error.code).toBe('not_yourself');
    expect((await O('POST', '/operators', { name: 'Meera', email: 'meera@trinize.com', password: 'short' })).status).toBe(400);
    const made = await O('POST', '/operators', { name: 'Meera Pillai', email: 'Meera@Trinize.com', password: 'Welcome@2026' });
    expect(made.status).toBe(201);
    expect((await O('POST', '/operators', { name: 'Again', email: 'meera@trinize.com', password: 'Welcome@2026' })).body.error.code).toBe('email_taken');
    const meera = (await t.staffIn('meera@trinize.com', 'Welcome@2026')).accessToken;
    expect((await O('GET', '/bootstrap', undefined, meera)).status).toBe(200);

    // she changes her own password; the old one stops working
    expect((await t.call('POST', '/v1/auth/staff/password', { token: meera, body: { current: 'wrong', next: 'Another@2026' } })).status).toBe(403);
    expect((await t.call('POST', '/v1/auth/staff/password', { token: meera, body: { current: 'Welcome@2026', next: 'Another@2026' } })).status).toBe(200);
    expect((await t.call('POST', '/v1/auth/staff/login', { body: { email: 'meera@trinize.com', password: 'Welcome@2026' } })).status).toBe(401);
    // she forgets it; another super admin sets a new one
    expect((await O('PUT', `/operators/${made.body.id}/password`, { password: 'Reset@2026!' })).status).toBe(200);
    expect((await t.call('POST', '/v1/auth/staff/login', { body: { email: 'meera@trinize.com', password: 'Reset@2026!' } })).status).toBe(200);

    expect((await O('DELETE', `/operators/${made.body.id}`)).status).toBe(204);
    expect((await O('GET', '/bootstrap', undefined, meera)).status).toBe(403);
    // removed by mistake: she can be added back with the same email
    expect((await O('POST', '/operators', { name: 'Meera Pillai', email: 'meera@trinize.com', password: 'Back@2026!' })).status).toBe(201);
    expect((await t.call('POST', '/v1/auth/staff/login', { body: { email: 'meera@trinize.com', password: 'Back@2026!' } })).status).toBe(200);
    expect((await O('GET', '/operators')).body).toHaveLength(2);
  });

  it('onboards a society with its timings, which its assistant can answer from, and shows its admin what is left to set up', async () => {
    const fields = (await O('GET', '/facts')).body;
    expect(fields.map((f: { key: string }) => f.key)).toContain('pool');
    const made = await O('POST', '/associations', {
      name: 'Orchid Greens Residency', city: 'Pune', plan: 'Enterprise', state: 'Active', plots: 40, annualAmount: 120000, renewsAt: new Date(Date.now() + 300 * 864e5).toISOString(),
      admin: { name: 'Kavita Joshi', email: 'kavita@orchid.test' }, adminPassword: 'Orchid@2026',
      facts: { pool: '6:30–9:30 AM and 5:00–8:00 PM, closed on Tuesdays.', office: 'Mon–Sat, 10 AM – 6 PM', gym: '   ' },
    });
    expect(made.status).toBe(201);
    const kavita = (await t.staffIn('kavita@orchid.test', 'Orchid@2026')).accessToken;
    const K = (m: Call, path: string, body?: unknown) => t.call(m, `/v1/admin/${made.body.id}${path}`, { token: kavita, body });
    const docs = (await K('GET', '/knowledge')).body;
    expect(docs.map((d: { title: string; section: string }) => `${d.title} · ${d.section}`).sort()).toEqual(['Society facts · Office hours', 'Society facts · Pool']);
    expect(docs.find((d: { section: string }) => d.section === 'Pool').body).toBe('Swimming pool timings: 6:30–9:30 AM and 5:00–8:00 PM, closed on Tuesdays.');
    // the admin's checklist: the assistant already has something to answer from; flats and residents are still to do
    const setup = (await K('GET', '/setup')).body;
    expect(setup).toMatchObject({ done: 1, total: 7 });
    expect(Object.fromEntries(setup.steps.map((s: { key: string; done: boolean }) => [s.key, s.done]))).toEqual({ flats: false, residents: false, knowledge: true, directory: false, notice: false, vendors: false, team: false });
    // what Trinize left empty, the society's admin fills in — and corrects what was noted
    const mine = (await K('GET', '/facts')).body;
    expect(Object.fromEntries(mine.map((f: { key: string; value: string }) => [f.key, f.value]))).toMatchObject({ pool: '6:30–9:30 AM and 5:00–8:00 PM, closed on Tuesdays', office: 'Mon–Sat, 10 AM – 6 PM', gym: '' });
    const saved = (await K('PUT', '/facts', { gym: '5 AM – 11 PM daily', office: '' })).body;
    expect(Object.fromEntries(saved.map((f: { key: string; value: string }) => [f.key, f.value]))).toMatchObject({ gym: '5 AM – 11 PM daily', office: '', pool: '6:30–9:30 AM and 5:00–8:00 PM, closed on Tuesdays' });
    expect((await K('GET', '/knowledge')).body.map((d: { section: string }) => d.section).sort()).toEqual(['Gym', 'Pool']);
    // the Directory: the public helplines are there from the start, and the admin adds the society's own people
    expect((await K('GET', '/directory')).body.map((c: { name: string; phone: string }) => `${c.name} ${c.phone}`)).toEqual(['Ambulance 108', 'Fire Brigade 101', 'Police 100']);
    const sec = await K('POST', '/directory', { group: 'emergency', name: 'Security Office', role: 'Main gate', phone: '+91 20 4000 1234' });
    expect(sec.status).toBe(201);
    expect((await K('POST', '/directory', { group: 'emergency', name: 'security office', phone: '100' })).body.error.code).toBe('already_listed');
    expect((await K('POST', '/directory', { group: 'committee', name: 'Kavita Joshi', role: 'Secretary', phone: 'call me' })).status).toBe(400);
    const kj = (await K('POST', '/directory', { group: 'committee', name: 'Kavita Joshi', role: 'Secretary', phone: '98220 11223' })).body;
    expect((await K('PUT', `/directory/${kj.id}`, { name: 'Kavita Joshi', role: 'President', phone: '98220 11223' })).body.role).toBe('President');
    // security goes to the top of the emergency numbers
    for (let i = 0; i < 3; i++) await K('POST', `/directory/${sec.body.id}/move`, { dir: 'up' });
    const now = (await K('GET', '/directory')).body;
    expect(now.filter((c: { group: string }) => c.group === 'emergency').map((c: { name: string }) => c.name)).toEqual(['Security Office', 'Ambulance', 'Fire Brigade', 'Police']);
    // vendors kept under Maintenance are copied across once, never twice
    await K('POST', '/vendor-list', { name: 'Shree Plumbers', category: 'Plumbing', phone: '9822055667' });
    expect((await K('POST', '/directory/import-vendors')).body.added).toBe(1);
    expect((await K('POST', '/directory/import-vendors')).body.added).toBe(0);
    expect((await K('GET', '/setup')).body.steps.find((s: { key: string }) => s.key === 'directory')).toMatchObject({ done: true, count: 1 });
    await K('DELETE', `/directory/${kj.id}`);
    expect((await K('GET', '/directory')).body.some((c: { name: string }) => c.name === 'Kavita Joshi')).toBe(false);
    await K('POST', '/units', { units: [{ code: 'A-101', tower: 'Block A' }] });
    expect((await K('GET', '/setup')).body.steps.find((s: { key: string }) => s.key === 'flats')).toMatchObject({ done: true, count: 1 });
  });
});
