import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chatMessages, users } from '../src/db/schema.js';
import { DEMO } from '../src/db/seed.js';
import { testApp } from './helpers.js';

describe('the office blocks a resident, or deletes one for good', () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let admin = '';
  const A = (m: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, token = admin) => t.call(m, `/v1/admin/${t.associationId}${path}`, { token, body });
  const row = async (name: string) => (await A('GET', '/users')).body.find((u: { name: string }) => u.name === name) as { userId: string; status: string } | undefined;

  beforeAll(async () => { t = await testApp(); admin = (await t.staffIn()).accessToken; });
  afterAll(async () => { await t?.close(); });

  it('a blocked resident is out of the whole app until unblocked', async () => {
    const rohit = await t.signIn('9900112233');
    const { userId } = (await row('Rohit Sharma'))!;
    expect((await t.call('GET', '/v1/me', { token: rohit.accessToken })).status).toBe(200);

    expect((await A('PUT', `/users/${userId}/standing`, { status: 'Blocked' })).body).toEqual({ status: 'Blocked' });
    expect((await row('Rohit Sharma'))!.status).toBe('Blocked');
    // the token they already hold stops working everywhere, with a reason the app can show…
    for (const path of ['/v1/me', '/v1/visits', '/v1/issues', '/v1/assistant/history']) {
      const r = await t.call('GET', path, { token: rohit.accessToken });
      expect(r.status, path).toBe(403);
      expect(r.body.error.code, path).toBe('account_blocked');
    }
    expect((await t.call('POST', '/v1/assistant/chat', { token: rohit.accessToken, body: { text: 'pool timings?' } })).status).toBe(403);
    // the screens that never look up a flat are closed too: notifications, the owner portal, uploads
    for (const path of ['/v1/notifications', '/v1/owner/me', '/v1/owner/dashboard', '/v1/frequent-visitors']) {
      const r = await t.call('GET', path, { token: rohit.accessToken });
      expect([r.status, r.body.error.code], path).toEqual([403, 'account_blocked']);
    }
    expect((await t.call('POST', '/v1/sos', { token: rohit.accessToken, body: { kind: 'Medical' } })).body.error.code).toBe('account_blocked');
    // …and their session cannot be renewed
    expect((await t.call('POST', '/v1/auth/refresh', { body: { refreshToken: rohit.refreshToken } })).status).toBe(401);
    // nobody else is affected
    expect((await t.call('GET', '/v1/me', { token: (await t.signIn()).accessToken })).status).toBe(200);

    // signing in again does not get them back in: the code is right, the answer is still no
    const arjun = (await row('Arjun Mehta'))!.userId;
    await A('PUT', `/users/${arjun}/standing`, { status: 'Blocked' });
    await t.call('POST', '/v1/auth/otp/request', { body: { phone: '9900778899' } });
    const tried = await t.call('POST', '/v1/auth/otp/verify', { body: { phone: '9900778899', code: t.sms.last('9900778899') } });
    expect([tried.status, tried.body.error.code]).toEqual([403, 'account_blocked']);
    expect(tried.body.accessToken).toBeUndefined();
    await A('PUT', `/users/${arjun}/standing`, { status: 'Active' });

    // unblocking gives the app back; the flat and its records were never touched
    await A('PUT', `/users/${userId}/standing`, { status: 'Active' });
    expect((await t.call('GET', '/v1/me', { token: rohit.accessToken })).body.unit.code).toBe('T2-0704');
    expect((await t.call('GET', '/v1/notifications', { token: rohit.accessToken })).status).toBe(200);
    expect((await t.call('GET', '/v1/owner/me', { token: rohit.accessToken })).status).toBe(200);
  });

  it('only the office can block, and not itself', async () => {
    const ananya = (await t.signIn()).accessToken;
    const { userId } = (await row('Rohit Sharma'))!;
    expect((await A('PUT', `/users/${userId}/standing`, { status: 'Blocked' }, ananya)).status).toBe(403);
    expect((await A('DELETE', `/users/${userId}`, undefined, ananya)).status).toBe(403);
    const me = (await row('Sanjana Rao'))!.userId;
    expect((await A('PUT', `/users/${me}/standing`, { status: 'Blocked' })).body.error.code).toBe('own_account');
    expect((await A('DELETE', `/users/${me}`)).body.error.code).toBe('own_account');
  });

  it('deleting a resident erases the account for good', async () => {
    const neha = (await t.signIn('9900445566')).accessToken;
    await t.call('POST', '/v1/assistant/chat', { token: neha, body: { text: 'What are the pool timings?' } });
    const { userId } = (await row('Neha Iyer'))!;
    expect((await t.db.select().from(chatMessages).where(eq(chatMessages.userId, userId))).length).toBeGreaterThan(0);

    expect((await A('DELETE', `/users/${userId}`)).status).toBe(204);
    // gone from the residents list, signed out, and nothing left that says who they were
    expect(await row('Neha Iyer')).toBeUndefined();
    expect((await t.call('GET', '/v1/me', { token: neha })).status).toBe(403);
    const [left] = await t.db.select().from(users).where(eq(users.id, userId));
    expect(left).toMatchObject({ name: 'Former resident', phone: null, email: null });
    expect(left!.deletedAt).toBeInstanceOf(Date);
    expect(await t.db.select().from(chatMessages).where(eq(chatMessages.userId, userId))).toHaveLength(0);
    expect((await A('GET', '/audit')).body[0].action).toContain('resident deleted permanently · Neha Iyer');
    // there is nothing to delete twice, and an id that was never a resident here is not found
    expect((await A('DELETE', `/users/${userId}`)).status).toBe(404);
    expect((await A('DELETE', '/users/00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });

  it('will not delete someone who also signs in to a console or the gate', async () => {
    // Karthik lives in T4-1108 and is also made a guard
    await A('POST', '/guards', { name: 'Karthik Iyer', phone: DEMO.tenantPhone, gate: 'Back gate' });
    const { userId } = (await row('Karthik Iyer'))!;
    expect((await A('DELETE', `/users/${userId}`)).body.error.code).toBe('on_team');
    expect(await row('Karthik Iyer')).toBeDefined();
  });
  it('the office arranges its towers, and the order is kept', async () => {
    const start = (await A('GET', '/towers')).body.order as string[];
    expect(start).toEqual(['Tower 1', 'Tower 2', 'Tower 3', 'Tower 4', 'Tower 5']); // by name until someone arranges them
    const wanted = ['Tower 4', 'Tower 1', 'Tower 5'];
    // the ones placed come first, in that order; the rest follow by name
    expect((await A('PUT', '/towers/order', { towers: wanted })).body.order).toEqual(['Tower 4', 'Tower 1', 'Tower 5', 'Tower 2', 'Tower 3']);
    expect((await A('GET', '/towers')).body.order).toEqual(['Tower 4', 'Tower 1', 'Tower 5', 'Tower 2', 'Tower 3']);
    // a tower the society does not have, or one named twice, is ignored
    expect((await A('PUT', '/towers/order', { towers: ['Tower 9', 'Tower 2', 'Tower 2'] })).body.order[0]).toBe('Tower 2');
    // a new block takes its place after the arranged ones
    await A('POST', '/units', { units: [{ code: 'E-101', tower: 'E-BLOCK', label: 'E-BLOCK, Flat 101', area: 0, flatType: '', occupancy: 'Vacant' }] });
    expect((await A('GET', '/towers')).body.order).toEqual(['Tower 2', 'E-BLOCK', 'Tower 1', 'Tower 3', 'Tower 4', 'Tower 5']);
    // residents have no say in it
    const ananya = (await t.signIn()).accessToken;
    expect((await A('PUT', '/towers/order', { towers: wanted }, ananya)).status).toBe(403);
  });
});
