import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../app.js';
import {
  activeDays, announcementAcks, blocks, devices, events, eventSuggestions, gratitudes, issues, notifications, pollOptions, polls, posts, reactions, refreshTokens,
  replies, rsvps, unitMembers, users, userSettings, votes,
} from '../db/schema.js';
import { audit } from '../lib/audit.js';
import { eraseAccount } from '../lib/erase.js';
import { residentOf, userIdFrom } from '../lib/auth.js';
import { DEFAULT_NOTIF, DEFAULT_PRIVACY } from '../lib/community.js';
import { conflict, forbidden, notFound, parse } from '../lib/http.js';

const Phone = z.string().regex(/^[6-9]\d{9}$/, 'Mobile numbers have 10 digits and start with 6, 7, 8 or 9');
const Flags = z.record(z.string(), z.boolean());

export const accountRoutes = ({ config, db }: Deps): FastifyPluginAsync => async app => {
  const me = async (req: FastifyRequest) => residentOf(db, await userIdFrom(req, config.JWT_SECRET));

  /* ---------- notifications ----------
     For anyone signed in — residents, vendors and staff all get them — so these need a login, not a flat. */
  app.get('/notifications', async req => {
    const r = { userId: await userIdFrom(req, config.JWT_SECRET) };
    return db.select({ id: notifications.id, kind: notifications.kind, title: notifications.title, body: notifications.body, href: notifications.href, read: sql<boolean>`${notifications.readAt} is not null`, createdAt: notifications.createdAt })
      .from(notifications).where(eq(notifications.userId, r.userId)).orderBy(desc(notifications.createdAt)).limit(100);
  });
  app.post('/notifications/:id/read', async req => {
    const r = { userId: await userIdFrom(req, config.JWT_SECRET) };
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, id), eq(notifications.userId, r.userId), isNull(notifications.readAt)));
    return { read: true };
  });
  app.post('/notifications/read-all', async req => {
    const r = { userId: await userIdFrom(req, config.JWT_SECRET) };
    await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, r.userId), isNull(notifications.readAt)));
    return { read: true };
  });

  /** this phone's push token — sent once a Firebase project is configured */
  app.post('/devices', async req => {
    const r = { userId: await userIdFrom(req, config.JWT_SECRET) };
    const b = parse(z.object({ token: z.string().min(10).max(500), platform: z.enum(['android', 'ios', 'web']) }), req.body);
    await db.insert(devices).values({ userId: r.userId, ...b }).onConflictDoUpdate({ target: devices.token, set: { userId: r.userId, platform: b.platform } });
    return { registered: true };
  });

  /* ---------- settings ---------- */
  const settingsOf = async (userId: string) => {
    const [s] = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
    return { notif: { ...DEFAULT_NOTIF, ...s?.notif }, privacy: { ...DEFAULT_PRIVACY, ...s?.privacy } };
  };
  app.get('/settings', async req => settingsOf((await me(req)).userId));
  app.put('/settings', async req => {
    const r = await me(req);
    const b = parse(z.object({ notif: Flags.optional(), privacy: Flags.optional() }), req.body);
    const cur = await settingsOf(r.userId);
    // only the switches we know — anything else in the body is ignored
    const pick = <T extends Record<string, boolean>>(base: T, patch?: Record<string, boolean>) =>
      Object.fromEntries(Object.keys(base).map(k => [k, patch?.[k] ?? base[k]])) as T;
    const next = { notif: pick(cur.notif, b.notif), privacy: pick(cur.privacy, b.privacy) };
    await db.insert(userSettings).values({ userId: r.userId, ...next }).onConflictDoUpdate({ target: userSettings.userId, set: next });
    return next;
  });

  /* ---------- unit & family ---------- */
  app.get('/family', async req => {
    const r = await me(req);
    const rows = await db.select({ id: unitMembers.id, userId: users.id, name: users.name, phone: users.phone, role: unitMembers.role, status: unitMembers.status })
      .from(unitMembers).innerJoin(users, eq(users.id, unitMembers.userId)).where(eq(unitMembers.unitId, r.unitId)).orderBy(unitMembers.createdAt);
    return rows.map(m => ({ ...m, you: m.userId === r.userId }));
  });

  /** Owners add household members; they can sign in once the society office verifies them. */
  app.post('/family', async (req, reply) => {
    const r = await me(req);
    if (r.role !== 'Owner') throw forbidden('Only the flat’s owner can add members.');
    const b = parse(z.object({ name: z.string().trim().min(2).max(80), phone: Phone, role: z.enum(['Tenant', 'Family']) }), req.body);
    const row = await db.transaction(async tx => {
      let [u] = await tx.select().from(users).where(eq(users.phone, b.phone));
      if (u?.deletedAt) throw conflict('number_unavailable', 'That number can’t be added. Contact your society office.');
      if (!u) [u] = await tx.insert(users).values({ name: b.name, phone: b.phone }).returning();
      if (!u) throw new Error('insert failed');
      const [m] = await tx.insert(unitMembers).values({ unitId: r.unitId, userId: u.id, role: b.role, status: 'pending' }).onConflictDoNothing().returning();
      if (!m) throw conflict('already_member', 'That number is already part of this flat.');
      await audit(tx, r.associationId, r.userId, 'System', `family member added · ${b.name} (${b.role}) → ${r.unitCode} · pending verification`);
      return { id: m.id, userId: u.id, name: u.name, phone: u.phone, role: m.role, status: m.status, you: false };
    });
    return reply.status(201).send(row);
  });

  app.delete('/family/:id', async (req, reply) => {
    const r = await me(req);
    if (r.role !== 'Owner') throw forbidden('Only the flat’s owner can remove members.');
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const [m] = await db.select().from(unitMembers).where(and(eq(unitMembers.id, id), eq(unitMembers.unitId, r.unitId)));
    if (!m) throw notFound('Member');
    if (m.userId === r.userId) throw conflict('cannot_remove_self', 'You can’t remove yourself from your flat.');
    await db.delete(unitMembers).where(eq(unitMembers.id, id));
    // they lose access with their flat
    await db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.userId, m.userId), isNull(refreshTokens.revokedAt)));
    return reply.status(204).send();
  });

  /* ---------- event ideas ---------- */
  app.get('/event-suggestions', async req => {
    const r = await me(req);
    return db.select({ id: eventSuggestions.id, title: eventSuggestions.title, when: eventSuggestions.whenText, where: eventSuggestions.location, note: eventSuggestions.note, status: eventSuggestions.status })
      .from(eventSuggestions).where(and(eq(eventSuggestions.associationId, r.associationId), eq(eventSuggestions.userId, r.userId))).orderBy(desc(eventSuggestions.createdAt));
  });
  app.post('/event-suggestions', async (req, reply) => {
    const r = await me(req);
    const b = parse(z.object({ title: z.string().trim().min(3).max(80), when: z.string().trim().min(3).max(60), where: z.string().trim().min(2).max(60), note: z.string().trim().max(300).default('') }), req.body);
    const [s] = await db.insert(eventSuggestions).values({ associationId: r.associationId, userId: r.userId, title: b.title, whenText: b.when, location: b.where, note: b.note }).returning();
    await audit(db, r.associationId, r.userId, `${r.name} (${r.unitCode})`, `event suggestion · ${b.title} · awaiting committee`);
    return reply.status(201).send({ id: s!.id, title: b.title, when: b.when, where: b.where, note: b.note, status: 'pending' });
  });

  /* ---------- your data ---------- */
  /** Everything we hold about the caller, as JSON (DPDP Act: right to access). */
  app.get('/me/export', async req => {
    const r = await me(req);
    const [user] = await db.select({ name: users.name, phone: users.phone, createdAt: users.createdAt }).from(users).where(eq(users.id, r.userId));
    return {
      exportedAt: new Date().toISOString(),
      resident: { ...user, unit: r.unitCode, role: r.role },
      issues: await db.select({ number: issues.number, title: issues.title, category: issues.category, location: issues.location, priority: issues.priority, status: issues.status, rating: issues.rating, createdAt: issues.createdAt }).from(issues).where(eq(issues.reporterId, r.userId)),
      posts: await db.select({ number: posts.number, title: posts.title, body: posts.body, state: posts.state, createdAt: posts.createdAt }).from(posts).where(eq(posts.authorId, r.userId)),
      replies: await db.select({ text: replies.text, state: replies.state, createdAt: replies.createdAt }).from(replies).where(eq(replies.authorId, r.userId)),
      reactions: await db.select({ kind: reactions.kind, createdAt: reactions.createdAt }).from(reactions).where(eq(reactions.userId, r.userId)),
      votes: await db.select({ poll: polls.question, choice: pollOptions.label, at: votes.createdAt }).from(votes).innerJoin(polls, eq(polls.id, votes.pollId)).innerJoin(pollOptions, eq(pollOptions.id, votes.optionId)).where(eq(votes.userId, r.userId)),
      rsvps: await db.select({ event: events.title, status: rsvps.status, at: rsvps.createdAt }).from(rsvps).innerJoin(events, eq(events.id, rsvps.eventId)).where(eq(rsvps.userId, r.userId)),
      acknowledgements: await db.select({ announcementId: announcementAcks.announcementId, at: announcementAcks.createdAt }).from(announcementAcks).where(eq(announcementAcks.userId, r.userId)),
      gratitudeSent: await db.select({ to: gratitudes.toLabel, category: gratitudes.category, text: gratitudes.text, createdAt: gratitudes.createdAt }).from(gratitudes).where(eq(gratitudes.fromId, r.userId)),
      eventSuggestions: await db.select({ title: eventSuggestions.title, when: eventSuggestions.whenText, status: eventSuggestions.status }).from(eventSuggestions).where(eq(eventSuggestions.userId, r.userId)),
      settings: await settingsOf(r.userId),
      blocked: (await db.select({ name: users.name }).from(blocks).innerJoin(users, eq(users.id, blocks.blockedUserId)).where(eq(blocks.userId, r.userId))).map(b => b.name),
    };
  });

  /**
   * Delete the account (store rules; DPDP right to erasure). Personal details and private content go;
   * issues stay with the society as anonymous records, since the office still has to fix them.
   */
  app.delete('/me', async (req, reply) => {
    const r = await me(req);
    await db.transaction(async tx => {
      await eraseAccount(tx, r.userId);
      await audit(tx, r.associationId, null, 'System', `account deleted at the resident’s request · ${r.unitCode}`);
    });
    return reply.status(204).send();
  });
};
