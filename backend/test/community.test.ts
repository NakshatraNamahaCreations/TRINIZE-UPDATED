import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO } from '../src/db/seed.js';
import { testApp } from './helpers.js';

let t: Awaited<ReturnType<typeof testApp>>;
let ananya = '', rohit = '', neha = '', admin = '';
const A = () => `/v1/admin/${t.associationId}`;

beforeAll(async () => {
  t = await testApp();
  ananya = (await t.signIn(DEMO.residentPhone)).accessToken;
  rohit = (await t.signIn('9900112233')).accessToken;
  neha = (await t.signIn('9900445566')).accessToken;
  admin = (await t.staffIn()).accessToken;
});
afterAll(async () => { await t?.close(); });

describe('discussions and the abuse guard', () => {
  it('publishes a fair complaint, refuses abuse, and holds borderline posts for a moderator', async () => {
    // a complaint about a service is fine, even with a harsh word
    const fair = await t.call('POST', '/v1/posts', { token: ananya, body: { text: 'The T4 lift is useless, third breakdown this month' } });
    expect(fair.status).toBe(201);
    expect(fair.body.state).toBe('published');
    expect(fair.body.ref).toMatch(/^D-\d+$/);

    const abuse = await t.call('POST', '/v1/posts', { token: ananya, body: { text: 'I will kill whoever parked here' } });
    expect(abuse.status).toBe(422);
    expect(abuse.body.error.words).toContain('kill');

    // an insult about a person: warned first, then held if the author insists
    const warn = await t.call('POST', '/v1/posts', { token: rohit, body: { text: 'Is the new plumber reliable or a scammer?' } });
    expect(warn.status).toBe(409);
    expect(warn.body.error.code).toBe('needs_review');
    const held = await t.call('POST', '/v1/posts', { token: rohit, body: { text: 'Is the new plumber reliable or a scammer?', confirm: true } });
    expect(held.body.state).toBe('held');

    // the author sees it, neighbours don't, and it's in the moderators' queue
    expect((await t.call('GET', '/v1/posts', { token: rohit })).body.map((p: { ref: string }) => p.ref)).toContain(held.body.ref);
    expect((await t.call('GET', '/v1/posts', { token: ananya })).body.map((p: { ref: string }) => p.ref)).not.toContain(held.body.ref);
    const queue = (await t.call('GET', `${A()}/moderation`, { token: admin })).body;
    const item = queue.find((m: { kind: string }) => m.kind === 'Discussion post');
    expect(item.by).toBe('Rohit Sharma');

    // the moderator allows it → published for everyone, and the author is told
    expect((await t.call('POST', `${A()}/moderation/${item.id}/action`, { token: admin, body: { action: 'Allowed' } })).body.state).toBe('done');
    expect((await t.call('GET', '/v1/posts', { token: ananya })).body.map((p: { ref: string }) => p.ref)).toContain(held.body.ref);
    expect((await t.call('POST', `${A()}/moderation/${item.id}/action`, { token: admin, body: { action: 'Hidden' } })).body.error.code).toBe('already_decided');
    // discussion notifications are off by default, so Rohit only gets it after switching them on — checked below
  });

  it('threads replies, counts them, and keeps held replies private', async () => {
    const post = (await t.call('GET', '/v1/posts', { token: ananya })).body.find((p: { title: string }) => p.title.startsWith('The T4 lift'));
    await t.call('PUT', '/v1/settings', { token: ananya, body: { notif: { discussions: true } } });
    const ok = await t.call('POST', `/v1/posts/${post.ref}/replies`, { token: rohit, body: { text: 'Same in T2 last week. OTIS came the next day.' } });
    expect(ok.body.state).toBe('published');
    const rude = await t.call('POST', `/v1/posts/${post.ref}/replies`, { token: neha, body: { text: 'The committee are idiots' } });
    expect(rude.body.state).toBe('held');

    const asAuthor = (await t.call('GET', `/v1/posts/${post.ref}`, { token: ananya })).body;
    expect(asAuthor.comments).toBe(1);
    expect(asAuthor.replies).toHaveLength(1); // Neha's held reply is hers alone
    expect((await t.call('GET', `/v1/posts/${post.ref}`, { token: neha })).body.replies).toHaveLength(2);

    // Ananya switched discussion notifications on, so the reply reached her
    const notes = (await t.call('GET', '/v1/notifications', { token: ananya })).body;
    expect(notes[0].title).toBe('Rohit Sharma replied to your post');
    expect(notes[0].href).toBe('/discussions/' + post.ref);
    await t.call('POST', '/v1/notifications/read-all', { token: ananya });
    expect((await t.call('GET', '/v1/notifications', { token: ananya })).body.every((n: { read: boolean }) => n.read)).toBe(true);
  });

  it('keeps one reaction per resident', async () => {
    const post = (await t.call('GET', '/v1/posts', { token: ananya })).body.find((p: { title: string }) => p.title.startsWith('The T4 lift'));
    await t.call('PUT', `/v1/posts/${post.ref}/reaction`, { token: rohit, body: { kind: '👍' } });
    await t.call('PUT', `/v1/posts/${post.ref}/reaction`, { token: rohit, body: { kind: '💜' } });
    await t.call('PUT', `/v1/posts/${post.ref}/reaction`, { token: neha, body: { kind: '💜' } });
    const seen = (await t.call('GET', `/v1/posts/${post.ref}`, { token: rohit })).body;
    expect(seen.reactions).toEqual({ '💜': 2 });
    expect(seen.myReaction).toBe('💜');
    await t.call('PUT', `/v1/posts/${post.ref}/reaction`, { token: rohit, body: { kind: null } });
    expect((await t.call('GET', `/v1/posts/${post.ref}`, { token: rohit })).body.reactions).toEqual({ '💜': 1 });
  });

  it('reports once, blocks, and lets authors delete their own', async () => {
    const post = (await t.call('GET', `/v1/posts`, { token: neha })).body.find((p: { title: string }) => p.title.startsWith('The T4 lift'));
    expect((await t.call('POST', '/v1/reports', { token: neha, body: { targetType: 'post', targetId: post.id } })).body.already).toBe(false);
    expect((await t.call('POST', '/v1/reports', { token: neha, body: { targetType: 'post', targetId: post.id } })).body.already).toBe(true);
    const reported = (await t.call('GET', `${A()}/moderation`, { token: admin })).body.filter((m: { kind: string }) => m.kind === 'Reported post');
    expect(reported).toHaveLength(1);
    expect(reported[0].by).toBe('Ananya Iyer'); // the author, not the reporter

    // Neha blocks Ananya: her posts disappear from Neha's feed only
    await t.call('POST', '/v1/blocks', { token: neha, body: { userId: post.authorId } });
    expect((await t.call('GET', '/v1/posts', { token: neha })).body.map((p: { ref: string }) => p.ref)).not.toContain(post.ref);
    expect((await t.call('GET', `/v1/posts/${post.ref}`, { token: neha })).body.error.code).toBe('author_blocked');
    expect((await t.call('GET', '/v1/posts', { token: rohit })).body.map((p: { ref: string }) => p.ref)).toContain(post.ref);
    await t.call('DELETE', `/v1/blocks/${post.authorId}`, { token: neha });
    expect((await t.call('GET', '/v1/posts', { token: neha })).body.map((p: { ref: string }) => p.ref)).toContain(post.ref);

    expect((await t.call('DELETE', `/v1/posts/${post.ref}`, { token: rohit })).status).toBe(403);
    expect((await t.call('DELETE', `/v1/posts/${post.ref}`, { token: ananya })).status).toBe(204);
  });

  it('a warning counts against standing, and a restricted resident cannot post', async () => {
    const item = (await t.call('GET', `${A()}/moderation`, { token: admin })).body.find((m: { kind: string }) => m.kind === 'Discussion reply');
    await t.call('POST', `${A()}/moderation/${item.id}/action`, { token: admin, body: { action: 'Warned author' } });
    const people = (await t.call('GET', `${A()}/users`, { token: admin })).body;
    const nehaRow = people.find((p: { name: string }) => p.name === 'Neha Iyer');
    expect(nehaRow.status).toBe('Warned');
    expect(nehaRow.warnings).toBe(1);
    await t.call('PUT', `${A()}/users/${nehaRow.userId}/standing`, { token: admin, body: { status: 'Restricted' } });
    expect((await t.call('POST', '/v1/posts', { token: neha, body: { text: 'Anyone up for badminton?' } })).status).toBe(403);
  });
});

