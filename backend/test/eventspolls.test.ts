import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO } from '../src/db/seed.js';
import { testApp } from './helpers.js';

let t: Awaited<ReturnType<typeof testApp>>;
let admin: string, resident: string;
beforeAll(async () => {
  t = await testApp();
  admin = (await t.staffIn()).accessToken;
  resident = (await t.signIn(DEMO.residentPhone)).accessToken;
});
afterAll(() => t.close());

const A = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown) => t.call(method, `/v1/admin/${t.associationId}${path}`, { token: admin, body });
const soon = (days: number) => new Date(Date.now() + days * 864e5).toISOString();

describe('the office corrects and removes polls and events', () => {
  it('edits a poll freely until someone votes, then only its closing time', async () => {
    const made = await A('POST', '/polls', { question: 'Shoud the gym open at 5 AM?', options: ['Yes', 'No'], closesAt: soon(3) });
    expect(made.status).toBe(201);
    const id = made.body.id;
    // a typo and a third option, before any vote
    expect((await A('PUT', `/polls/${id}`, { question: 'Should the gym open at 5 AM?', options: ['Yes', 'No', 'Only on weekdays'], eligibility: 'all', closesAt: soon(4) })).status).toBe(200);
    expect((await A('PUT', `/polls/${id}`, { options: ['Yes', 'yes'] })).body.error.code).toBe('same_options');
    const mine = (await t.call('GET', '/v1/polls', { token: resident })).body.find((p: { id: string }) => p.id === id);
    expect(mine.question).toBe('Should the gym open at 5 AM?');
    expect(mine.options.map((o: { label: string }) => o.label)).toEqual(['Yes', 'No', 'Only on weekdays']);

    expect((await t.call('POST', `/v1/polls/${id}/vote`, { token: resident, body: { optionId: mine.options[2].id } })).status).toBe(200);
    // the vote fixes the wording; the closing time can still move, and sending the same wording back is fine
    expect((await A('PUT', `/polls/${id}`, { question: 'Should the pool open at 5 AM?' })).body.error.code).toBe('has_votes');
    expect((await A('PUT', `/polls/${id}`, { options: ['Yes', 'No'] })).body.error.code).toBe('has_votes');
    expect((await A('PUT', `/polls/${id}`, { question: 'Should the gym open at 5 AM?', options: ['Yes', 'No', 'Only on weekdays'], eligibility: 'all', closesAt: soon(9) })).status).toBe(200);
    expect((await A('PUT', `/polls/${id}`, { closesAt: soon(-1) })).body.error.code).toBe('closes_in_past');
    const after = (await A('GET', '/polls')).body.find((p: { id: string }) => p.id === id);
    expect(after.options.find((o: { label: string }) => o.label === 'Only on weekdays').votes).toBe(1);

    // a closed poll is final
    await A('POST', `/polls/${id}/close`);
    expect((await A('PUT', `/polls/${id}`, { closesAt: soon(9) })).body.error.code).toBe('poll_closed');
  });

  it('deletes a poll with its votes', async () => {
    const id = (await A('POST', '/polls', { question: 'Paint the lobby this year?', options: ['Yes', 'No'], closesAt: soon(3) })).body.id;
    const opt = (await t.call('GET', '/v1/polls', { token: resident })).body.find((p: { id: string }) => p.id === id).options[0].id;
    await t.call('POST', `/v1/polls/${id}/vote`, { token: resident, body: { optionId: opt } });
    expect((await A('DELETE', `/polls/${id}`)).status).toBe(204);
    expect((await A('GET', '/polls')).body.some((p: { id: string }) => p.id === id)).toBe(false);
    expect((await t.call('GET', '/v1/polls', { token: resident })).body.some((p: { id: string }) => p.id === id)).toBe(false);
    expect((await A('DELETE', `/polls/${id}`)).status).toBe(404);
    expect((await A('GET', '/audit')).body.some((e: { action: string }) => e.action.includes('poll deleted · Paint the lobby this year? · 1 vote discarded'))).toBe(true);
  });

  it('edits an event, tells those attending when it moves, and holds capacity above the RSVPs', async () => {
    const made = await A('POST', '/events', { title: 'Terrace movie night', location: 'Tower 2 terrace', startsAt: soon(5), minutes: 120, capacity: 30 });
    const id = made.body.id;
    expect((await t.call('POST', `/v1/events/${id}/rsvp`, { token: resident })).body.status).toBe('Going');
    const unread = async () => (await t.call('GET', '/v1/notifications', { token: resident })).body.filter((n: { title: string }) => n.title.includes('Terrace movie night'));
    const before = (await unread()).length;

    // a wording change tells nobody
    expect((await A('PUT', `/events/${id}`, { title: 'Terrace movie night', description: 'Bring a mat.', location: 'Tower 2 terrace', startsAt: made.body.startsAt, minutes: 150, capacity: 30 })).status).toBe(200);
    expect((await unread()).length).toBe(before);
    // a new place does
    expect((await A('PUT', `/events/${id}`, { location: 'Clubhouse lawn' })).body.location).toBe('Clubhouse lawn');
    const told = await unread();
    expect(told.length).toBe(before + 1);
    expect(told.some((n: { title: string; body: string }) => n.title.startsWith('Event changed') && n.body.includes('Clubhouse lawn'))).toBe(true);

    expect((await A('PUT', `/events/${id}`, { capacity: 0 })).status).toBe(400);
    expect((await A('PUT', `/events/${id}`, { startsAt: soon(-2) })).body.error.code).toBe('starts_in_past');
    const listed = (await A('GET', '/events')).body.find((e: { id: string }) => e.id === id);
    expect(listed).toMatchObject({ description: 'Bring a mat.', minutes: 150, going: 1 });

    // cancelling removes it from the app and tells the person who was going
    expect((await A('DELETE', `/events/${id}`)).status).toBe(204);
    expect((await t.call('GET', '/v1/events', { token: resident })).body.some((e: { id: string }) => e.id === id)).toBe(false);
    expect((await unread()).some((n: { title: string }) => n.title.startsWith('Event cancelled'))).toBe(true);
  });

  it('will not lower capacity below the people already going, and keeps other roles out', async () => {
    const full = (await A('GET', '/events')).body.find((e: { going: number }) => e.going > 1);
    expect((await A('PUT', `/events/${full.id}`, { capacity: full.going - 1 })).body.error.code).toBe('below_going');
    expect((await t.call('DELETE', `/v1/admin/${t.associationId}/events/${full.id}`, { token: resident })).status).toBe(403);
    expect((await t.call('PUT', `/v1/admin/${t.associationId}/polls/${full.id}`, { token: resident, body: { closesAt: soon(2) } })).status).toBe(403);
  });
});
