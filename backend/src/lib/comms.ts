import { and, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import {
  announcements, bills, messageDeliveries, messages, notifications, unitMembers, units, users, userSettings,
  type Audience, type Channel, type DeliveryStatus, type MessageType,
} from '../db/schema.js';
import { audit } from './audit.js';
import { billStatus } from './finance.js';
import { badRequest } from './http.js';
import type { Messenger } from './messenger.js';

/* The communication hub's engine: who a message goes to, sending it on each channel, and recording
   what happened to every copy. */

export type Recipient = { userId: string; name: string; phone: string | null; email: string | null; unit: string; tower: string; role: string };


/** the audience in words, for the record */
export async function audienceLabel(db: DB, associationId: string, a: Audience): Promise<string> {
  if (a.kind === 'all') return 'All residents';
  if (a.kind === 'towers') return a.towers.join(', ');
  if (a.kind === 'role') return a.role === 'Owner' ? 'Owners' : a.role === 'Tenant' ? 'Tenants' : 'Family members';
  if (a.kind === 'units') {
    const rows = await db.select({ code: units.code }).from(units).where(and(eq(units.associationId, associationId), inArray(units.id, a.unitIds)));
    return rows.length <= 4 ? rows.map(r => r.code).join(', ') : `${rows.length} flats`;
  }
  const rows = await db.select({ name: users.name }).from(users).where(inArray(users.id, a.userIds));
  return rows.length <= 3 ? rows.map(r => r.name).join(', ') : `${rows.length} residents`;
}

/** Every verified resident the audience describes, once each — and only ever inside this society. */
export async function resolveAudience(db: DB, associationId: string, a: Audience): Promise<Recipient[]> {
  const rows = await db.select({ userId: users.id, name: users.name, phone: users.phone, email: users.email, unit: units.code, tower: units.tower, role: unitMembers.role, unitId: units.id })
    .from(unitMembers).innerJoin(units, eq(units.id, unitMembers.unitId)).innerJoin(users, eq(users.id, unitMembers.userId))
    .where(and(eq(units.associationId, associationId), eq(unitMembers.status, 'active'), isNull(users.deletedAt)));
  const hit = rows.filter(r =>
    a.kind === 'all' ? true
    : a.kind === 'towers' ? a.towers.includes(r.tower)
    : a.kind === 'units' ? a.unitIds.includes(r.unitId)
    : a.kind === 'role' ? r.role === a.role
    : a.userIds.includes(r.userId));
  const seen = new Set<string>();
  return hit.filter(r => (seen.has(r.userId) ? false : (seen.add(r.userId), true))).map(({ unitId: _u, ...r }) => r);
}

const ICON: Record<MessageType, string> = { Announcement: 'megaphone-outline', Reminder: 'alarm-outline', Notice: 'document-text-outline', Emergency: 'warning-outline', Offer: 'pricetag-outline', Event: 'calendar-outline' };

/**
 * Send a message now: publish it on the notice board if asked, then one delivery per person per channel.
 * Residents who turned promotions off are skipped for promotional messages; emergencies reach everyone.
 */
export async function deliver(db: DB, messenger: Messenger, messageId: string, o: { href?: string } = {}) {
  const [m] = await db.select().from(messages).where(eq(messages.id, messageId));
  if (!m) throw badRequest('no_message', 'That message no longer exists.');
  if (m.status === 'Sent' || m.status === 'Cancelled') throw badRequest('not_sendable', m.status === 'Sent' ? 'This message has already been sent.' : 'This message was cancelled.');
  const people = await resolveAudience(db, m.associationId, m.audience);
  if (!people.length) throw badRequest('nobody', 'Nobody matches that audience — no resident on the app is in it.');

  const prefs = await db.select({ userId: userSettings.userId, notif: userSettings.notif }).from(userSettings).where(inArray(userSettings.userId, people.map(p => p.userId)));
  const optedOut = new Set(m.promotional && m.priority !== 'Emergency' ? prefs.filter(p => p.notif.promos === false).map(p => p.userId) : []);

  let announcementId: string | null = null, ref = '';
  if (m.channels.includes('portal')) {
    const [{ next }] = (await db.select({ next: sql<number>`coalesce(max(substring(${announcements.ref} from 4)::int), 100) + 1` })
      .from(announcements).where(eq(announcements.associationId, m.associationId))) as [{ next: number }];
    ref = 'AN-' + next;
    const [a] = await db.insert(announcements).values({
      associationId: m.associationId, ref, title: m.title, body: m.body, priority: m.priority === 'Normal' ? 'Normal' : 'High', audience: m.audienceLabel,
      requiresAck: m.requiresAck, byName: m.byName, icon: ICON[m.type], type: m.type, startsAt: m.startsAt, expiresAt: m.expiresAt, pinned: m.pinned,
      attachmentUrl: m.attachmentUrl, attachmentName: m.attachmentName, messageId: m.id,
    }).returning();
    announcementId = a!.id;
  }

  const rows: { messageId: string; userId: string; channel: Channel; status: DeliveryStatus; detail: string }[] = [];
  const alerts: { userId: string; kind: 'announcements'; title: string; body: string; href: string | null }[] = [];
  const subject = (m.priority === 'Emergency' ? 'URGENT: ' : m.priority === 'Important' ? 'Important: ' : '') + m.title;
  for (const p of people) {
    for (const channel of m.channels) {
      const row = (status: DeliveryStatus, detail = '') => rows.push({ messageId: m.id, userId: p.userId, channel, status, detail });
      if (optedOut.has(p.userId)) { row('Skipped', 'Switched off promotional messages'); continue; }
      if (channel === 'portal') row('Delivered');
      else if (channel === 'push') {
        alerts.push({ userId: p.userId, kind: 'announcements', title: subject, body: m.body.slice(0, 140), href: ref ? '/announcements/' + ref : o.href ?? null });
        row('Delivered', 'In-app alert. A lock-screen push needs a push service to be connected.');
      } else if (channel === 'email') {
        if (!p.email) row('Skipped', 'No email address on file');
        else { const o = await messenger.send('email', p.email, { subject, body: m.body, attachmentUrl: m.attachmentUrl }); row(o.status, o.detail); }
      } else {
        if (!p.phone) row('Skipped', 'No mobile number on file');
        else { const o = await messenger.send(channel, p.phone, { subject, body: m.body, attachmentUrl: m.attachmentUrl }); row(o.status, o.detail); }
      }
    }
  }
  if (rows.length) await db.insert(messageDeliveries).values(rows).onConflictDoNothing();
  if (alerts.length) await db.insert(notifications).values(alerts);
  const [sent] = await db.update(messages).set({ status: 'Sent', sentAt: new Date(), announcementId }).where(eq(messages.id, m.id)).returning();
  return { message: sent!, recipients: people.length, ref };
}

/** scheduled messages whose time has come — run from a timer */
export async function sendDue(db: DB, messenger: Messenger, now = new Date()) {
  const due = await db.select({ id: messages.id }).from(messages).where(and(eq(messages.status, 'Scheduled'), lte(messages.scheduledAt, now)));
  let sent = 0;
  for (const d of due) {
    try { await deliver(db, messenger, d.id); sent++; }
    catch { await db.update(messages).set({ status: 'Cancelled' }).where(eq(messages.id, d.id)); } // nobody left in the audience
  }
  return sent;
}

/** remind every flat with something overdue — recorded in the communication hub like any other message */
export async function remindOverdue(db: DB, messenger: Messenger, aid: string, by: { userId: string | null; name: string }) {
  const late = (await db.select().from(bills).where(and(eq(bills.associationId, aid), isNull(bills.cancelledAt)))).filter(b => billStatus(b) === 'Overdue');
  const unitIds = [...new Set(late.map(b => b.unitId))];
  if (!unitIds.length) return { flats: 0, residents: 0 };
  const [{ next }] = (await db.select({ next: sql<number>`coalesce(max(${messages.number}), 100) + 1` }).from(messages).where(eq(messages.associationId, aid))) as [{ next: number }];
  const [m] = await db.insert(messages).values({ associationId: aid, number: next, type: 'Reminder', title: 'Payment overdue', priority: 'Important',
    body: 'A payment for your flat is past its due date. Please open the app to see what is outstanding and pay. If you have already paid, share the reference with the society office.',
    channels: ['push'], audience: { kind: 'units', unitIds }, audienceLabel: `${unitIds.length} flats with overdue dues`, source: 'payment_overdue', createdBy: by.userId, byName: by.name }).returning();
  const residents = await deliver(db, messenger, m!.id, { href: '/dues' }).then(r => r.recipients).catch(async () => { await db.delete(messages).where(eq(messages.id, m!.id)); return 0; });
  await audit(db, aid, by.userId, by.name, `sent overdue reminders to ${unitIds.length} flats`);
  return { flats: unitIds.length, residents };
}
