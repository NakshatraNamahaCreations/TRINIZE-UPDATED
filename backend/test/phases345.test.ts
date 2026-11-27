import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO } from '../src/db/seed.js';
import { noAi, type Ai } from '../src/lib/ai.js';
import { codeAt } from '../src/lib/totp.js';
import { testApp } from './helpers.js';

describe('assistant on built-in rules (no AI key)', () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let token = '', admin = '';
  const A = () => `/v1/admin/${t.associationId}`;
  beforeAll(async () => { t = await testApp(); token = (await t.signIn()).accessToken; admin = (await t.staffIn()).accessToken; });
  afterAll(async () => { await t?.close(); });
  const ask = async (text: string) => (await t.call('POST', '/v1/assistant/chat', { token, body: { text } })).body;

  it('answers from approved documents and cites the source', async () => {
    const pool = await ask('What are the pool timings?');
    expect(pool.text).toContain('6:00–9:00 AM');
    expect(pool.source).toContain('Pool, Gym & Clubhouse Rules');
    const parking = await ask('Where do visitors park?');
    expect(parking.text).toContain('Basement 2');
  });

  it('understands Hinglish, Hindi and Kannada questions', async () => {
    for (const q of ['paani kab band hoga', 'पानी कब बंद होगा?', 'ನೀರು ಯಾವಾಗ ನಿಲ್ಲುತ್ತದೆ']) {
      const a = await ask(q);
      expect(a.source, q).toContain('AN-118');
      expect(a.text, q).toContain('pump-room maintenance');
    }
  });

  it('never guesses, and never sends an emergency to a model', async () => {
    const unknown = await ask('What is the wifi password for the clubhouse?');
    expect(unknown.source).toBeNull();
    expect(unknown.text).toContain('couldn’t find');
    const fire = await ask('aag lagi hai');
    expect(fire.calls.map((c: [string, string]) => c[1])).toEqual(['+918041287001', '108', '101', '112']); // 112, the national number, is always offered
    expect(fire.text).toContain('I have not contacted any emergency service');
  });

  it('hands the history back a page at a time, newest first, to its owner only', async () => {
    const page = async (qs = '') => (await t.call('GET', '/v1/assistant/history' + qs, { token })).body;
    const all = (await page('?limit=50')).items;
    expect(all.length).toBeGreaterThan(4);
    expect(all[0]).toMatchObject({ role: 'assistant' }); // the newest row is the last answer
    expect(all[1]).toMatchObject({ role: 'user', text: 'aag lagi hai' });
    // walking the cursor returns every row exactly once, in the same order
    const walked: { id: string }[] = [];
    let cursor: string | null = null, pages = 0;
    do {
      const p = await page('?limit=3' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
      expect(p.items.length).toBeLessThanOrEqual(3);
      walked.push(...p.items); cursor = p.nextCursor; pages++;
    } while (cursor);
    expect(walked.map(m => m.id)).toEqual(all.map((m: { id: string }) => m.id));
    expect(pages).toBe(Math.ceil(all.length / 3));
    // `before` starts earlier than a moment; nothing is older than the first row
    expect((await page('?before=' + encodeURIComponent(all[all.length - 1].createdAt))).items).toHaveLength(0);
    // no token, a tampered cursor or an oversized page are refused; another resident sees none of it
    expect((await t.call('GET', '/v1/assistant/history')).status).toBe(401);
    expect((await t.call('GET', '/v1/assistant/history?cursor=x', { token })).status).toBe(400);
    expect((await t.call('GET', '/v1/assistant/history?limit=500', { token })).status).toBe(400);
    const other = (await t.signIn(DEMO.tenantPhone)).accessToken;
    expect((await t.call('GET', '/v1/assistant/history', { token: other })).body).toEqual({ items: [], nextCursor: null });
  });

  it('stores the guided issue-report turns without counting them as questions', async () => {
    const before = (await t.call('POST', '/v1/me/impact', { token })).body.chats;
    const r = await t.call('POST', '/v1/assistant/history', { token, body: { messages: [{ role: 'user', text: 'Report an issue' }, { role: 'assistant', text: 'I can log that for you. Briefly, what’s the problem?' }] } });
    expect(r.status).toBe(204);
    const { items } = (await t.call('GET', '/v1/assistant/history?limit=2', { token })).body;
    expect(items.map((m: { text: string }) => m.text)).toEqual(['I can log that for you. Briefly, what’s the problem?', 'Report an issue']);
    expect((await t.call('POST', '/v1/me/impact', { token })).body.chats).toBe(before);
    expect((await t.call('POST', '/v1/assistant/history', { token, body: { messages: [] } })).status).toBe(400);
  });

  it('keeps history only while the resident allows it', async () => {
    await t.call('DELETE', '/v1/assistant/history', { token });
    await t.call('PUT', '/v1/settings', { token, body: { privacy: { aiHistory: false } } });
    await ask('What are the gym hours?');
    await t.call('POST', '/v1/assistant/history', { token, body: { messages: [{ role: 'user', text: 'Report an issue' }] } });
    expect((await t.call('GET', '/v1/assistant/history', { token })).body.items).toHaveLength(0);
  });

  it('rewrites tone without losing the facts, and obeys the admin switches', async () => {
    const r = await t.call('POST', '/v1/assistant/rewrite', { token, body: { text: 'The T4 lift is useless, third breakdown this month', tone: 'Polite' } });
    expect(r.body.text).toContain('T4 lift');
    expect(r.body.text).toContain('third breakdown this month');
    expect(r.body.text).not.toContain('useless');

    const cfg = (await t.call('GET', `${A()}/ai-settings`, { token: admin })).body;
    expect(cfg.aiConnected).toBe(false);
    await t.call('PUT', `${A()}/ai-settings`, { token: admin, body: { qna: false, tones: { Funny: false } } });
    expect((await ask('What are the pool timings?')).text).toContain('switched off');
    expect((await t.call('POST', '/v1/assistant/rewrite', { token, body: { text: 'Please fix the gate light', tone: 'Funny' } })).status).toBe(403);
    expect((await t.call('POST', '/v1/assistant/rewrite', { token, body: { text: 'Please fix the gate light', tone: 'Friendly' } })).status).toBe(200);
    await t.call('PUT', `${A()}/ai-settings`, { token: admin, body: { qna: true } });
  });

  it('lets the admin add to the library, and the assistant uses it straight away', async () => {
    expect((await ask('How much is the clubhouse party booking fee?')).source).toBeNull();
    const doc = await t.call('POST', `${A()}/knowledge`, { token: admin, body: { title: 'Clubhouse Booking Fees 2026', body: 'The clubhouse party hall booking fee is ₹2,500 for four hours, with a refundable deposit of ₹5,000.' } });
    expect(doc.status).toBe(201);
    const a = await ask('How much is the clubhouse party booking fee?');
    expect(a.text).toContain('₹2,500');
    expect(a.source).toBe('Clubhouse Booking Fees 2026');
  });
});

