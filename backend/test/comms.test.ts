import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { users } from '../src/db/schema.js';
import { sendDue } from '../src/lib/comms.js';
import { testApp } from './helpers.js';

describe('communication hub', () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let admin = '', ananya = '', rohit = '';
  const A = (m: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown) => t.call(m, `/v1/admin/${t.associationId}${path}`, { token: admin, body });
  const R = (m: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, body?: unknown, token = ananya) => t.call(m, url, { token, body });
  const base = { type: 'Notice', title: 'Water supply interruption', body: 'Water will be off on Friday from 10 AM to 2 PM for pump-room work.', channels: ['portal', 'push'] };

  beforeAll(async () => {
    t = await testApp();
    admin = (await t.staffIn()).accessToken;
    ananya = (await t.signIn()).accessToken;
    rohit = (await t.signIn('9900112233')).accessToken;
    // two residents have an email on file; one of them bounces
    await t.db.update(users).set({ email: 'ananya@example.com' }).where(eq(users.phone, '9876543210'));
    await t.db.update(users).set({ email: 'bounce@example.com' }).where(eq(users.phone, '9900112233'));
  });
  afterAll(async () => { await t?.close(); });

  it('describes the audience before anything is sent', async () => {
    const a = (await A('GET', '/comms/audience')).body;
    expect(a.total).toBe(6);
    expect(a.towers.find((x: { name: string }) => x.name === 'Tower 4')).toMatchObject({ residents: 2 });
    expect(a.reach).toMatchObject({ email: 3, phone: 6 });
    const n = (await A('POST', '/comms/audience/count', { audience: { kind: 'towers', towers: ['Tower 4', 'Tower 2'] } })).body;
    expect(n).toMatchObject({ residents: 3, label: 'Tower 4, Tower 2' });
    expect((await A('POST', '/comms/audience/count', { audience: { kind: 'role', role: 'Family' } })).body).toMatchObject({ residents: 1, label: 'Family members' });
  });

  it('sends to one tower: only those residents see the notice, and reading is tracked', async () => {
    const sent = await A('POST', '/comms/messages', { ...base, audience: { kind: 'towers', towers: ['Tower 4'] }, priority: 'Important' });
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ status: 'Sent', audienceLabel: 'Tower 4', type: 'Notice' });
    expect(sent.body.ref).toMatch(/^MSG-\d+$/);
    expect(sent.body.stats).toMatchObject({ recipients: 2, reached: 4, onBoard: 2, read: 0, failed: 0 });

    const mine = (await R('GET', '/v1/announcements')).body;
    const notice = mine.find((x: { title: string }) => x.title === base.title);
    expect(notice).toMatchObject({ priority: 'High', type: 'Notice', audience: 'Tower 4' });
    expect((await R('GET', '/v1/announcements', undefined, rohit)).body.some((x: { title: string }) => x.title === base.title)).toBe(false);
    expect((await R('GET', '/v1/notifications')).body[0]).toMatchObject({ kind: 'announcements', title: 'Important: ' + base.title, href: '/announcements/' + notice.ref });
    expect((await R('GET', '/v1/notifications', undefined, rohit)).body.some((n: { title: string }) => n.title.includes(base.title))).toBe(false);

    expect((await R('POST', `/v1/announcements/${notice.id}/seen`)).body).toEqual({ seen: true });
    const detail = (await A('GET', `/comms/messages/${sent.body.id}`)).body;
    expect(detail.stats.read).toBe(1);
    const row = detail.deliveries.find((d: { name: string; channel: string }) => d.name === 'Ananya Iyer' && d.channel === 'portal');
    expect(row).toMatchObject({ status: 'Delivered', unit: 'T4-1108' });
    expect(row.readAt).toBeTruthy();
    expect(detail.deliveries.find((d: { name: string; channel: string }) => d.name === 'Karthik Iyer' && d.channel === 'portal').readAt).toBeNull();
  });

  it('records each outside channel honestly: sent, skipped for no address, failed when refused', async () => {
    const before = t.messenger.sent.length;
    const sent = (await A('POST', '/comms/messages', { ...base, type: 'Reminder', title: 'Maintenance payment due', channels: ['email'] })).body;
    // messages no longer go by WhatsApp or SMS: asking for either is refused, and nothing leaves
    expect((await A('POST', '/comms/messages', { ...base, type: 'Reminder', title: 'By WhatsApp', channels: ['whatsapp'] })).status).toBe(400);
    expect((await A('POST', '/comms/messages', { ...base, type: 'Reminder', title: 'By SMS', channels: ['sms'] })).status).toBe(400);
    expect(sent.stats).toMatchObject({ recipients: 6, failed: 1 });
    const d = (await A('GET', `/comms/messages/${sent.id}`)).body.deliveries as { name: string; channel: string; status: string; detail: string }[];
    expect(d.find(x => x.name === 'Ananya Iyer' && x.channel === 'email')).toMatchObject({ status: 'Sent' });
    expect(d.find(x => x.name === 'Rohit Sharma' && x.channel === 'email')).toMatchObject({ status: 'Failed', detail: 'The provider refused this address' });
    expect(d.find(x => x.name === 'Karthik Iyer' && x.channel === 'email')).toMatchObject({ status: 'Skipped', detail: 'No email address on file' });
    const out = t.messenger.sent.slice(before);
    expect(out.some(m => m.channel === 'sms' || m.channel === 'whatsapp')).toBe(false);
    expect(out.find(m => m.channel === 'email')).toMatchObject({ to: 'ananya@example.com', subject: 'Maintenance payment due' });
    // it was not put on the notice board
    expect((await R('GET', '/v1/announcements')).body.some((x: { title: string }) => x.title === 'Maintenance payment due')).toBe(false);
    expect((await A('GET', '/comms/messages?status=Failed')).body.map((m: { id: string }) => m.id)).toEqual([sent.id]);
  });

  it('promotional messages skip residents who switched them off; emergencies reach everyone', async () => {
    await R('PUT', '/v1/settings', { notif: { promos: false } });
    const offer = (await A('POST', '/comms/messages', { ...base, type: 'Offer', title: 'Festive discount at the clubhouse cafe', channels: ['portal'] })).body;
    expect(offer.promotional).toBe(true);
    expect(offer.stats).toMatchObject({ recipients: 6, onBoard: 5, skipped: 1 });
    expect((await R('GET', '/v1/announcements')).body.some((x: { title: string }) => x.title.startsWith('Festive'))).toBe(false);
    expect((await R('GET', '/v1/announcements', undefined, rohit)).body.some((x: { title: string }) => x.title.startsWith('Festive'))).toBe(true);
    const urgent = (await A('POST', '/comms/messages', { ...base, type: 'Emergency', title: 'Gas leak in Tower 2 basement', channels: ['portal', 'push'], promotional: true })).body;
    expect(urgent).toMatchObject({ priority: 'Emergency' });
    expect(urgent.stats.skipped).toBe(0);
    expect((await R('GET', '/v1/notifications')).body[0].title).toBe('URGENT: Gas leak in Tower 2 basement');
  });

  it('timing: starts later, expires, pins — expired notices leave the board but stay in the record', async () => {
    const soon = new Date(Date.now() + 3600e3).toISOString(), later = new Date(Date.now() + 7200e3).toISOString();
    expect((await A('POST', '/comms/messages', { ...base, expiresAt: new Date(Date.now() - 1000).toISOString() })).body.error.code).toBe('bad_expiry');
    const future = (await A('POST', '/comms/messages', { ...base, title: 'AGM notice', channels: ['portal'], startsAt: soon, expiresAt: later })).body;
    expect((await R('GET', '/v1/announcements')).body.some((x: { title: string }) => x.title === 'AGM notice')).toBe(false); // not yet
    const pinned = (await A('POST', '/comms/messages', { ...base, title: 'Lift maintenance', channels: ['portal'], pinned: true, expiresAt: later })).body;
    const board = (await R('GET', '/v1/announcements')).body;
    expect(board[0]).toMatchObject({ title: 'Lift maintenance', pinned: true });
    // taken down early
    const off = (await A('POST', `/comms/messages/${pinned.id}/board`, { expireNow: true })).body;
    expect(off.expired).toBe(true);
    expect((await R('GET', '/v1/announcements')).body.some((x: { title: string }) => x.title === 'Lift maintenance')).toBe(false);
    expect((await A('GET', '/comms/messages?status=Expired')).body.map((m: { title: string }) => m.title)).toEqual(['Lift maintenance']);
    expect((await A('POST', `/comms/messages/${future.id}/board`, { pinned: true })).body.pinned).toBe(true);
  });

  it('drafts and scheduled messages: edit, cancel, and go out when their time comes', async () => {
    const draft = (await A('POST', '/comms/messages', { ...base, title: 'Diwali celebration', action: 'draft' })).body;
    expect(draft).toMatchObject({ status: 'Draft', sentAt: null });
    expect(draft.stats.recipients).toBe(0);
    expect((await R('GET', '/v1/announcements')).body.some((x: { title: string }) => x.title === 'Diwali celebration')).toBe(false);
    const edited = (await A('PUT', `/comms/messages/${draft.id}`, { ...base, title: 'Diwali celebration at the clubhouse', type: 'Event', action: 'draft' })).body;
    expect(edited).toMatchObject({ title: 'Diwali celebration at the clubhouse', type: 'Event', status: 'Draft' });
    expect((await A('POST', `/comms/messages/${draft.id}/send`)).body.status).toBe('Sent');
    expect((await A('PUT', `/comms/messages/${draft.id}`, { ...base, action: 'draft' })).body.error.code).toBe('locked');
    expect((await A('POST', `/comms/messages/${draft.id}/cancel`)).body.error.code).toBe('already_sent');

    expect((await A('POST', '/comms/messages', { ...base, action: 'schedule' })).body.error.code).toBe('when');
    expect((await A('POST', '/comms/messages', { ...base, action: 'schedule', scheduledAt: new Date(Date.now() - 3600e3).toISOString() })).body.error.code).toBe('in_the_past');
    const at = new Date(Date.now() + 30 * 60_000);
    const sched = (await A('POST', '/comms/messages', { ...base, title: 'Generator test tomorrow', action: 'schedule', scheduledAt: at.toISOString() })).body;
    expect(sched.status).toBe('Scheduled');
    const dropped = (await A('POST', '/comms/messages', { ...base, title: 'Never sent', action: 'schedule', scheduledAt: at.toISOString() })).body;
    expect((await A('POST', `/comms/messages/${dropped.id}/cancel`)).body.status).toBe('Cancelled');
    expect(await sendDue(t.db, t.messenger)).toBe(0); // not yet due
    expect(await sendDue(t.db, t.messenger, new Date(at.getTime() + 60_000))).toBe(1);
    expect((await A('GET', `/comms/messages/${sched.id}`)).body).toMatchObject({ status: 'Sent' });
    expect((await R('GET', '/v1/announcements')).body.some((x: { title: string }) => x.title === 'Generator test tomorrow')).toBe(true);
    expect((await R('GET', '/v1/announcements')).body.some((x: { title: string }) => x.title === 'Never sent')).toBe(false);
  });

  it('refuses an audience with nobody in it, and unknown attachments', async () => {
    const none = await A('POST', '/comms/messages', { ...base, audience: { kind: 'towers', towers: ['Tower 99'] } });
    expect(none.body.error.code).toBe('nobody');
    expect((await A('GET', '/comms/messages?q=Tower 99')).body).toHaveLength(0);
    expect((await A('POST', '/comms/messages', { ...base, attachmentUrl: 'https://evil.example/x.pdf' })).body.error.code).toBe('bad_attachment');
    const ok = await A('POST', '/comms/messages', { ...base, title: 'Minutes of the last meeting', attachmentUrl: 'http://api.test/files/minutes.pdf', attachmentName: 'Minutes.pdf', channels: ['portal'] });
    expect(ok.status).toBe(201);
    expect((await R('GET', '/v1/announcements')).body.find((x: { title: string }) => x.title === 'Minutes of the last meeting')).toMatchObject({ attachmentName: 'Minutes.pdf' });
  });

  it('the templates that were taken out of the product are gone; writing a message from scratch still works', async () => {
    expect((await A('GET', '/comms/templates')).status).toBe(404);
    expect((await A('POST', '/comms/templates', { name: 'Tank cleaning', type: 'Notice', title: 'Water tank cleaning', body: 'The overhead tanks will be cleaned.' })).status).toBe(404);
  });

  it('the old "publish announcement" lands in the same history', async () => {
    const pub = await A('POST', '/announcements', { title: 'Parking stickers', body: 'Collect your new parking stickers from the office.', priority: 'High', requiresAck: true });
    expect(pub.status).toBe(201);
    expect(pub.body.ref).toMatch(/^AN-\d+$/);
    const inHub = (await A('GET', '/comms/messages?q=Parking')).body;
    expect(inHub).toHaveLength(1);
    expect(inHub[0]).toMatchObject({ status: 'Sent', audienceLabel: 'All residents', priority: 'Important', requiresAck: true });
    // acknowledging counts as reading
    const notice = (await R('GET', '/v1/announcements')).body.find((x: { title: string }) => x.title === 'Parking stickers');
    await R('POST', `/v1/announcements/${notice.id}/ack`);
    expect((await A('GET', `/comms/messages/${inHub[0].id}`)).body.stats.read).toBe(1);
  });

  it('reports delivery, reading and problems; and one resident’s whole history', async () => {
    const r = (await A('GET', '/comms/report')).body;
    expect(r.totals.sent).toBeGreaterThanOrEqual(8);
    expect(r.byChannel.find((c: { channel: string }) => c.channel === 'email')).toMatchObject({ total: 6, reached: 2, skipped: 3, failed: 1 });
    expect(r.readRate).toBeGreaterThan(0);
    expect(r.problems.some((p: { name: string; status: string }) => p.name === 'Rohit Sharma' && p.status === 'Failed')).toBe(true);
    expect(r.byTower.find((x: { tower: string }) => x.tower === 'Tower 4').notices).toBeGreaterThan(r.byTower.find((x: { tower: string }) => x.tower === 'Tower 2').notices);
    const me = (await t.call('GET', '/v1/me', { token: ananya })).body.user.id;
    const h = (await A('GET', `/comms/history/${me}`)).body;
    expect(h.sent.length).toBeGreaterThanOrEqual(8);
    expect(h.sent.some((x: { channel: string; status: string }) => x.channel === 'email' && x.status === 'Sent')).toBe(true);
  });

  it('polishes a rough draft without an AI key, using the built-in rules', async () => {
    const p = (await A('POST', '/comms/polish', { text: 'water off friday 10 to 2 pls store water', tone: 'Formal' })).body;
    expect(p.by).toBe('rules');
    expect(p.text.length).toBeGreaterThan(10);
  });

  it('is closed to residents, and to staff of another society', async () => {
    expect((await R('GET', `/v1/admin/${t.associationId}/comms/messages`)).status).toBe(403);
    expect((await R('POST', `/v1/admin/${t.associationId}/comms/messages`, base)).status).toBe(403);
    expect((await t.call('GET', `/v1/admin/${t.greenMeadows}/comms/messages`, { token: admin })).status).toBe(403);
  });
});

