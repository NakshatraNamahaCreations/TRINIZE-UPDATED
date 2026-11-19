import { and, eq, inArray, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { aiSettings, associations, moderationItems, notifications, standings, unitMembers, units, userSettings, type NotifKind } from '../db/schema.js';
import { forbidden } from './http.js';
import type { Threshold } from './safety.js';

type Writer = Pick<DB, 'insert' | 'select' | 'selectDistinct'>;

export const DEFAULT_NOTIF = { announcements: true, events: true, polls: true, discussions: false, gratitude: true, issues: true, visitors: true, messages: true, payments: true, promos: true, quiet: true };
export const DEFAULT_PRIVACY = { showFlat: true, showPhone: false, aiHistory: true };

export async function thresholdOf(db: Writer, associationId: string): Promise<Threshold> {
  const [a] = await db.select({ t: associations.moderationThreshold }).from(associations).where(eq(associations.id, associationId));
  return a?.t ?? 'Standard';
}

/**
 * In-app notification, respecting the resident's own switches. Push delivery (FCM) hooks in here once a
 * Firebase project exists; quiet hours will apply to push only — the in-app list always records it.
 */
export async function notify(db: Writer, userIds: string[], n: { kind: NotifKind; title: string; body: string; href?: string }) {
  if (!userIds.length) return;
  const prefs = await db.select({ userId: userSettings.userId, notif: userSettings.notif }).from(userSettings).where(inArray(userSettings.userId, userIds));
  const off = new Set(prefs.filter(p => p.notif[n.kind] === false).map(p => p.userId));
  // "discussions" is off by default, so residents without saved settings follow the defaults
  const saved = new Set(prefs.map(p => p.userId));
  const to = userIds.filter(u => (saved.has(u) ? !off.has(u) : DEFAULT_NOTIF[n.kind]));
  if (to.length) await db.insert(notifications).values(to.map(userId => ({ userId, kind: n.kind, title: n.title, body: n.body, href: n.href ?? null })));
}

/** every verified resident of a society — for announcements */
export async function residentsOf(db: Writer, associationId: string) {
  const rows = await db.selectDistinct({ userId: unitMembers.userId }).from(unitMembers).innerJoin(units, eq(units.id, unitMembers.unitId))
    .where(and(eq(units.associationId, associationId), eq(unitMembers.status, 'active')));
  return rows.map(r => r.userId);
}

/** does this society keep borderline (warned) text out of view until a moderator has looked? Abusive text is always stopped. */
export async function holdsBorderline(db: Writer, associationId: string) {
  const [s] = await db.select({ autoHold: aiSettings.autoHold }).from(aiSettings).where(eq(aiSettings.associationId, associationId));
  return (s?.autoHold ?? 'Medium & above') === 'Medium & above';
}

/** Put something in front of the moderators. Returns its MOD- number. */
export async function queueForModeration(db: Writer, o: {
  associationId: string; kind: string; authorId: string | null; text: string; category: string; severity: 'Low' | 'Medium' | 'High';
  reason: string; context: string; targetType?: 'post' | 'reply' | 'gratitude'; targetId?: string;
}) {
  const [{ next }] = (await db.select({ next: sql<number>`coalesce(max(${moderationItems.number}), 88) + 1` }).from(moderationItems)
    .where(eq(moderationItems.associationId, o.associationId))) as [{ next: number }];
  await db.insert(moderationItems).values({ ...o, number: next, targetType: o.targetType ?? null, targetId: o.targetId ?? null });
  return next;
}

/** Restricted and suspended residents can read but not post. */
export async function assertCanPost(db: Writer, userId: string, associationId: string) {
  const [s] = await db.select({ status: standings.status }).from(standings).where(and(eq(standings.userId, userId), eq(standings.associationId, associationId)));
  if (s && (s.status === 'Restricted' || s.status === 'Suspended' || s.status === 'Blocked')) throw forbidden('Posting is paused on your account. Contact your society office.');
}