describe('with an AI provider connected', () => {
  it('grounds the model in documents and lets it catch what word lists miss', async () => {
    const seen: { docs: string[]; records: string }[] = [];
    const flat = (docs: { title: string; body: string }[]) => docs.map(d => d.title + '\n' + d.body).join('\n');
    const fake: Ai = {
      ...noAi,
      enabled: true,
      moderate: async text => (text.includes('should be thrown out of the society') ? { level: 'warn', words: ['thrown out of the society'] } : { level: 'safe', words: [] }),
      answer: async (_q, ctx) => { seen.push({ docs: ctx.docs.map(d => d.title), records: flat(ctx.docs) }); return { text: 'Pool: 6–9 AM and 4–8 PM, closed Mondays.', sources: ['Pool, Gym & Clubhouse Rules 2026 · page 2'] }; },
      rewrite: async () => 'Model rewrite',
    };
    const t = await testApp({ ai: fake });
    const token = (await t.signIn()).accessToken;
    const a = (await t.call('POST', '/v1/assistant/chat', { token, body: { text: 'pool timings?' } })).body;
    expect(a.text).toBe('Pool: 6–9 AM and 4–8 PM, closed Mondays.');
    expect(seen[0]!.docs[0]).toBe('Pool, Gym & Clubhouse Rules 2026');
    expect(seen[0]!.records).toContain('Yoga by the Lake'); // live records travel with the question
    // an emergency still never reaches the model
    await t.call('POST', '/v1/assistant/chat', { token, body: { text: 'there is a fire in the lobby' } });
    expect(seen).toHaveLength(1);
    // no listed word in it, but the model flags the attack on a person → held for review flow
    const post = await t.call('POST', '/v1/posts', { token, body: { text: 'The family in T2-0704 should be thrown out of the society' } });
    expect(post.status).toBe(409);
    expect(post.body.error.words).toEqual(['thrown out of the society']);
    expect((await t.call('POST', '/v1/assistant/rewrite', { token, body: { text: 'Fix the light', tone: 'Polite' } })).body.text).toBe('Model rewrite');
    await t.close();
  });
});

