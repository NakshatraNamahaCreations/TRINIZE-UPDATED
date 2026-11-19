import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GATE_DEMO } from '../src/db/seed-gate.js';
import { DEMO } from '../src/db/seed.js';
import { testApp } from './helpers.js';

describe('visitor and delivery management', () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let guard = '', ananya = '', rohit = '', admin = '';
  let home = '';
  const G = (m: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown) => t.call(m, url, { token: guard, body });
  const R = (m: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown, token = ananya) => t.call(m, url, { token, body });
  const A = (m: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown) => t.call(m, `/v1/admin/${t.associationId}${path}`, { token: admin, body });

  beforeAll(async () => {
    t = await testApp();
    guard = (await t.signIn(GATE_DEMO.guardPhone)).accessToken;
    ananya = (await t.signIn()).accessToken;
    rohit = (await t.signIn('9900112233')).accessToken;
    admin = (await t.staffIn()).accessToken;
    home = (await G('GET', '/v1/gate/units?q=1108')).body[0].id;
  });
  afterAll(async () => { await t?.close(); });

  it('knows the guard, and keeps everyone else out of the gate screens', async () => {
    const me = await G('GET', '/v1/gate/me');
    expect(me.body).toMatchObject({ society: 'Prestige Lakeside Habitat', gate: 'Main gate', parcels: 1 });
    expect(me.body.user.name).toBe('Ramesh Kumar');
    expect((await R('GET', '/v1/gate/me')).status).toBe(403);
    expect((await t.call('GET', '/v1/gate/me', { token: admin })).status).toBe(403);
    // a guard is not a resident and not the office
    expect((await G('GET', '/v1/visits')).status).toBe(403);
    expect((await G('GET', `/v1/admin/${t.associationId}/visits`)).status).toBe(403);
    expect((await G('GET', `/v1/admin/${t.associationId}/issues`)).status).toBe(403);
  });

  it('finds a flat by number or resident name, without exposing phone numbers', async () => {
    const byName = (await G('GET', '/v1/gate/units?q=ananya')).body;
    expect(byName[0]).toMatchObject({ code: 'T4-1108' });
    expect(byName[0].residents).toContain('Ananya Iyer');
    expect(JSON.stringify(byName)).not.toContain(DEMO.residentPhone);
  });

  it('guest: guard enters, flat is asked, resident approves, in, out', async () => {
    const made = await G('POST', '/v1/gate/visits', { visitorType: 'Guest', name: 'Vikram Nair', phone: '9811122233', unitId: home, purpose: 'Dinner', vehicle: 'ka 05 mn 4321', people: 2 });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ status: 'Pending', unit: 'T4-1108', vehicle: 'KA05MN4321', gate: 'Main gate', residentsToAsk: 2 });
    const id = made.body.id;
    // both people in the flat are told; the neighbour is not
    const note = (await R('GET', '/v1/notifications')).body[0];
    expect(note).toMatchObject({ kind: 'visitors', title: 'Vikram Nair is at the gate', href: '/gate/' + id });
    expect((await R('GET', '/v1/visits')).body.pending.map((v: { id: string }) => v.id)).toEqual([id]);
    expect((await R('GET', '/v1/visits', undefined, rohit)).body.pending).toHaveLength(0);
    expect((await R('POST', `/v1/visits/${id}/decision`, { decision: 'approve' }, rohit)).status).toBe(404);
    // not before the flat answers
    expect((await G('POST', `/v1/gate/visits/${id}/enter`)).body.error.code).toBe('not_approved');
    expect((await R('POST', `/v1/visits/${id}/decision`, { decision: 'gate' })).body.error.code).toBe('not_a_delivery');
    expect((await R('POST', `/v1/visits/${id}/decision`, { decision: 'approve' })).body).toMatchObject({ status: 'Approved', decidedVia: 'resident', decidedByName: 'Ananya Iyer' });
    expect((await R('POST', `/v1/visits/${id}/decision`, { decision: 'reject' })).body.error.code).toBe('already_decided');
    const inside = (await G('POST', `/v1/gate/visits/${id}/enter`, { photoUrl: 'http://api.test/files/v.jpg' })).body;
    expect(inside).toMatchObject({ status: 'Inside', guardName: 'Ramesh Kumar', gate: 'Main gate', photoUrl: 'http://api.test/files/v.jpg' });
    expect(inside.enteredAt).toBeTruthy();
    expect((await G('GET', '/v1/gate/visits?tab=inside')).body.map((v: { id: string }) => v.id)).toContain(id);
    const left = (await G('POST', `/v1/gate/visits/${id}/exit`)).body;
    expect(left).toMatchObject({ status: 'Left', exitGuardName: 'Ramesh Kumar' });
    expect((await G('POST', `/v1/gate/visits/${id}/exit`)).body.error.code).toBe('not_inside');
    // a repeat visitor is recognised next time
    const again = (await G('GET', '/v1/gate/lookup?phone=9811122233')).body;
    expect(again).toMatchObject({ visits: 1, watch: null });
    expect(again.last).toMatchObject({ name: 'Vikram Nair', vehicle: 'KA05MN4321' });
    // …with the photo on file, what he came for, and the flat he went to — so none of it is typed again
    expect(again.last).toMatchObject({ visitorType: 'Guest', purpose: 'Dinner', photoUrl: 'http://api.test/files/v.jpg' });
    expect(again.flats).toMatchObject([{ id: home, code: 'T4-1108' }]);
    expect(again.flats[0].residents.length).toBe(2);
    // the next day he is logged with no new photo: the entry carries the one on file
    const next = (await G('POST', '/v1/gate/visits', { visitorType: 'Guest', name: 'Vikram Nair', phone: '9811122233', unitId: home })).body;
    expect(next).toMatchObject({ status: 'Pending', photoUrl: 'http://api.test/files/v.jpg' });
    expect((await G('POST', `/v1/gate/visits/${next.id}/decision`, { decision: 'reject' })).body.status).toBe('Rejected');
  });

  it('a rejected visitor is not let in', async () => {
    const id = (await G('POST', '/v1/gate/visits', { visitorType: 'Vendor', name: 'Water purifier sales', unitId: home })).body.id;
    expect((await R('POST', `/v1/visits/${id}/decision`, { decision: 'reject' })).body.status).toBe('Rejected');
    expect((await G('POST', `/v1/gate/visits/${id}/enter`)).body.error.code).toBe('not_approved');
  });

  it('delivery left at the gate: kept by security, collected with the code the resident holds', async () => {
    const made = (await G('POST', '/v1/gate/visits', { visitorType: 'Delivery', name: 'Courier', partner: 'Flipkart', deliveryType: 'Courier', unitId: home })).body;
    expect(made).toMatchObject({ kind: 'delivery', status: 'Pending', partner: 'Flipkart' });
    expect((await R('GET', '/v1/notifications')).body[0].title).toBe('Flipkart · courier delivery at the gate');
    const kept = (await R('POST', `/v1/visits/${made.id}/decision`, { decision: 'gate' })).body;
    expect(kept.status).toBe('AtGate');
    expect(kept.collectCode).toMatch(/^\d{4}$/);
    // the rider is still at the gate: the parcel stays on the guard's waiting list until it is taken
    expect((await G('GET', '/v1/gate/visits?tab=waiting')).body.some((v: { id: string }) => v.id === made.id)).toBe(true);
    expect((await G('GET', '/v1/gate/visits?tab=parcels')).body.some((v: { id: string }) => v.id === made.id)).toBe(false);
    // the guard never sees the code
    const desk = (await G('POST', `/v1/gate/visits/${made.id}/keep`, { proofUrl: 'http://api.test/files/p.jpg' })).body;
    expect(desk.keptAt).toBeTruthy();
    expect(desk.collectCode).toBeUndefined();
    expect((await G('GET', '/v1/gate/visits?tab=parcels')).body.some((v: { id: string }) => v.id === made.id)).toBe(true);
    const wrong = kept.collectCode === '0000' ? '1111' : '0000';
    expect((await G('POST', `/v1/gate/visits/${made.id}/collect`, { code: wrong })).body.error.code).toBe('wrong_code');
    expect((await G('POST', `/v1/gate/visits/${made.id}/collect`, {})).body.error.code).toBe('proof_needed');
    expect((await G('POST', `/v1/gate/visits/${made.id}/collect`, { code: kept.collectCode })).body).toMatchObject({ status: 'Collected', collectedBy: 'Code shown', proofUrl: 'http://api.test/files/p.jpg' });
    expect((await R('GET', '/v1/visits')).body.history[0]).toMatchObject({ id: made.id, status: 'Collected' });
  });

  it('delivery allowed in: delivered with a proof photo', async () => {
    const id = (await G('POST', '/v1/gate/visits', { visitorType: 'Delivery', name: 'Rider', partner: 'Zomato', deliveryType: 'Food', unitId: home })).body.id;
    await R('POST', `/v1/visits/${id}/decision`, { decision: 'approve' });
    await G('POST', `/v1/gate/visits/${id}/enter`);
    expect((await G('POST', `/v1/gate/visits/${id}/exit`, { proofUrl: 'http://api.test/files/d.jpg' })).body).toMatchObject({ status: 'Left', proofUrl: 'http://api.test/files/d.jpg' });
  });

  it('pre-approved pass: the resident gets a code, the guard lets them in with it', async () => {
    const pass = await R('POST', '/v1/visits', { name: 'Divya Menon', phone: '9822233344', visitorType: 'Guest', people: 3 });
    expect(pass.status).toBe(201);
    expect(pass.body).toMatchObject({ status: 'Expected', unit: 'T4-1108' });
    expect(pass.body.passCode).toMatch(/^\d{6}$/);
    expect((await G('POST', '/v1/gate/pass', { code: pass.body.passCode === '000000' ? '111111' : '000000' })).status).toBe(404);
    const found = (await G('POST', '/v1/gate/pass', { code: pass.body.passCode })).body;
    expect(found).toMatchObject({ id: pass.body.id, name: 'Divya Menon', people: 3, unit: 'T4-1108' });
    expect(found.passCode).toBeUndefined();
    expect((await G('POST', `/v1/gate/visits/${found.id}/enter`)).body).toMatchObject({ status: 'Inside', decidedVia: 'pass' });
    // a pass works once
    expect((await G('POST', '/v1/gate/pass', { code: pass.body.passCode })).status).toBe(404);
    expect((await R('GET', '/v1/notifications')).body[0].title).toBe('Divya Menon has come in');

    // a pass that has not been used can be cancelled, and then no longer opens the gate
    const second = (await R('POST', '/v1/visits', { name: 'Plumber', visitorType: 'Vendor' })).body;
    expect((await R('POST', `/v1/visits/${second.id}/cancel`)).body.status).toBe('Cancelled');
    expect((await G('POST', '/v1/gate/pass', { code: second.passCode })).status).toBe(404);
    // sensible windows only
    expect((await R('POST', '/v1/visits', { name: 'Old', validUntil: new Date(Date.now() - 3600e3).toISOString() })).body.error.code).toBe('in_the_past');
    expect((await R('POST', '/v1/visits', { name: 'Long', validUntil: new Date(Date.now() + 60 * 864e5).toISOString() })).body.error.code).toBe('too_long');
    const later = (await R('POST', '/v1/visits', { name: 'Tomorrow', validFrom: new Date(Date.now() + 20 * 3600e3).toISOString(), validUntil: new Date(Date.now() + 30 * 3600e3).toISOString() })).body;
    expect((await G('POST', '/v1/gate/pass', { code: later.passCode })).body.error.code).toBe('pass_early');
  });

  it('frequent visitors: saved by the flat, waved through when they have standing permission', async () => {
    const list = (await R('GET', '/v1/frequent-visitors')).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'Lakshmi Devi', autoApprove: true });
    const seen = (await G('GET', `/v1/gate/lookup?phone=${GATE_DEMO.regularPhone}`)).body;
    expect(seen.regular[0]).toMatchObject({ unit: 'T4-1108', name: 'Lakshmi Devi', autoApprove: true });
    const v = (await G('POST', '/v1/gate/visits', { visitorType: 'Staff', name: 'Lakshmi Devi', phone: GATE_DEMO.regularPhone, unitId: home })).body;
    expect(v).toMatchObject({ status: 'Approved', decidedVia: 'frequent' });
    // one without standing permission still asks every time
    const driver = (await R('POST', '/v1/frequent-visitors', { name: 'Suresh (driver)', phone: '9833344455', visitorType: 'Staff' })).body;
    expect((await G('POST', '/v1/gate/visits', { visitorType: 'Staff', name: 'Suresh', phone: '9833344455', unitId: home })).body.status).toBe('Pending');
    expect((await R('DELETE', `/v1/frequent-visitors/${driver.id}`)).status).toBe(204);
    expect((await R('DELETE', `/v1/frequent-visitors/${list[0].id}`, undefined, rohit)).status).toBe(404);
  });

  it('block list turns people away; watch list warns', async () => {
    const blocked = await G('POST', '/v1/gate/visits', { visitorType: 'Vendor', name: 'Salesman', phone: GATE_DEMO.blockedPhone, unitId: home });
    expect(blocked.body).toMatchObject({ status: 'Rejected', decidedVia: 'watchlist', blocked: 'Entered Tower 2 claiming a false delivery' });
    expect((await R('POST', '/v1/visits', { name: 'Salesman', phone: GATE_DEMO.blockedPhone })).body.error.code).toBe('blocked');

    expect((await A('POST', '/watchlist', { name: 'No number', reason: 'Vague' })).body.error.code).toBe('nothing_to_match');
    const w = await A('POST', '/watchlist', { name: 'Grey Swift', vehicle: 'KA 03 ZZ 9999', reason: 'Seen loitering near the park', level: 'watch' });
    expect(w.status).toBe(201);
    expect(w.body).toMatchObject({ vehicle: 'KA03ZZ9999', level: 'watch', addedBy: 'Sanjana Rao' });
    const v = (await G('POST', '/v1/gate/visits', { visitorType: 'Cab', name: 'Cab driver', vehicle: 'ka03zz9999', unitId: home })).body;
    expect(v).toMatchObject({ status: 'Pending', flagged: 'Seen loitering near the park' });
    expect((await R('GET', '/v1/notifications')).body[0].body).toContain('Security note: Seen loitering near the park.');
    expect((await A('DELETE', `/watchlist/${w.body.id}`)).status).toBe(204);
    expect((await A('GET', '/watchlist')).body).toHaveLength(1);
  });

  it('nobody answers: the guard records what the flat said, or the office decides', async () => {
    const a = (await G('POST', '/v1/gate/visits', { visitorType: 'Guest', name: 'Uncle', unitId: home })).body.id;
    expect((await G('POST', `/v1/gate/visits/${a}/decision`, { decision: 'approve' })).body).toMatchObject({ status: 'Approved', decidedVia: 'guard', note: 'Confirmed with the flat by phone' });
    const b = (await G('POST', '/v1/gate/visits', { visitorType: 'Delivery', name: 'Courier', partner: 'Amazon', unitId: home })).body.id;
    const kept = (await A('POST', `/visits/${b}/decision`, { decision: 'gate', note: 'Resident travelling' })).body;
    expect(kept).toMatchObject({ status: 'AtGate', decidedVia: 'admin', decidedByName: 'Sanjana Rao' });
    expect(kept.collectCode).toBeUndefined();
    // the flat still gets its code
    expect((await R('GET', `/v1/visits/${b}`)).body.collectCode).toMatch(/^\d{4}$/);
    // no code to hand: a name is recorded instead
    await G('POST', `/v1/gate/visits/${b}/keep`);
    expect((await G('POST', `/v1/gate/visits/${b}/collect`, { collectedBy: 'Karthik Iyer' })).body).toMatchObject({ status: 'Collected', collectedBy: 'Karthik Iyer' });
  });

  it('emergency services go straight in, with no flat', async () => {
    const v = (await G('POST', '/v1/gate/visits', { visitorType: 'Emergency', name: 'Ambulance', vehicle: 'KA01G1088' })).body;
    expect(v).toMatchObject({ status: 'Approved', decidedVia: 'emergency', unit: null });
    expect((await G('POST', '/v1/gate/visits', { visitorType: 'Guest', name: 'No flat' })).body.error.code).toBe('unit_needed');
  });

  it('the office sees the whole register and manages guards', async () => {
    const all = (await A('GET', '/visits')).body;
    expect(all.length).toBeGreaterThan(10);
    expect(all[0].passCode).toBeUndefined();
    expect((await A('GET', '/visits?unit=0704')).body.every((v: { unit: string }) => v.unit === 'T2-0704')).toBe(true);
    expect((await A('GET', '/visits?kind=delivery&status=Collected')).body.length).toBeGreaterThanOrEqual(2);
    expect((await A('GET', '/visits?q=KA05MN')).body[0].name).toBe('Vikram Nair');
    const s = (await A('GET', '/visits/summary')).body;
    expect(s.inside_now).toBeGreaterThanOrEqual(1);
    expect(s.parcels_at_gate).toBe(1);
    expect(s.byType.find((x: { type: string }) => x.type === 'Delivery').n).toBeGreaterThanOrEqual(4);

    const made = await A('POST', '/guards', { name: 'Suresh Yadav', phone: '9844455566', gate: 'Gate 2' });
    expect(made.status).toBe(201);
    expect((await A('POST', '/guards', { name: 'Again', phone: '9844455566' })).body.error.code).toBe('already_guard');
    const g2 = await t.signIn('9844455566');
    expect((await t.call('GET', '/v1/gate/me', { token: g2.accessToken })).body.gate).toBe('Gate 2');
    expect((await A('PUT', `/guards/${made.body.id}`, { gate: 'Service gate' })).body.gate).toBe('Service gate');
    expect((await A('DELETE', `/guards/${made.body.id}`)).status).toBe(204);
    expect((await t.call('GET', '/v1/gate/me', { token: g2.accessToken })).status).toBe(403);
    expect((await A('GET', '/guards')).body.map((g: { name: string }) => g.name)).toEqual(['Ramesh Kumar']);
    // residents cannot reach the register
    expect((await R('GET', `/v1/admin/${t.associationId}/visits`)).status).toBe(403);
  });
  it('the office reads the register a page at a time', async () => {
    const all = (await A('GET', '/visits')).body as { id: string; kind: string }[];
    expect(all.length).toBeGreaterThan(4);
    const p1 = (await A('GET', '/visits?page=1&limit=3')).body;
    expect(p1).toMatchObject({ total: all.length, page: 1, limit: 3, pages: Math.ceil(all.length / 3) });
    expect(p1.items.map((v: { id: string }) => v.id)).toEqual(all.slice(0, 3).map(v => v.id)); // newest first, same order as the whole list
    const p2 = (await A('GET', '/visits?page=2&limit=3')).body;
    expect(p2.items.map((v: { id: string }) => v.id)).toEqual(all.slice(3, 6).map(v => v.id));
    // the filters count and slice on the server too
    const deliveries = all.filter(v => v.kind === 'delivery').length;
    expect((await A('GET', '/visits?page=1&limit=100&kind=delivery')).body).toMatchObject({ total: deliveries });
    expect((await A('GET', '/visits?page=1&q=zzzz-nobody')).body).toMatchObject({ items: [], total: 0 });
    expect((await A('GET', '/visits?page=1&limit=1000')).status).toBe(400);
    expect((await G('GET', `/v1/admin/${t.associationId}/visits?page=1`)).status).toBe(403);
  });

  it('self check-in: the visitor scans the gate QR, the flat answers, visitor and guard both see it', async () => {
    const P = (m: 'GET' | 'POST', url: string, body?: unknown) => t.call(m, url, { body });
    // the office makes a sticker; only the office can
    expect((await G('POST', `/v1/admin/${t.associationId}/gate-codes`, { gate: 'Main gate' })).status).toBe(403);
    const sticker = (await A('POST', '/gate-codes', { gate: 'Main gate' })).body;
    expect(sticker).toMatchObject({ gate: 'Main gate', society: 'Prestige Lakeside Habitat' });
    expect(sticker.url).toMatch(/^http:\/\/api\.test\/visit\/[A-Za-z0-9_-]{16}$/);
    const token = sticker.url.split('/').pop();
    expect((await A('GET', '/gate-codes')).body.map((x: { id: string }) => x.id)).toContain(sticker.id);

    // the page opens without signing in, and loads nothing from elsewhere
    const page = await t.app.inject({ method: 'GET', url: '/visit/' + token });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.headers['content-security-policy']).toContain("default-src 'none'");
    expect((await P('GET', '/v1/checkin/' + token)).body).toMatchObject({ society: 'Prestige Lakeside Habitat', gate: 'Main gate' });
    expect((await P('GET', '/v1/checkin/not-a-real-sticker')).status).toBe(404);

    // a flat is found by number — never by who lives there, and nothing about them comes back
    const flats = (await P('GET', `/v1/checkin/${token}/units?q=1108`)).body;
    expect(flats[0]).toEqual({ id: home, code: 'T4-1108', label: expect.any(String) });
    expect((await P('GET', `/v1/checkin/${token}/units?q=ananya`)).body).toEqual([]);

    // staff and emergency entries are the guard's to make; a real request asks the flat
    const form = { visitorType: 'Guest', name: 'Sanjay Rao', phone: '9822200011', unitId: home, purpose: 'Family visit', vehicle: 'ka 03 zz 9', people: 3 };
    expect((await P('POST', `/v1/checkin/${token}/visits`, { ...form, visitorType: 'Emergency' })).status).toBe(400);
    expect((await P('POST', `/v1/checkin/${token}/visits`, { ...form, phone: '12345' })).status).toBe(400);
    const made = await P('POST', `/v1/checkin/${token}/visits`, form);
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ status: 'Pending', name: 'Sanjay Rao', unit: 'T4-1108', vehicle: 'KA03ZZ9', people: 3, gate: 'Main gate' });
    const { ticket, ref } = made.body;
    expect(ref).toMatch(/^[0-9A-F]{4}$/);
    expect(JSON.stringify(made.body)).not.toContain(home); // ids stay on the server
    // the same number cannot ask the same flat twice while the first is unanswered
    expect((await P('POST', `/v1/checkin/${token}/visits`, form)).body.error.code).toBe('already_waiting');

    // the flat is told, and the guard sees it waiting with the same code — but never the visitor's ticket
    const mine = (await R('GET', '/v1/visits')).body.pending.find((v: { name: string }) => v.name === 'Sanjay Rao');
    expect(mine).toMatchObject({ selfCheckIn: true, ref, status: 'Pending' });
    expect((await R('GET', '/v1/notifications')).body[0]).toMatchObject({ kind: 'visitors', title: 'Sanjay Rao is at the gate', href: '/gate/' + mine.id });
    const waiting = (await G('GET', '/v1/gate/visits?tab=waiting')).body;
    expect(waiting.find((v: { id: string }) => v.id === mine.id)).toMatchObject({ selfCheckIn: true, ref, status: 'Pending' });
    expect(JSON.stringify(waiting) + JSON.stringify(mine)).not.toContain(ticket);
    expect((await G('POST', `/v1/gate/visits/${mine.id}/enter`)).body.error.code).toBe('not_approved');

    // the resident approves: the visitor's phone and the guard's list both say so
    expect((await P('GET', '/v1/checkin-status/' + ticket)).body.status).toBe('Pending');
    expect((await R('POST', `/v1/visits/${mine.id}/decision`, { decision: 'approve' })).body.status).toBe('Approved');
    const answer = (await P('GET', '/v1/checkin-status/' + ticket)).body;
    expect(answer).toMatchObject({ status: 'Approved', ref });
    expect(answer.decidedByName).toBeUndefined(); // who answered is not the visitor's to know
    expect((await G('GET', '/v1/gate/visits?tab=waiting')).body.find((v: { id: string }) => v.id === mine.id).status).toBe('Approved');
    expect((await G('POST', `/v1/gate/visits/${mine.id}/enter`)).body.status).toBe('Inside');
    expect((await P('GET', '/v1/checkin-status/' + ticket)).body.status).toBe('Inside');
    expect((await P('GET', '/v1/checkin-status/' + 'x'.repeat(32))).status).toBe(404);

    // a rejection reaches the visitor too
    const second = (await P('POST', `/v1/checkin/${token}/visits`, { ...form, name: 'Door Seller', phone: '9822200012' })).body;
    const asked = (await R('GET', '/v1/visits')).body.pending.find((v: { name: string }) => v.name === 'Door Seller');
    await R('POST', `/v1/visits/${asked.id}/decision`, { decision: 'reject' });
    expect((await P('GET', '/v1/checkin-status/' + second.ticket)).body.status).toBe('Rejected');

    // submitted by mistake: the visitor withdraws it, the flat is told, and it leaves both waiting lists
    const oops = (await P('POST', `/v1/checkin/${token}/visits`, { ...form, name: 'Wrong Flat', phone: '9822200015' })).body;
    expect((await P('POST', `/v1/checkin-status/${oops.ticket}/cancel`)).body.status).toBe('Cancelled');
    expect((await R('GET', '/v1/notifications')).body[0]).toMatchObject({ title: 'Wrong Flat cancelled their request' });
    expect((await R('GET', '/v1/visits')).body.pending.some((v: { name: string }) => v.name === 'Wrong Flat')).toBe(false);
    expect((await G('GET', '/v1/gate/visits?tab=waiting')).body.some((v: { name: string }) => v.name === 'Wrong Flat')).toBe(false);
    // once cancelled — or once the guard has let them in — there is nothing left to cancel
    expect((await P('POST', `/v1/checkin-status/${oops.ticket}/cancel`)).body.error.code).toBe('not_cancellable');
    expect((await P('POST', `/v1/checkin-status/${ticket}/cancel`)).body.error.code).toBe('not_cancellable');
    // and the same number may ask again straight away
    const cab = (await P('POST', `/v1/checkin/${token}/visits`, { ...form, visitorType: 'Cab', partner: 'Rapido', name: 'Right Flat', phone: '9822200015' }));
    expect(cab.status).toBe(201);
    // the company a rider or driver picked reaches the guard and the flat
    expect((await G('GET', '/v1/gate/visits?tab=waiting')).body.find((v: { name: string }) => v.name === 'Right Flat')).toMatchObject({ visitorType: 'Cab', partner: 'Rapido' });
    expect((await R('GET', '/v1/notifications')).body[0].body).toContain('Cab · Rapido');

    // a blocked number is refused without the flat being disturbed
    await A('POST', '/watchlist', { name: 'Blocked Person', phone: '9822200013', reason: 'Theft', level: 'block' });
    const before = (await R('GET', '/v1/notifications')).body.length;
    const blocked = (await P('POST', `/v1/checkin/${token}/visits`, { ...form, name: 'Blocked Person', phone: '9822200013' })).body;
    expect(blocked.status).toBe('Rejected');
    expect(JSON.stringify(blocked)).not.toContain('Theft');
    expect((await R('GET', '/v1/notifications')).body.length).toBe(before);

    // a cancelled sticker stops working at once
    expect((await A('DELETE', '/gate-codes/' + sticker.id)).status).toBe(204);
    expect((await P('GET', '/v1/checkin/' + token)).status).toBe(404);
    expect((await P('GET', `/v1/checkin/${token}/units?q=1108`)).status).toBe(404);
    // and the form cannot be hammered: this is the ninth request from one address in ten minutes
    expect((await P('POST', `/v1/checkin/${token}/visits`, { ...form, phone: '9822200014' })).status).toBe(429);
  });
});