describe('gratitude', () => {
  it('delivers private thanks to one person and shows community notes to all', async () => {
    const people = (await t.call('GET', '/v1/neighbours', { token: ananya })).body;
    const rohitId = people.find((p: { name: string }) => p.name === 'Rohit Sharma').id;
    await t.call('POST', '/v1/gratitudes', { token: ananya, body: { text: 'Thanks for the electrician tip!', category: 'Help received', toUserId: rohitId, toLabel: 'Rohit Sharma (T2-0704)' } });
    await t.call('POST', '/v1/gratitudes', { token: ananya, body: { text: 'The lakeside looks beautiful after the drive', category: 'Kindness', toLabel: 'The whole community' } });
    const forRohit = (await t.call('GET', '/v1/gratitudes', { token: rohit })).body;
    expect(forRohit.filter((g: { toMe: boolean }) => g.toMe)).toHaveLength(1);
    expect(forRohit).toHaveLength(2);
    // Arjun sees only the community note
    const arjun = (await t.signIn('9900778899')).accessToken;
    expect((await t.call('GET', '/v1/gratitudes', { token: arjun })).body).toHaveLength(1);
    expect((await t.call('GET', '/v1/notifications', { token: rohit })).body.some((n: { title: string }) => n.title === 'Gratitude received')).toBe(true);
  });
});