describe('operator portal', () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let op = '';
  beforeAll(async () => { t = await testApp(); op = (await t.staffIn(DEMO.operatorEmail, DEMO.operatorPassword)).accessToken; });
  afterAll(async () => { await t?.close(); });

  it('is closed to society admins and residents', async () => {
    const admin = (await t.staffIn()).accessToken;
    expect((await t.call('GET', '/v1/ops/associations', { token: admin })).status).toBe(403);
    expect((await t.call('GET', '/v1/ops/associations', { token: (await t.signIn()).accessToken })).status).toBe(403);
  });

  it('ranks the portfolio by health, worst first', async () => {
    const list = (await t.call('GET', '/v1/ops/associations', { token: op })).body;
    expect(list).toHaveLength(4);
    expect(list[0].name).toBe('Lake View Residency');
    expect(list[0].health).toMatchObject({ band: 'Critical', why: 'Suspended for non-payment' });
    const lakeside = list.find((a: { short: string }) => a.short === 'Prestige Lakeside');
    expect(lakeside.health.band).toBe('Healthy');
    expect(lakeside.pay).toBe('Paid');
    expect(lakeside.daysToRenewal).toBe(15);
    const meadows = list.find((a: { short: string }) => a.short === 'Green Meadows');
    expect(meadows.pay).toBe('Past due');
    expect(meadows.health.why).toBe('Payment overdue and usage sliding');
    const s = (await t.call('GET', '/v1/ops/summary', { token: op })).body;
    expect(s.mrrSeries).toHaveLength(12);
    expect(s.mrrSeries.at(-1).mrr).toBeGreaterThan(0);
    expect(s.billed).toHaveLength(6);
    expect(s.mrr).toBe(Math.round(1164840 / 12) + Math.round(12096 / 12)); // active accounts only
    expect(s.overdueCount).toBe(4);
    // one request carries what the portal used to fetch in six — and says the same things
    const boot = (await t.call('GET', '/v1/ops/bootstrap', { token: op })).body;
    expect(Object.keys(boot).sort()).toEqual(['activity', 'associations', 'invoices', 'modules', 'plans', 'summary', 'tickets']);
    expect(boot.summary).toEqual(s);
    expect(boot.associations).toEqual(list);
    expect(boot.invoices).toHaveLength((await t.call('GET', '/v1/ops/invoices', { token: op })).body.length);
    expect(boot.modules).toEqual((await t.call('GET', '/v1/ops/modules', { token: op })).body);
    const lakesideRow = boot.associations.find((a: { name: string }) => a.name === 'Prestige Lakeside Habitat');
    expect(lakesideRow.onApp).toEqual({ units: 5, residents: 6 });
    expect(meadows.overdue).toMatchObject({ count: 2 });
    expect((await t.call('GET', '/v1/ops/bootstrap', { token: (await t.staffIn()).accessToken })).status).toBe(403);
  });

  it('shows an account in full, with real numbers from the resident app', async () => {
    const a = (await t.call('GET', `/v1/ops/associations/${t.associationId}`, { token: op })).body;
    expect(a.onApp.units).toBe(5);
    expect(a.committee[0].role).toBe('President');
    expect(a.tickets.map((x: { ref: string }) => x.ref)).toContain('ISS-2043');
    expect(a.modules.every((m: { included: boolean }) => m.included)).toBe(true); // Enterprise includes everything
  });

  it('chases, part-pays and clears an invoice', async () => {
    const inv = (await t.call('GET', '/v1/ops/invoices', { token: op })).body;
    const late = inv.find((i: { state: string; amount: number }) => i.state === 'Overdue' && i.amount === 1152);
    expect((await t.call('POST', `/v1/ops/invoices/${late.id}/chase`, { token: op })).body.chases).toBe(1);
    expect((await t.call('POST', `/v1/ops/invoices/${late.id}/payment`, { token: op, body: { amount: 500 } })).body.state).toBe('Part paid');
    expect((await t.call('POST', `/v1/ops/invoices/${late.id}/payment`, { token: op, body: { amount: 5000 } })).body.error.code).toBe('overpayment');
    expect((await t.call('POST', `/v1/ops/invoices/${late.id}/payment`, { token: op, body: { amount: 652 } })).body.state).toBe('Paid');
    expect((await t.call('POST', `/v1/ops/invoices/${late.id}/chase`, { token: op })).body.error.code).toBe('already_paid');
  });

  it('assigns, answers and resolves a support ticket, and logs it all', async () => {
    const tix = (await t.call('GET', '/v1/ops/tickets', { token: op })).body;
    expect(tix[0].slaState).toBe('met'); // ordered by SLA time; the oldest one is resolved
    const open = tix.find((x: { ref: string }) => x.ref === 'ISS-2038');
    expect(open.slaState).toBe('risk');
    expect((await t.call('POST', `/v1/ops/tickets/${open.id}/assign`, { token: op, body: { assignee: 'Imran Qureshi' } })).body.status).toBe('In progress');
    expect((await t.call('POST', `/v1/ops/tickets/${open.id}/reply`, { token: op, body: { text: 'Fixed in today’s import build.', resolve: true } })).body.slaState).toBe('met');
    expect((await t.call('GET', `/v1/ops/tickets/${open.id}`, { token: op })).body.replies[0].by).toBe('Ravi Kulkarni');
    const feed = (await t.call('GET', '/v1/ops/activity', { token: op })).body.map((f: { what: string }) => f.what);
    expect(feed[0]).toBe('resolved ISS-2038');
    expect(feed).toContain('assigned ISS-2038 to Imran Qureshi');
  });

  it('changes a plan, which changes the modules included', async () => {
    const before = (await t.call('GET', `/v1/ops/associations/${t.greenMeadows}`, { token: op })).body;
    expect(before.modules.find((m: { name: string }) => m.name === 'AI Assistant').included).toBe(false);
    await t.call('PUT', `/v1/ops/associations/${t.greenMeadows}/subscription`, { token: op, body: { plan: 'Enterprise' } });
    const after = (await t.call('GET', `/v1/ops/associations/${t.greenMeadows}`, { token: op })).body;
    expect(after.modules.find((m: { name: string }) => m.name === 'AI Assistant').included).toBe(true);
  });
});