describe('direct messages between a resident and the office', () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let admin = '', ananya = '', rohit = '';
  const A = (m: 'GET' | 'POST', path: string, body?: unknown) => t.call(m, `/v1/admin/${t.associationId}${path}`, { token: admin, body });
  const R = (m: 'GET' | 'POST', url: string, body?: unknown, token = ananya) => t.call(m, url, { token, body });

  beforeAll(async () => {
    t = await testApp();
    admin = (await t.staffIn()).accessToken;
    ananya = (await t.signIn()).accessToken;
    rohit = (await t.signIn('9900112233')).accessToken;
  });
  afterAll(async () => { await t?.close(); });

  it('resident writes, office replies, both sides see read state; closing and reopening', async () => {
    const made = await R('POST', '/v1/conversations', { subject: 'Receipt for October', topic: 'Rent & dues', text: 'Could I get a copy of my October maintenance receipt?' });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ subject: 'Receipt for October', topic: 'Rent & dues', status: 'Open' });
    const id = made.body.id;
    // the office is alerted and sees it unread
    const inbox = (await A('GET', '/conversations')).body;
    expect(inbox[0]).toMatchObject({ id, resident: 'Ananya Iyer', unit: 'T4-1108', unread: 1, lastFrom: 'resident' });
    expect((await t.call('GET', '/v1/notifications', { token: admin })).body[0]).toMatchObject({ kind: 'messages', title: 'Ananya Iyer (T4-1108): Receipt for October' });
    // opening it reads it
    const opened = (await A('GET', `/conversations/${id}`)).body;
    expect(opened.messages).toHaveLength(1);
    expect((await A('GET', '/conversations')).body[0].unread).toBe(0);
    expect((await R('GET', `/v1/conversations/${id}`)).body.messages[0].readAt).toBeTruthy();

    const reply = (await A('POST', `/conversations/${id}/messages`, { text: 'Attached. Let us know if anything is missing.', attachmentUrl: 'http://api.test/files/receipt.pdf' })).body;
    expect(reply.messages[1]).toMatchObject({ from: 'staff', by: 'Sanjana Rao (Secretary)', attachmentUrl: 'http://api.test/files/receipt.pdf', readAt: null });
    expect((await R('GET', '/v1/conversations')).body[0]).toMatchObject({ id, unread: 1, lastFrom: 'staff' });
    expect((await R('GET', '/v1/notifications')).body[0]).toMatchObject({ kind: 'messages', title: 'Society office replied', href: '/messages/' + id });

    expect((await A('POST', `/conversations/${id}/status`, { status: 'Closed' })).body.status).toBe('Closed');
    expect((await A('GET', '/conversations?status=Open')).body).toHaveLength(0);
    // the resident writing again reopens it
    expect((await R('POST', `/v1/conversations/${id}/messages`, { text: 'Thank you!' })).body.status).toBe('Open');
    expect((await A('GET', '/conversations?status=Open')).body[0].unread).toBe(1);
  });

  it('the office can write first; nobody else can read a conversation', async () => {
    const me = (await t.call('GET', '/v1/me', { token: rohit })).body.user.id;
    const made = await A('POST', '/conversations', { userId: me, subject: 'Parking slot change', topic: 'General', text: 'Your slot moves to B2-14 from Monday.' });
    expect(made.status).toBe(201);
    expect((await R('GET', '/v1/conversations', undefined, rohit)).body[0]).toMatchObject({ subject: 'Parking slot change', unread: 1 });
    expect((await R('GET', `/v1/conversations/${made.body.id}`)).status).toBe(404); // another resident
    expect((await R('POST', `/v1/conversations/${made.body.id}/messages`, { text: 'hi' })).status).toBe(404);
    expect((await R('GET', `/v1/admin/${t.associationId}/conversations`)).status).toBe(403);
    expect((await A('POST', '/conversations', { userId: '00000000-0000-4000-8000-000000000000', subject: 'Nobody', text: 'x' })).status).toBe(404);
    // it shows in that resident's communication history
    expect((await A('GET', `/comms/history/${me}`)).body.conversations[0].subject).toBe('Parking slot change');
  });
});
