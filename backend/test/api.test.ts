import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO } from '../src/db/seed.js';
import { testApp } from './helpers.js';

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t?.close(); });

describe('sign-in', () => {
  it('rejects malformed and unregistered numbers', async () => {
    expect((await t.call('POST', '/v1/auth/otp/request', { body: { phone: '1234567890' } })).status).toBe(400);
    const r = await t.call('POST', '/v1/auth/otp/request', { body: { phone: '9000000001' } });
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('not_registered');
  });

  it('signs in with the texted code, and only once', async () => {
    await t.call('POST', '/v1/auth/otp/request', { body: { phone: '9900112233' } });
    const code = t.sms.last('9900112233')!;
    expect(code).toMatch(/^\d{6}$/);
    const ok = await t.call('POST', '/v1/auth/otp/verify', { body: { phone: '9900112233', code } });
    expect(ok.status).toBe(200);
    expect(ok.body.user.name).toBe('Rohit Sharma');
    expect((await t.call('POST', '/v1/auth/otp/verify', { body: { phone: '9900112233', code } })).body.error.code).toBe('code_expired');
  });

  it('makes you wait before resending, and locks after five wrong codes', async () => {
    const phone = '9900445566';
    await t.call('POST', '/v1/auth/otp/request', { body: { phone } });
    expect((await t.call('POST', '/v1/auth/otp/request', { body: { phone } })).body.error.code).toBe('resend_wait');
    const right = t.sms.last(phone)!;
    const wrong = right === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) expect((await t.call('POST', '/v1/auth/otp/verify', { body: { phone, code: wrong } })).body.error.code).toBe('wrong_code');
    // even the right code is refused once the attempts are used up
    expect((await t.call('POST', '/v1/auth/otp/verify', { body: { phone, code: right } })).body.error.code).toBe('too_many_attempts');
  });

  it('rotates refresh tokens and treats a reused one as stolen', async () => {
    const s = await t.signIn(DEMO.residentPhone);
    const r1 = await t.call('POST', '/v1/auth/refresh', { body: { refreshToken: s.refreshToken } });
    expect(r1.status).toBe(200);
    // the old token again → every session for the user is revoked, including the new one
    expect((await t.call('POST', '/v1/auth/refresh', { body: { refreshToken: s.refreshToken } })).status).toBe(401);
    expect((await t.call('POST', '/v1/auth/refresh', { body: { refreshToken: r1.body.refreshToken } })).status).toBe(401);
  });

  it('needs a token for resident data', async () => {
    expect((await t.call('GET', '/v1/me')).status).toBe(401);
    expect((await t.call('GET', '/v1/me', { token: 'not-a-jwt' })).status).toBe(401);
  });
});

