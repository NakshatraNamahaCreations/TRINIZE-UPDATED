import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { eq } from 'drizzle-orm';
import { visits } from '../src/db/schema.js';
import { expireSelfCheckins } from '../src/lib/checkin-expiry.js';
import { GATE_DEMO } from '../src/db/seed-gate.js';
import { testApp } from './helpers.js';

/** what a socket was sent, in order, with a way to wait for the next line */
function inbox(ws: WebSocket) {
  const got: string[] = [], waiting: ((s: string) => void)[] = [];
  ws.on('message', d => { const s = String(d), w = waiting.shift(); if (w) w(s); else got.push(s); });
  const next = () => new Promise<string>((resolve, reject) => {
    const s = got.shift();
    if (s !== undefined) return resolve(s);
    const timer = setTimeout(() => reject(new Error('nothing arrived on the socket')), 4000);
    waiting.push(x => { clearTimeout(timer); resolve(x); });
  });
  return { next, json: async () => JSON.parse(await next()), quiet: () => got.length === 0 };
}
const closed = (ws: WebSocket) => new Promise<number>(resolve => ws.on('close', code => resolve(code)));

describe('the gate, live over WebSocket', () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let guard = '', ananya = '', token = '', home = '';
  const open: WebSocket[] = [];
  let base = '';
  // a real connection to a real port: the handshake goes through everything a phone's would.
  // The inbox is attached before the socket opens — the server's first line can arrive with the handshake itself.
  const socket = (path: string) => new Promise<{ ws: WebSocket; box: ReturnType<typeof inbox>; gone: Promise<number> }>((resolve, reject) => {
    const ws = new WebSocket(base + path), box = inbox(ws), gone = closed(ws);
    open.push(ws);
    ws.once('open', () => resolve({ ws, box, gone }));
    ws.once('error', reject);
  });

  beforeAll(async () => {
    t = await testApp();
    await t.app.listen({ port: 0, host: '127.0.0.1' });
    base = 'ws://127.0.0.1:' + (t.app.server.address() as AddressInfo).port;
    guard = (await t.signIn(GATE_DEMO.guardPhone)).accessToken;
    ananya = (await t.signIn()).accessToken;
    const admin = (await t.staffIn()).accessToken;
    token = (await t.call('POST', `/v1/admin/${t.associationId}/gate-codes`, { token: admin, body: { gate: 'Main gate' } })).body.url.split('/').pop();
    home = (await t.call('GET', '/v1/gate/units?q=1108', { token: guard })).body[0].id;
  });
  afterAll(async () => { open.forEach(ws => ws.terminate()); await t?.close(); });

  it('tells the visitor and the guard the moment the flat answers — nobody refreshes', async () => {
    // the guard's screen is listening before anyone arrives
    const { ws: post, box: guardBox } = await socket('/v1/gate/live');
    post.send(JSON.stringify({ token: guard }));
    expect(await guardBox.json()).toEqual({ type: 'ready' });

    // a visitor checks in by QR: the guard's screen hears at once
    const made = (await t.call('POST', `/v1/checkin/${token}/visits`, { body: { visitorType: 'Delivery', partner: 'Swiggy', name: 'Rider', phone: '9822200031', unitId: home } })).body;
    expect(await guardBox.json()).toEqual({ type: 'changed' });

    // the visitor's page opens its socket and is told where things stand
    const { box: pageBox } = await socket(`/v1/checkin-status/${made.ticket}/live`);
    expect(await pageBox.json()).toMatchObject({ status: 'Pending', ref: made.ref });

    // the resident approves in the app → pushed to both, with no request from either
    const mine = (await t.call('GET', '/v1/visits', { token: ananya })).body.pending.find((v: { name: string }) => v.name === 'Rider');
    await t.call('POST', `/v1/visits/${mine.id}/decision`, { token: ananya, body: { decision: 'approve' } });
    const answer = await pageBox.json();
    expect(answer).toMatchObject({ status: 'Approved', ref: made.ref });
    expect(answer.decidedByName).toBeUndefined(); // the push carries no more than the page may ask for
    expect(JSON.stringify(answer)).not.toContain(made.ticket);
    expect(await guardBox.json()).toEqual({ type: 'changed' });

    // the guard lets them in → the visitor's page hears that too
    await t.call('POST', `/v1/gate/visits/${mine.id}/enter`, { token: guard, body: {} });
    expect(await pageBox.json()).toMatchObject({ status: 'Inside' });
    expect(await guardBox.json()).toEqual({ type: 'changed' });
  });

  it('a ticket hears only about itself', async () => {
    const a = (await t.call('POST', `/v1/checkin/${token}/visits`, { body: { name: 'First Guest', phone: '9822200032', unitId: home } })).body;
    const b = (await t.call('POST', `/v1/checkin/${token}/visits`, { body: { name: 'Second Guest', phone: '9822200033', unitId: home } })).body;
    const { box: boxA } = await socket(`/v1/checkin-status/${a.ticket}/live`);
    const { box: boxB } = await socket(`/v1/checkin-status/${b.ticket}/live`);
    expect((await boxA.json()).name).toBe('First Guest');
    expect((await boxB.json()).name).toBe('Second Guest');
    expect((await t.call('POST', `/v1/checkin-status/${b.ticket}/cancel`)).body.status).toBe('Cancelled');
    expect(await boxB.json()).toMatchObject({ status: 'Cancelled', name: 'Second Guest' });
    expect(boxA.quiet()).toBe(true);
  });

  it('a request nobody answers expires after ten minutes — and cannot be approved late', async () => {
    const fresh = (await t.call('POST', `/v1/checkin/${token}/visits`, { body: { name: 'Slow Answer', phone: '9822200035', unitId: home } })).body;
    expect(fresh.expiresInMs).toBeGreaterThan(9 * 60_000);
    expect(fresh.expiresInMs).toBeLessThanOrEqual(10 * 60_000);
    const { box } = await socket(`/v1/checkin-status/${fresh.ticket}/live`);
    expect((await box.json()).status).toBe('Pending');
    const mine = (await t.call('GET', '/v1/visits', { token: ananya })).body.pending.find((v: { name: string }) => v.name === 'Slow Answer');

    // eleven minutes go by
    await t.db.update(visits).set({ createdAt: new Date(Date.now() - 11 * 60_000) }).where(eq(visits.id, mine.id));
    // even before the sweep runs, everyone already sees it as expired and nobody can act on it
    expect((await t.call('GET', '/v1/checkin-status/' + fresh.ticket)).body).toMatchObject({ status: 'Expired', expiresInMs: 0 });
    expect((await t.call('GET', '/v1/visits/' + mine.id, { token: ananya })).body.status).toBe('Expired');
    expect((await t.call('POST', `/v1/checkin-status/${fresh.ticket}/cancel`)).body.error.code).toBe('not_cancellable');
    // approving late is refused — by the flat, and by the guard on the flat's word — and that settles it
    expect((await t.call('POST', `/v1/visits/${mine.id}/decision`, { token: ananya, body: { decision: 'approve' } })).body.error.code).toBe('request_expired');
    expect(await box.json()).toMatchObject({ status: 'Expired' }); // pushed to the visitor's page
    expect((await t.call('POST', `/v1/gate/visits/${mine.id}/decision`, { token: guard, body: { decision: 'approve' } })).body.error.code).toBe('request_expired');
    expect((await t.call('POST', `/v1/gate/visits/${mine.id}/enter`, { token: guard, body: {} })).body.error.code).toBe('not_approved');
    // it has left both waiting lists and sits in the flat's history
    const lists = (await t.call('GET', '/v1/visits', { token: ananya })).body;
    expect(lists.pending.some((v: { id: string }) => v.id === mine.id)).toBe(false);
    expect(lists.history.find((v: { id: string }) => v.id === mine.id).status).toBe('Expired');
    expect((await t.call('GET', '/v1/gate/visits?tab=waiting', { token: guard })).body.some((v: { id: string }) => v.id === mine.id)).toBe(false);
    expect(await expireSelfCheckins(t.db)).toBe(0); // nothing left to sweep

    // the same number can ask again at once; an entry the guard typed in does not expire this way
    expect((await t.call('POST', `/v1/checkin/${token}/visits`, { body: { name: 'Slow Answer', phone: '9822200035', unitId: home } })).status).toBe(201);
    const byGuard = (await t.call('POST', '/v1/gate/visits', { token: guard, body: { visitorType: 'Guest', name: 'Walk In', unitId: home } })).body;
    await t.db.update(visits).set({ createdAt: new Date(Date.now() - 11 * 60_000) }).where(eq(visits.id, byGuard.id));
    expect(await expireSelfCheckins(t.db)).toBe(0);
    expect((await t.call('POST', `/v1/visits/${byGuard.id}/decision`, { token: ananya, body: { decision: 'approve' } })).body.status).toBe('Approved');
  });

  it('gives nothing to a socket that cannot say who it is', async () => {
    // a ticket nobody was given
    expect(await (await socket(`/v1/checkin-status/${'x'.repeat(32)}/live`)).gone).toBe(4404);
    // not a guard: a resident's token, then no token at all
    const { ws: resident, box: residentBox, gone } = await socket('/v1/gate/live');
    resident.send(JSON.stringify({ token: ananya }));
    expect(await gone).toBe(4401);
    const { ws: junk, gone: junkGone } = await socket('/v1/gate/live');
    junk.send('hello');
    expect(await junkGone).toBe(4401);
    // and neither heard about anything on the way out
    await t.call('POST', `/v1/checkin/${token}/visits`, { body: { name: 'Third Guest', phone: '9822200034', unitId: home } });
    expect(residentBox.quiet()).toBe(true);
  });
});