describe('household, ideas and notifications', () => {
  it('lets an owner add a member who can sign in once verified', async () => {
    const added = await t.call('POST', '/v1/family', { token: ananya, body: { name: 'Lakshmi Iyer', phone: '9812345678', role: 'Family' } });
    expect(added.status).toBe(201);
    expect(added.body.status).toBe('pending');
    // pending: no code is sent and she is told why — she is not let in to an app with nothing in it
    const early = await t.call('POST', '/v1/auth/otp/request', { body: { phone: '9812345678' } });
    expect(early.status).toBe(403);
    expect(early.body.error).toMatchObject({ code: 'awaiting_verification', message: 'Your number has been added to T4-1108 and is waiting for the society office to verify it. You can sign in once they do.' });
    await t.call('POST', `${A()}/members/${added.body.id}/verify`, { token: admin });
    const pending = (await t.signIn('9812345678')).accessToken;
    expect((await t.call('GET', '/v1/me', { token: pending })).body.unit.code).toBe('T4-1108');
    // family members can't add others
    expect((await t.call('POST', '/v1/family', { token: pending, body: { name: 'X Y', phone: '9812345679', role: 'Family' } })).status).toBe(403);
  });

  it('routes an event idea to the committee and tells the resident the outcome', async () => {
    const s = await t.call('POST', '/v1/event-suggestions', { token: ananya, body: { title: 'Saturday chess club', when: 'Sat 21 Nov · 6:00 PM', where: 'Clubhouse' } });
    expect(s.body.status).toBe('pending');
    const list = (await t.call('GET', `${A()}/event-suggestions`, { token: admin })).body;
    await t.call('POST', `${A()}/event-suggestions/${list[0].id}/decision`, { token: admin, body: { decision: 'approved' } });
    expect((await t.call('GET', '/v1/event-suggestions', { token: ananya })).body[0].status).toBe('approved');
    expect((await t.call('GET', '/v1/notifications', { token: ananya })).body[0].title).toBe('Your event idea was approved');
  });

  it('notifies residents about office actions: issue moves, notices, new polls', async () => {
    const created = await t.call('POST', '/v1/issues', { token: rohit, body: { title: 'Gym AC not cooling', category: 'HVAC', location: 'Clubhouse', priority: 'Medium', via: 'form' } });
    await t.call('POST', `${A()}/issues/${created.body.ref}/status`, { token: admin, body: { to: 'Acknowledged' } });
    await t.call('POST', `${A()}/announcements`, { token: admin, body: { title: 'Gate 2 closed Sunday', body: 'Use Gate 1 between 6 and 10 AM.', priority: 'High' } });
    const poll = await t.call('POST', `${A()}/polls`, { token: admin, body: { question: 'Repaint the clubhouse this year?', options: ['Yes', 'No'], closesAt: new Date(Date.now() + 864e5).toISOString() } });
    expect(poll.status).toBe(201);
    const titles = (await t.call('GET', '/v1/notifications', { token: rohit })).body.map((n: { title: string }) => n.title);
    expect(titles).toContain(`Update on ${created.body.ref}`);
    expect(titles).toContain('Important: Gate 2 closed Sunday');
    expect(titles).toContain('New poll: Repaint the clubhouse this year?');
    // a resident who turned polls off isn't told about the next one
    await t.call('PUT', '/v1/settings', { token: rohit, body: { notif: { polls: false } } });
    await t.call('POST', `${A()}/polls`, { token: admin, body: { question: 'Extend pool hours in summer?', options: ['Yes', 'No'], closesAt: new Date(Date.now() + 864e5).toISOString() } });
    expect((await t.call('GET', '/v1/notifications', { token: rohit })).body.map((n: { title: string }) => n.title)).not.toContain('New poll: Extend pool hours in summer?');
    // the new poll is votable, and closing it stops votes
    const polls = (await t.call('GET', '/v1/polls', { token: rohit })).body;
    const fresh = polls.find((p: { question: string }) => p.question.startsWith('Extend pool'));
    await t.call('POST', `${A()}/polls/${fresh.id}/close`, { token: admin });
    expect((await t.call('POST', `/v1/polls/${fresh.id}/vote`, { token: rohit, body: { optionId: fresh.options[0].id } })).body.error.code).toBe('poll_closed');
  });
});