describe('staff two-step sign-in', () => {
  it('asks for an authenticator code once it is switched on', async () => {
    const t = await testApp();
    const first = await t.call('POST', '/v1/auth/staff/login', { body: { email: DEMO.adminEmail, password: DEMO.adminPassword } });
    const token = first.body.accessToken;
    const setup = (await t.call('POST', '/v1/auth/staff/2fa/setup', { token })).body;
    expect(setup.otpauthUrl).toContain('otpauth://totp/Trinize');
    expect((await t.call('POST', '/v1/auth/staff/2fa/enable', { token, body: { code: '000000' } })).body.error?.code ?? 'ok').toBe(codeAt(setup.secret) === '000000' ? 'ok' : 'wrong_code');
    expect((await t.call('POST', '/v1/auth/staff/2fa/enable', { token, body: { code: codeAt(setup.secret) } })).body.enabled).toBe(true);

    // from now on the password alone gives a ticket, not a session
    const again = (await t.call('POST', '/v1/auth/staff/login', { body: { email: DEMO.adminEmail, password: DEMO.adminPassword } })).body;
    expect(again.mfaRequired).toBe(true);
    expect(again.accessToken).toBeUndefined();
    const wrong = codeAt(setup.secret) === '123456' ? '654321' : '123456';
    expect((await t.call('POST', '/v1/auth/staff/mfa', { body: { mfaToken: again.mfaToken, code: wrong } })).status).toBe(401);
    const done = (await t.call('POST', '/v1/auth/staff/mfa', { body: { mfaToken: again.mfaToken, code: codeAt(setup.secret) } })).body;
    expect(done.user.name).toBe('Sanjana Rao');
    expect((await t.call('GET', `/v1/admin/${t.associationId}/issues`, { token: done.accessToken })).status).toBe(200);
    await t.close();
  });
});

