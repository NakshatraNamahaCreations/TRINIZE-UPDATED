import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from './helpers.js';

type Call = 'GET' | 'POST' | 'PUT' | 'DELETE';

describe('the society team: who signs in, and which sections each may use', () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let admin = '';
  const A = (m: Call, path: string, body?: unknown, token = admin) => t.call(m, `/v1/admin/${t.associationId}${path}`, { token, body });

  beforeAll(async () => { t = await testApp(); admin = (await t.staffIn()).accessToken; });
  afterAll(async () => { await t?.close(); });

  it('gives the admin everything and lists the team', async () => {
    const me = (await A('GET', '/staff/me')).body;
    expect(me).toMatchObject({ role: 'admin', full: true });
    expect(me.permissions).toContain('accounts');
    const team = (await A('GET', '/staff')).body;
    expect(team.find((x: { you: boolean }) => x.you)).toMatchObject({ access: 'full' });
  });

  it('holds a limited member to their sections, and changes at once when the list does', async () => {
    expect((await A('POST', '/staff', { name: 'Meera Nair', email: 'meera@lakeside.test', password: 'Notice@2026', full: false, permissions: [] })).body.error.code).toBe('no_sections');
    const made = await A('POST', '/staff', { name: 'Meera Nair', email: 'Meera@lakeside.test', password: 'Notice@2026', title: 'Front desk', full: false, permissions: ['announcements', 'events'] });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ name: 'Meera Nair', access: 'limited', permissions: ['announcements', 'events'], title: 'Front desk' });
    expect((await A('POST', '/staff', { name: 'Again', email: 'meera@lakeside.test', password: 'Notice@2026', full: true })).body.error.code).toBe('email_taken');

    const meera = (await t.staffIn('meera@lakeside.test', 'Notice@2026')).accessToken;
    expect((await A('GET', '/staff/me', undefined, meera)).body).toMatchObject({ full: false, permissions: ['announcements', 'events'] });
    // inside her sections she works as the office does
    expect((await A('GET', '/announcements', undefined, meera)).status).toBe(200);
    expect((await A('POST', '/announcements', { title: 'Lift service', body: 'Lift 2 is serviced on Friday.' }, meera)).status).toBe(201);
    expect((await A('GET', '/events', undefined, meera)).status).toBe(200);
    expect((await A('GET', '/plan', undefined, meera)).status).toBe(200);
    // everything else is closed, including the team itself
    for (const path of ['/issues', '/users', '/units', '/finance/bills', '/audit', '/comms/messages', '/staff', '/search?q=tower']) {
      const r = await A('GET', path, undefined, meera);
      expect([path, r.status, r.body.error.code]).toEqual([path, 403, 'no_access']);
    }
    expect((await A('POST', '/staff', { name: 'Sneak', email: 'sneak@lakeside.test', password: 'Notice@2026', full: true }, meera)).status).toBe(403);

    // the admin adds Issues
    const edited = await A('PUT', `/staff/${made.body.id}`, { name: 'Meera Nair', title: 'Front desk', full: false, permissions: ['announcements', 'issues'] });
    expect(edited.body.permissions).toEqual(['announcements', 'issues']);
    expect((await A('GET', '/issues', undefined, meera)).status).toBe(200);
    expect((await A('GET', '/events', undefined, meera)).status).toBe(403);

    // a new password signs her out; removing her closes the console
    expect((await A('PUT', `/staff/${made.body.id}/password`, { password: 'Changed@2026' })).status).toBe(200);
    expect((await t.call('POST', '/v1/auth/staff/login', { body: { email: 'meera@lakeside.test', password: 'Notice@2026' } })).status).toBe(401);
    const again = (await t.staffIn('meera@lakeside.test', 'Changed@2026')).accessToken;
    expect((await A('DELETE', `/staff/${made.body.id}`)).status).toBe(204);
    expect((await A('GET', '/announcements', undefined, again)).status).toBe(403);
    expect((await t.call('POST', '/v1/auth/staff/login', { body: { email: 'meera@lakeside.test', password: 'Changed@2026' } })).status).toBe(401);
  });

  it('never leaves a society without a full admin', async () => {
    const team = (await A('GET', '/staff')).body, me = team.find((x: { you: boolean }) => x.you);
    expect((await A('DELETE', `/staff/${me.id}`)).body.error.code).toBe('not_yourself');
    expect((await A('PUT', `/staff/${me.id}`, { name: me.name, title: 'Secretary', full: false, permissions: ['issues'] })).body.error.code).toBe('not_yourself');
    // a second full admin can be added, and then limited again
    const two = (await A('POST', '/staff', { name: 'Vikram Shah', email: 'vikram@lakeside.test', password: 'Second@2026', full: true })).body;
    expect(two).toMatchObject({ access: 'full' });
    const vikram = (await t.staffIn('vikram@lakeside.test', 'Second@2026')).accessToken;
    expect((await A('GET', '/staff', undefined, vikram)).status).toBe(200);
    expect((await A('PUT', `/staff/${two.id}`, { name: 'Vikram Shah', title: '', full: false, permissions: ['gate'] })).body).toMatchObject({ access: 'limited' });
    expect((await A('GET', '/staff', undefined, vikram)).status).toBe(403);
    expect((await A('GET', '/audit')).body.some((x: { action: string }) => /changed Vikram Shah’s access · Gate/.test(x.action))).toBe(true);
  });
});