describe('resident', () => {
  let token = '';
  beforeAll(async () => { token = (await t.signIn(DEMO.residentPhone)).accessToken; });

  it('knows who and where you are', async () => {
    const r = await t.call('GET', '/v1/me', { token });
    expect(r.body.unit.code).toBe('T4-1108');
    expect(r.body.role).toBe('Owner');
    expect(r.body.society.short).toBe('Prestige Lakeside');
  });

  it('records an acknowledgement once', async () => {
    const list = (await t.call('GET', '/v1/announcements', { token })).body;
    const water = list.find((a: { ref: string }) => a.ref === 'AN-118');
    expect(water.acked).toBe(false);
    await t.call('POST', `/v1/announcements/${water.id}/ack`, { token });
    await t.call('POST', `/v1/announcements/${water.id}/ack`, { token });
    expect((await t.call('GET', '/v1/announcements', { token })).body.find((a: { ref: string }) => a.ref === 'AN-118').acked).toBe(true);
  });

  it('splits events into upcoming and past by when they end', async () => {
    const up = (await t.call('GET', '/v1/events', { token })).body;
    const past = (await t.call('GET', '/v1/events?scope=past', { token })).body;
    expect(up.map((e: { title: string }) => e.title)).not.toContain('Society Foundation Day');
    expect(past.map((e: { title: string }) => e.title)).toContain('Society Foundation Day');
    // ordered by start time
    const starts = up.map((e: { startsAt: string }) => new Date(e.startsAt).getTime());
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
  });

  it('gives a seat while there is one, then the waitlist', async () => {
    const up = (await t.call('GET', '/v1/events', { token })).body;
    const full = up.find((e: { title: string }) => e.title === 'Badminton Court Finals');
    const open = up.find((e: { title: string }) => e.title === 'Yoga by the Lake');
    expect((await t.call('POST', `/v1/events/${full.id}/rsvp`, { token })).body.status).toBe('Waitlist');
    expect((await t.call('POST', `/v1/events/${open.id}/rsvp`, { token })).body.status).toBe('Going');
    const again = (await t.call('GET', '/v1/events', { token })).body.find((e: { id: string }) => e.id === open.id);
    expect(again.going).toBe(39);
    expect(again.mine).toBe('Going');
  });

  it('allows one vote per flat, owners-only polls, and nothing after closing', async () => {
    const polls = (await t.call('GET', '/v1/polls', { token })).body;
    const yoga = polls.find((p: { question: string }) => p.question.startsWith('Best timing'));
    const cctv = polls.find((p: { question: string }) => p.question.startsWith('Approve CCTV'));
    const old = polls.find((p: { question: string }) => p.question.startsWith('Festival'));
    expect(old.closed).toBe(true);
    expect((await t.call('POST', `/v1/polls/${yoga.id}/vote`, { token, body: { optionId: yoga.options[0].id } })).status).toBe(200);
    // Karthik lives in the same flat — the flat has already voted
    const karthik = (await t.signIn(DEMO.tenantPhone)).accessToken;
    const dup = await t.call('POST', `/v1/polls/${yoga.id}/vote`, { token: karthik, body: { optionId: yoga.options[1].id } });
    expect(dup.body.error.code).toBe('already_voted');
    // and as a family member he can't vote in an owners-only poll
    expect((await t.call('POST', `/v1/polls/${cctv.id}/vote`, { token: karthik, body: { optionId: cctv.options[0].id } })).status).toBe(403);
    expect((await t.call('POST', `/v1/polls/${old.id}/vote`, { token, body: { optionId: old.options[0].id } })).body.error.code).toBe('poll_closed');
    const after = (await t.call('GET', '/v1/polls', { token: karthik })).body.find((p: { id: string }) => p.id === yoga.id);
    expect(after.myOptionId).toBe(yoga.options[0].id);
    expect(after.options[0].votes).toBe(49);
  });

  it('returns the directory in its three groups', async () => {
    const d = (await t.call('GET', '/v1/directory', { token })).body;
    expect(d.emergency.map((c: { phone: string }) => c.phone)).toEqual(['+91 80 4128 7001', '108', '101']);
  });
});

