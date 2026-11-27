import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO } from '../src/db/seed.js';
import { testApp } from './helpers.js';

/*
 * The QA ask (A-01, A-02): sign in as a resident and compare what they see with what the office sees, at the
 * same moment. Every list the resident app shows must match the society admin's for that resident.
 */

let t: Awaited<ReturnType<typeof testApp>>;
let resident: string, admin: string;
const A = (p: string) => `/v1/admin/${t.associationId}${p}`;
const get = async (url: string, token: string) => {
  const r = await t.call('GET', url, { token });
  expect(r.status, url).toBe(200);
  return r.body;
};
beforeAll(async () => {
  t = await testApp();
  resident = (await t.signIn(DEMO.residentPhone)).accessToken; // Ananya Iyer, owner of T4-1108
  admin = (await t.staffIn()).accessToken;
});
afterAll(() => t.close());

describe('a resident sees what the office has published', () => {
  it('every notice for all residents, including one the office publishes now', async () => {
    const made = await t.call('POST', A('/announcements'), { token: admin, body: { title: 'Lift maintenance on Saturday', body: 'Tower 4 lift will be serviced from 10 to 12.', priority: 'Normal' } });
    expect(made.status).toBe(201);
    const office = (await get(A('/announcements'), admin)) as { ref: string; audience: string }[];
    const mine = ((await get('/v1/announcements', resident)) as { ref: string }[]).map(a => a.ref);
    const forEveryone = office.filter(a => a.audience === 'All residents').map(a => a.ref);
    expect(forEveryone.length).toBeGreaterThan(0);
    for (const ref of forEveryone) expect(mine, `notice ${ref}`).toContain(ref);
    // and nothing the office doesn't have
    for (const ref of mine) expect(office.map(a => a.ref)).toContain(ref);
  });

  it('the same upcoming events', async () => {
    const office = ((await get(A('/events'), admin)) as { id: string }[]).map(e => e.id).sort();
    const mine = ((await get('/v1/events', resident)) as { id: string }[]).map(e => e.id).sort();
    expect(office.length).toBeGreaterThan(0);
    expect(mine).toEqual(office);
  });

  it('the same open polls', async () => {
    const office = ((await get(A('/polls'), admin)) as { id: string; closed: boolean }[]).filter(p => !p.closed).map(p => p.id).sort();
    const mine = ((await get('/v1/polls', resident)) as { id: string; closed: boolean }[]).filter(p => !p.closed).map(p => p.id).sort();
    expect(office.length).toBeGreaterThan(0);
    expect(mine).toEqual(office);
  });

  it('all of their own requests, with the same status the office sees', async () => {
    // one more, raised now
    expect((await t.call('POST', '/v1/issues', { token: resident, body: { title: 'Balcony door lock broken', category: 'General maintenance', location: 'My flat', priority: 'Low', via: 'form' } })).status).toBe(201);
    const office = ((await get(A('/issues'), admin)) as { ref: string; status: string; reporter: string | null }[]).filter(i => i.reporter === 'Ananya Iyer');
    const mine = (await get('/v1/issues', resident)) as { ref: string; status: string }[];
    expect(mine.map(i => i.ref).sort()).toEqual(office.map(i => i.ref).sort());
    for (const i of office) expect(mine.find(m => m.ref === i.ref)?.status, i.ref).toBe(i.status);
  });
});

describe('a status change by the office reaches the resident (A-02)', () => {
  it('shows the new status and the office’s note on the resident’s request', async () => {
    const mine = (await get('/v1/issues', resident)) as { ref: string; status: string }[];
    const fresh = mine.find(i => i.status === 'Submitted');
    expect(fresh).toBeTruthy();
    const moved = await t.call('POST', A(`/issues/${fresh!.ref}/status`), { token: admin, body: { to: 'Acknowledged', note: 'Our electrician will visit tomorrow morning.' } });
    expect(moved.status).toBe(200);
    const after = ((await get('/v1/issues', resident)) as { ref: string; status: string; timeline: { status: string; note: string | null }[] }[]).find(i => i.ref === fresh!.ref)!;
    expect(after.status).toBe('Acknowledged');
    expect(after.timeline.some(e => e.status === 'Acknowledged' && e.note === 'Our electrician will visit tomorrow morning.')).toBe(true);
  });
});

describe('a notice for some towers only (the property manager’s Notice screen)', () => {
  it('reaches residents of those towers and nobody else', async () => {
    const vpm = (await t.signIn(DEMO.vpmPhone)).accessToken;
    const rohit = (await t.signIn('9900112233')).accessToken; // Tower 2
    const sent = await t.call('POST', A('/comms/messages'), { token: vpm, body: {
      type: 'Announcement', title: 'Tower 4 water tank cleaning', body: 'No water in Tower 4 from 10 to 1 on Sunday.', priority: 'Important',
      channels: ['portal', 'push'], audience: { kind: 'towers', towers: ['Tower 4'] }, requiresAck: true, action: 'send',
    } });
    expect(sent.status).toBe(201);
    expect(sent.body.stats.recipients).toBeGreaterThan(0);
    const titles = async (token: string) => ((await get('/v1/announcements', token)) as { title: string }[]).map(a => a.title);
    expect(await titles(resident)).toContain('Tower 4 water tank cleaning'); // Ananya, Tower 4
    expect(await titles(rohit)).not.toContain('Tower 4 water tank cleaning');
  });
});