describe('registering residents in a flat from the office', () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let admin = '';
  const A = (m: Call, path: string, body?: unknown) => t.call(m, `/v1/admin/${t.associationId}${path}`, { token: admin, body });
  beforeAll(async () => { t = await testApp(); admin = (await t.staffIn()).accessToken; });
  afterAll(async () => { await t?.close(); });

  it('adds the owner of a new flat, who can sign in at once, and removes them again', async () => {
    expect((await A('POST', '/units', { units: [{ code: 'T9-101', tower: 'Tower 9', occupancy: 'Vacant' }] })).status).toBe(201);
    const flat = (await A('GET', '/units')).body.find((u: { code: string }) => u.code === 'T9-101');
    // a number nobody has used: not a resident yet
    const made = await A('POST', `/units/${flat.id}/members`, { name: 'Anita Sharma', phone: '9900011122', role: 'Owner' });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ name: 'Anita Sharma', role: 'Owner', status: 'active' });
    const now = (await A('GET', '/units')).body.find((u: { code: string }) => u.code === 'T9-101');
    expect(now).toMatchObject({ occupancy: 'Owner-occupied' });
    expect(now.members).toMatchObject([{ name: 'Anita Sharma', phone: '9900011122', role: 'Owner', memberId: made.body.memberId }]);
    // she signs in with her number and lands in her flat
    const anita = (await t.signIn('9900011122')).accessToken;
    expect((await t.call('GET', '/v1/family', { token: anita })).status).toBe(200);
    // the same number twice, or a number that already lives in another flat, is refused
    expect((await A('POST', `/units/${flat.id}/members`, { name: 'Anita Sharma', phone: '9900011122', role: 'Owner' })).body.error.code).toBe('already_member');
    const other = (await A('GET', '/units')).body.find((u: { code: string }) => u.code === 'T4-1108');
    expect((await A('POST', `/units/${other.id}/members`, { name: 'Anita Sharma', phone: '9900011122', role: 'Tenant' })).body.error.code).toBe('number_in_use');
    expect((await A('POST', `/units/${flat.id}/members`, { name: 'X', phone: '12345', role: 'Owner' })).status).toBe(400);
    // moved out: off the flat, and the app no longer opens it
    expect((await A('DELETE', `/units/${flat.id}/members/${made.body.memberId}`)).body).toEqual({ removed: true });
    expect((await t.call('GET', '/v1/family', { token: anita })).status).toBe(403);
    // …and her number is refused at sign-in, with the reason, instead of being let in to an empty app
    const gone = await t.call('POST', '/v1/auth/otp/request', { body: { phone: '9900011122' } });
    expect([gone.status, gone.body.error.code]).toEqual([404, 'not_registered']);
    // guards and property managers still sign in with their numbers
    expect((await t.call('POST', '/v1/auth/otp/request', { body: { phone: '9833300003' } })).status).toBe(200);
    expect((await A('GET', '/audit')).body.some((x: { action: string }) => x.action === 'resident registered · Anita Sharma (Owner) → T9-101')).toBe(true);
  });
});
