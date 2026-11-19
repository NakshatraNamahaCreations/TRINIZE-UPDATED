import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from './helpers.js';

/* What the society console used to show from built-in values, and now reads from the server. */
describe('the console names its own society, counts gratitude notes, and the auto-hold rule is real', () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let admin = '', ananya = '', rohit = '';
  const A = (m: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, token = admin) => t.call(m, `/v1/admin/${t.associationId}${path}`, { token, body });
  const BORDERLINE = 'Is the new plumber reliable or a scammer?';

  beforeAll(async () => {
    t = await testApp();
    admin = (await t.staffIn()).accessToken;
    ananya = (await t.signIn()).accessToken;
    rohit = (await t.signIn('9900112233')).accessToken;
  });
  afterAll(async () => { await t?.close(); });

  it('tells the console which society it is running', async () => {
    expect((await A('GET', '/staff/me')).body.society).toEqual({ name: 'Prestige Lakeside Habitat', short: expect.any(String), city: 'Bengaluru' });
    expect((await A('GET', '/staff/me', undefined, ananya)).status).toBe(403);
  });

  it('counts the gratitude notes that were delivered', async () => {
    const before = (await A('GET', '/stats')).body.gratitudes;
    expect(typeof before).toBe('number');
    await t.call('POST', '/v1/gratitudes', { token: ananya, body: { text: 'Thanks for the electrician tip!', category: 'Help received', toLabel: 'The whole community' } });
    expect((await A('GET', '/stats')).body.gratitudes).toBe(before + 1);
    // residents cannot read the office's figures
    expect((await A('GET', '/stats', undefined, ananya)).status).toBe(403);
  });

  it('auto-hold is saved, and decides whether a borderline post waits for a moderator', async () => {
    // as shipped: borderline text is held, visible only to its author
    expect((await A('GET', '/ai-settings')).body.autoHold).toBe('Medium & above');
    const held = (await t.call('POST', '/v1/posts', { token: rohit, body: { text: BORDERLINE, confirm: true } })).body;
    expect(held.state).toBe('held');
    const queueBefore = (await A('GET', '/moderation?state=open')).body.length;

    // the office relaxes it: saved on the server, and kept across a re-read
    expect((await A('PUT', '/ai-settings', { autoHold: 'High severity' })).body.autoHold).toBe('High severity');
    expect((await A('GET', '/ai-settings')).body).toMatchObject({ autoHold: 'High severity', qna: true });
    expect((await A('PUT', '/ai-settings', { autoHold: 'Everything' })).status).toBe(400);

    // the author is still warned first; once they confirm, the post is up at once — and still queued for a moderator to look at
    expect((await t.call('POST', '/v1/posts', { token: rohit, body: { text: BORDERLINE } })).body.error.code).toBe('needs_review');
    const up = (await t.call('POST', '/v1/posts', { token: rohit, body: { text: BORDERLINE, confirm: true } })).body;
    expect(up.state).toBe('published');
    expect((await t.call('GET', '/v1/posts', { token: ananya })).body.some((p: { id: string }) => p.id === up.id)).toBe(true);
    const queue = (await A('GET', '/moderation?state=open')).body;
    expect(queue.length).toBe(queueBefore + 1);
    // a moderator can still take it down
    const item = queue.find((m: { reason: string }) => m.reason.includes('already visible'));
    expect((await A('POST', `/moderation/${item.id}/action`, { action: 'Hidden' })).status).toBe(200);
    expect((await t.call('GET', '/v1/posts', { token: ananya })).body.some((p: { id: string }) => p.id === up.id)).toBe(false);

    // tightening it again holds the next one
    await A('PUT', '/ai-settings', { autoHold: 'Medium & above' });
    expect((await t.call('POST', '/v1/posts', { token: rohit, body: { text: BORDERLINE, confirm: true } })).body.state).toBe('held');
  });
});
