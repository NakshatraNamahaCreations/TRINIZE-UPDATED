import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GATE_DEMO } from '../src/db/seed-gate.js';
import { testApp } from './helpers.js';

type Call = 'GET' | 'POST' | 'PUT' | 'DELETE';

describe('emergencies', () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let admin = '', ananya = '', rohit = '';
  const A = (m: Call, path: string, body?: unknown, token = admin) => t.call(m, `/v1/admin/${t.associationId}${path}`, { token, body });

  beforeAll(async () => {
    t = await testApp();
    admin = (await t.staffIn()).accessToken;
    ananya = (await t.signIn()).accessToken;
    rohit = (await t.signIn('9900112233')).accessToken; // owns T2-0704
  });
  afterAll(async () => { await t?.close(); });

  it('SOS: security and the office are told at once, and the incident is logged to its end', async () => {
    const guard = (await t.signIn(GATE_DEMO.guardPhone)).accessToken;
    const sos = await t.call('POST', '/v1/sos', { token: ananya, body: { kind: 'Medical', note: 'My father has collapsed' } });
    expect(sos.status).toBe(201);
    expect(sos.body).toMatchObject({ kind: 'Medical', by: 'Ananya Iyer', unit: 'T4-1108', place: 'T4-1108', status: 'Open' });
    // a panicked second tap is the same alarm
    expect((await t.call('POST', '/v1/sos', { token: ananya, body: { kind: 'Medical' } })).body.id).toBe(sos.body.id);
    for (const who of [guard, admin]) expect((await t.call('GET', '/v1/notifications', { token: who })).body[0]).toMatchObject({ title: 'SOS · Medical · T4-1108', body: 'Ananya Iyer: My father has collapsed' });
    expect((await t.call('GET', '/v1/emergency', { token: guard })).body.open[0].id).toBe(sos.body.id);
    expect((await t.call('GET', '/v1/emergency', { token: rohit })).body.open).toHaveLength(0); // a neighbour's alarm isn't theirs to see
    expect((await t.call('POST', `/v1/emergency/${sos.body.id}/ack`, { token: rohit })).status).toBe(403);
    expect((await t.call('POST', `/v1/emergency/${sos.body.id}/ack`, { token: guard })).body).toMatchObject({ status: 'Acknowledged', ackByName: 'Ramesh Kumar' });
    expect((await t.call('GET', '/v1/notifications', { token: ananya })).body[0].title).toBe('Help is on the way');
    expect((await A('POST', `/incidents/${sos.body.id}/resolve`, {})).body.error.code).toBe('say_what_happened');
    expect((await A('POST', `/incidents/${sos.body.id}/resolve`, { resolution: 'Ambulance arrived in 9 minutes; taken to Manipal.' })).body).toMatchObject({ status: 'Resolved', resolvedByName: 'Sanjana Rao' });
    expect((await A('GET', '/incidents')).body[0]).toMatchObject({ kind: 'Medical', status: 'Resolved', ackByName: 'Ramesh Kumar' });
    // a guard can raise one too
    expect((await t.call('POST', '/v1/sos', { token: guard, body: { kind: 'Security', note: 'Fight at the gate' } })).body).toMatchObject({ role: 'guard', place: 'Main gate' });
  });

  it('the incident log is the office’s: residents and other societies are shut out', async () => {
    expect((await A('GET', '/incidents', undefined, ananya)).status).toBe(403);
    expect((await A('GET', '/incidents/reach', undefined, rohit)).status).toBe(403);
    expect((await t.call('GET', `/v1/admin/${t.greenMeadows}/incidents`, { token: admin })).status).toBe(403);
    expect((await A('GET', '/incidents/reach')).body).toMatchObject({ residents: expect.any(Number), guards: expect.any(Number) });
  });

  it('the automation that was taken out of the product is gone, and billing and requests work without it', async () => {
    for (const path of ['/workflows', '/workflows/options', '/workflows/runs', '/workflows/summary', '/tasks']) expect((await A('GET', path)).status, path).toBe(404);
    const flat = (await A('GET', '/finance/units')).body[0].id;
    const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
    expect((await A('POST', '/finance/bills', { unitId: flat, chargeType: 'Parking', amount: 500, dueDate: today })).status).toBe(201);
    expect((await A('POST', '/finance/payments', { unitId: flat, amount: 500, mode: 'UPI' })).status).toBe(201);
    expect((await t.call('POST', '/v1/issues', { token: ananya, body: { title: 'Tap leaking in the kitchen', category: 'Plumbing', location: 'My flat', priority: 'Medium', via: 'form' } })).status).toBe(201);
  });
});