describe('issues, end to end', () => {
  it('flows from the resident to the society office and back', async () => {
    const resident = (await t.signIn(DEMO.residentPhone)).accessToken;
    const created = await t.call('POST', '/v1/issues', { token: resident, body: {
      title: 'Bathroom ceiling leaking', details: 'Started after the rain last night', category: 'Plumbing', location: 'My flat (T4-1108)', priority: 'High', via: 'form',
    } });
    expect(created.status).toBe(201);
    const ref = created.body.ref as string;
    expect(ref).toMatch(/^ISS-\d+$/);
    expect(created.body.updates[0].text).toBe('Started after the rain last night');
    expect(created.body.slaState).toBe('ok');

    const admin = (await t.staffIn()).accessToken;
    const vendors = (await t.call('GET', `/v1/admin/${t.associationId}/vendors`, { token: admin })).body;
    const plumber = vendors.find((v: { name: string }) => v.name === 'Sunrise Plumbing Co.');
    // the rules: can't skip acknowledging, can't assign without a vendor
    expect((await t.call('POST', `/v1/admin/${t.associationId}/issues/${ref}/status`, { token: admin, body: { to: 'Resolved' } })).body.error.code).toBe('bad_transition');
    await t.call('POST', `/v1/admin/${t.associationId}/issues/${ref}/status`, { token: admin, body: { to: 'Acknowledged' } });
    expect((await t.call('POST', `/v1/admin/${t.associationId}/issues/${ref}/status`, { token: admin, body: { to: 'Assigned' } })).body.error.code).toBe('vendor_required');
    await t.call('POST', `/v1/admin/${t.associationId}/issues/${ref}/status`, { token: admin, body: { to: 'Assigned', vendorId: plumber.id } });
    await t.call('POST', `/v1/admin/${t.associationId}/issues/${ref}/notes`, { token: admin, body: { text: 'Quote ₹1,200 — within limit' } });

    const seen = (await t.call('GET', `/v1/issues/${ref}`, { token: resident })).body;
    expect(seen.status).toBe('Assigned');
    expect(seen.vendor).toBe('Sunrise Plumbing Co.');
    expect(seen.timeline.map((x: { status: string }) => x.status)).toEqual(['Submitted', 'Acknowledged', 'Assigned']);
    expect(seen.internalNotes).toBeUndefined(); // staff notes never reach residents

    // a neighbour can't open it
    const rohit = (await t.signIn('9900778899')).accessToken;
    expect((await t.call('GET', `/v1/issues/${ref}`, { token: rohit })).status).toBe(403);

    // resolved → resident reopens with a reason
    await t.call('POST', `/v1/admin/${t.associationId}/issues/${ref}/status`, { token: admin, body: { to: 'Resolved', note: 'Pipe resealed' } });
    const reopened = await t.call('POST', `/v1/issues/${ref}/reopen`, { token: resident, body: { reason: 'Still dripping' } });
    expect(reopened.body.status).toBe('Acknowledged');

    const auditTrail = (await t.call('GET', `/v1/admin/${t.associationId}/audit`, { token: admin })).body.map((a: { action: string }) => a.action);
    expect(auditTrail.some((a: string) => a.includes(`${ref} reopened by resident`))).toBe(true);
  });

  it('keeps residents out of the admin console', async () => {
    const resident = (await t.signIn(DEMO.residentPhone)).accessToken;
    expect((await t.call('GET', `/v1/admin/${t.associationId}/issues`, { token: resident })).status).toBe(403);
    const op = (await t.staffIn(DEMO.operatorEmail, DEMO.operatorPassword)).accessToken;
    expect((await t.call('GET', `/v1/admin/${t.associationId}/issues`, { token: op })).status).toBe(200); // operators reach every society
    expect((await t.call('POST', '/v1/auth/staff/login', { body: { email: DEMO.adminEmail, password: 'wrong' } })).status).toBe(401);
  });

  it('publishes an announcement residents can then see', async () => {
    const admin = (await t.staffIn()).accessToken;
    const r = await t.call('POST', `/v1/admin/${t.associationId}/announcements`, { token: admin, body: { title: 'Lift 2 maintenance', body: 'Lift 2 in Tower 1 is off on Saturday morning.', priority: 'High', requiresAck: true } });
    expect(r.status).toBe(201);
    expect(r.body.ref).toBe('AN-119');
    expect(r.body.byName).toBe('Sanjana Rao (Secretary)');
    const resident = (await t.signIn(DEMO.residentPhone)).accessToken;
    expect((await t.call('GET', '/v1/announcements', { token: resident })).body[0].ref).toBe('AN-119');
  });

  it('gives a resident their own impact figures, counted from what they actually did', async () => {
    const { accessToken } = await t.signIn();
    const call = (m: 'GET' | 'POST' | 'DELETE', url: string, body?: unknown) => t.call(m, url, { token: accessToken, body });
    const first = (await call('POST', '/v1/me/impact')).body;
    // opening the app today is one day, a streak of one, and the same again when asked twice
    expect(first).toMatchObject({ days: 1, streak: 1, best: 1 });
    expect(first.last14).toHaveLength(14);
    expect(first.last14[13]).toBe(true);
    expect(first.last14.slice(0, 13).every((x: boolean) => !x)).toBe(true);
    expect((await call('POST', '/v1/me/impact')).body).toMatchObject({ days: 1, streak: 1, best: 1 });
    // a question to the assistant is counted and listed; clearing the history takes it away again
    await call('POST', '/v1/assistant/chat', { text: 'What are the pool timings?' });
    const asked = (await call('POST', '/v1/me/impact')).body;
    expect(asked.chats).toBe(first.chats + 1);
    expect(asked.recentQuestions[0]).toBe('What are the pool timings?');
    await call('DELETE', '/v1/assistant/history');
    expect((await call('POST', '/v1/me/impact')).body).toMatchObject({ chats: 0, recentQuestions: [] });
    expect((await t.call('POST', '/v1/me/impact')).status).toBe(401);
  });
});

describe('an update that changes nothing', () => {
  it('is turned down politely by every "save" that takes optional fields — never a server error', async () => {
    const t = await testApp();
    try {
      const admin = (await t.staffIn()).accessToken;
      const A = (m: 'GET' | 'PUT', path: string, body?: unknown) => t.call(m, `/v1/admin/${t.associationId}${path}`, { token: admin, body });
      const flat = (await A('GET', '/units')).body[0].id, vendor = (await A('GET', '/vendor-list')).body[0].id;
      for (const path of [`/finance/units/${flat}`, `/vendor-list/${vendor}`, `/owners/units/${flat}`]) {
        const r = await A('PUT', path, {});
        expect([r.status, r.body.error.code], path).toEqual([400, 'nothing_to_change']);
      }
      // and a real change still saves
      expect((await A('PUT', `/vendor-list/${vendor}`, { contact: 'Front desk' })).body.contact).toBe('Front desk');
    } finally { await t.close(); }
  });
});