describe('response hardening', () => {
  it('sends security headers on every response', async () => {
    const t = await testApp();
    const res = await t.app.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    await t.close();
  });
});

describe('browsers', () => {
  it('are allowed to PUT and DELETE from a listed console', async () => {
    const { buildApp } = await import('../src/app.js');
    const { loadConfig } = await import('../src/config.js');
    const { openDb } = await import('../src/db/client.js');
    const { MemorySms } = await import('../src/lib/sms.js');
    const h = await openDb('pglite', { migrate: true });
    const config = loadConfig({ NODE_ENV: 'test', JWT_SECRET: 'test-secret-test-secret-test-secret-123', SMS_PROVIDER: 'memory', UPLOAD_DIR: 'uploads-test', CORS_ORIGINS: 'http://localhost:5173' });
    const app = await buildApp({ config, db: h.db, sms: new MemorySms() });
    for (const method of ['PUT', 'DELETE']) {
      const res = await app.inject({ method: 'OPTIONS', url: '/v1/settings', headers: { origin: 'http://localhost:5173', 'access-control-request-method': method } });
      expect(res.headers['access-control-allow-methods'], method).toContain(method);
      expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    }
    // an unlisted website gets no permission at all
    const other = await app.inject({ method: 'OPTIONS', url: '/v1/settings', headers: { origin: 'https://evil.example', 'access-control-request-method': 'PUT' } });
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
    await app.close(); await h.close();
  });
});

describe('onboarding a society', () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let op = '';
  beforeAll(async () => { t = await testApp(); op = (await t.staffIn(DEMO.operatorEmail, DEMO.operatorPassword)).accessToken; });
  afterAll(async () => { await t?.close(); });

  const body = {
    name: 'Coastal Grove Residency', city: 'Mangaluru', kind: 'Mixed', plan: 'Professional', state: 'Trial', annualAmount: 74800,
    renewsAt: new Date(Date.now() + 14 * 864e5).toISOString(), plots: 340,
    admin: { name: 'Ronald Dsouza', role: 'President', phone: '9845071190', email: 'Ronald@coastalgrove.example' }, adminPassword: 'Coastal@2026',
  };

  it('creates the association, its subscription and an admin login', async () => {
    const made = await t.call('POST', '/v1/ops/associations', { token: op, body });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ name: 'Coastal Grove Residency', plan: 'Professional', state: 'Trial', pay: 'Trial', plots: 340, adminLogin: true });
    expect(made.body.contact.email).toBe('ronald@coastalgrove.example');
    expect((await t.call('GET', '/v1/ops/associations', { token: op })).body).toHaveLength(5);
    // the new admin can sign in to the console and sees only their society
    const admin = await t.staffIn('ronald@coastalgrove.example', 'Coastal@2026');
    expect(admin.roles).toEqual([{ role: 'admin', associationId: made.body.id, title: 'President' }]);
    expect((await t.call('GET', `/v1/admin/${made.body.id}/issues`, { token: admin.accessToken })).status).toBe(200);
    expect((await t.call('GET', `/v1/admin/${t.associationId}/issues`, { token: admin.accessToken })).status).toBe(403);
    // and a property manager can be assigned to it straight away
    const vpm = await t.call('POST', '/v1/ops/vpms', { token: op, body: { name: 'Lalitha Gowda', phone: '9811100022', associationIds: [made.body.id] } });
    expect(vpm.status).toBe(201);
  });

  it('refuses a duplicate name or an email that already has a login', async () => {
    expect((await t.call('POST', '/v1/ops/associations', { token: op, body })).body.error.code).toBe('name_taken');
    const again = { ...body, name: 'Another Society', admin: { ...body.admin, email: DEMO.adminEmail } };
    expect((await t.call('POST', '/v1/ops/associations', { token: op, body: again })).body.error.code).toBe('email_taken');
    expect((await t.call('POST', '/v1/ops/associations', { token: (await t.staffIn()).accessToken, body })).status).toBe(403);
  });
});