describe('your data', () => {
  it('exports everything, then deletes the account and ends its sessions', async () => {
    const arjunSession = await t.signIn('9900778899');
    const arjun = arjunSession.accessToken;
    await t.call('POST', '/v1/posts', { token: arjun, body: { text: 'Festival decoration volunteers needed' } });
    const created = await t.call('POST', '/v1/issues', { token: arjun, body: { title: 'Lift 2 grinding noise', category: 'Lifts', location: 'Tower 1', priority: 'High', via: 'form' } });
    const data = (await t.call('GET', '/v1/me/export', { token: arjun })).body;
    expect(data.resident.phone).toBe('9900778899');
    expect(data.posts).toHaveLength(1);
    expect(data.issues).toHaveLength(1);

    expect((await t.call('DELETE', '/v1/me', { token: arjun })).status).toBe(204);
    expect((await t.call('GET', '/v1/me', { token: arjun })).status).toBe(403);
    expect((await t.call('POST', '/v1/auth/refresh', { body: { refreshToken: arjunSession.refreshToken } })).status).toBe(401);
    expect((await t.call('POST', '/v1/auth/otp/request', { body: { phone: '9900778899' } })).body.error.code).toBe('not_registered');
    // his post is gone; the issue stays for the office, with no name on it
    expect((await t.call('GET', '/v1/posts', { token: ananya })).body.some((p: { title: string }) => p.title.startsWith('Festival'))).toBe(false);
    const kept = (await t.call('GET', `${A()}/issues/${created.body.ref}`, { token: admin })).body;
    expect(kept.reporter).toBe('Former resident');
  });
});
