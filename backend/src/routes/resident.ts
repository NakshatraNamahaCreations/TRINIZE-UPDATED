import { and, asc, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../app.js';
import { activeDays, announcementAcks, announcements, associations, chatMessages, contacts, events, gratitudes, messageDeliveries, pollOptions, polls, rsvps, votes } from '../db/schema.js';
import { residentOf, userIdFrom } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { conflict, forbidden, notFound, parse } from '../lib/http.js';

const Id = z.object({ id: z.uuid() });

export const residentRoutes = ({ config, db }: Deps): FastifyPluginAsync => async app => {
  const me = async (req: FastifyRequest) => residentOf(db, await userIdFrom(req, config.JWT_SECRET));

  app.get('/me', async req => {
    const r = await me(req);
    const [society] = await db.select().from(associations).where(eq(associations.id, r.associationId));
    return { user: { id: r.userId, name: r.name }, unit: { id: r.unitId, code: r.unitCode, label: r.unitLabel }, role: r.role, society };
  });

  /**
   * The resident's own numbers for the impact screen. Asking also counts as opening the app today, so
   * the app calls this once each time it starts or is refreshed. Days are India days, whatever the server's clock.
   */
  app.post('/me/impact', async req => {
    const r = await me(req);
    const today = sql<string>`(now() at time zone 'Asia/Kolkata')::date`;
    await db.insert(activeDays).values({ userId: r.userId, day: today }).onConflictDoNothing();
    const rows = await db.select({ day: sql<string>`${activeDays.day}::text`, ago: sql<number>`((now() at time zone 'Asia/Kolkata')::date - ${activeDays.day})::int` })
      .from(activeDays).where(eq(activeDays.userId, r.userId)).orderBy(desc(activeDays.day)).limit(400);
    const on = new Set(rows.map(x => x.ago)); // 0 = today, 1 = yesterday…
    let streak = 0;
    while (on.has(streak)) streak++;
    // the longest unbroken run on record
    let best = 0, run = 0, prev = -2;
    for (const a of [...on].sort((x, y) => x - y)) { run = a === prev + 1 ? run + 1 : 1; best = Math.max(best, run); prev = a; }
    const asked = await db.select({ text: chatMessages.text }).from(chatMessages).where(and(eq(chatMessages.userId, r.userId), eq(chatMessages.role, 'user'), eq(chatMessages.flow, false))).orderBy(desc(chatMessages.createdAt)).limit(4);
    const [c] = await db.select({ n: sql<number>`count(*)::int` }).from(chatMessages).where(and(eq(chatMessages.userId, r.userId), eq(chatMessages.role, 'user'), eq(chatMessages.flow, false)));
    const [g] = await db.select({ n: sql<number>`count(*)::int` }).from(gratitudes).where(eq(gratitudes.fromId, r.userId));
    return {
      days: rows.filter(x => x.ago < 90).length, streak, best,
      /** the last 14 days, oldest first: was the app opened that day */
      last14: Array.from({ length: 14 }, (_, i) => on.has(13 - i)),
      chats: c?.n ?? 0, recentQuestions: asked.map(x => x.text), gratitudes: g?.n ?? 0,
    };
  });

  /* ---------- notices ---------- */
  app.get('/announcements', async req => {
    const r = await me(req);
    return db.select({
      id: announcements.id, ref: announcements.ref, title: announcements.title, body: announcements.body, priority: announcements.priority,
      audience: announcements.audience, requiresAck: announcements.requiresAck, by: announcements.byName, icon: announcements.icon,
      publishedAt: announcements.publishedAt, type: announcements.type, pinned: announcements.pinned, expiresAt: announcements.expiresAt,
      attachmentUrl: announcements.attachmentUrl, attachmentName: announcements.attachmentName,
      acked: sql<boolean>`exists (select 1 from ${announcementAcks} a where a.announcement_id = ${announcements.id} and a.user_id = ${r.userId})`,
    }).from(announcements).where(and(
      eq(announcements.associationId, r.associationId),
      // the notice board shows what is current: started, not expired…
      sql`(${announcements.startsAt} is null or ${announcements.startsAt} <= now())`, sql`(${announcements.expiresAt} is null or ${announcements.expiresAt} > now())`,
      // …and, for a notice sent to part of the society, only to the people it was sent to
      sql`(${announcements.messageId} is null or exists (select 1 from ${messageDeliveries} d where d.message_id = ${announcements.messageId} and d.user_id = ${r.userId} and d.channel = 'portal' and d.status = 'Delivered'))`,
    )).orderBy(desc(announcements.pinned), desc(announcements.publishedAt));
  });

  /** the resident opened a notice: this is what the office's read report counts */
  app.post('/announcements/:id/seen', async req => {
    const r = await me(req);
    const { id } = parse(Id, req.params);
    const [a] = await db.select({ messageId: announcements.messageId }).from(announcements).where(and(eq(announcements.id, id), eq(announcements.associationId, r.associationId)));
    if (!a) throw notFound('Notice');
    if (a.messageId) await db.update(messageDeliveries).set({ readAt: new Date() })
      .where(and(eq(messageDeliveries.messageId, a.messageId), eq(messageDeliveries.userId, r.userId), eq(messageDeliveries.channel, 'portal'), isNull(messageDeliveries.readAt)));
    return { seen: true };
  });

  app.post('/announcements/:id/ack', async req => {
    const r = await me(req);
    const { id } = parse(Id, req.params);
    const [a] = await db.select().from(announcements).where(and(eq(announcements.id, id), eq(announcements.associationId, r.associationId)));
    if (!a) throw notFound('Notice');
    const done = await db.insert(announcementAcks).values({ announcementId: id, userId: r.userId }).onConflictDoNothing().returning();
    // acknowledging is also reading
    if (a.messageId) await db.update(messageDeliveries).set({ readAt: new Date() })
      .where(and(eq(messageDeliveries.messageId, a.messageId), eq(messageDeliveries.userId, r.userId), eq(messageDeliveries.channel, 'portal'), isNull(messageDeliveries.readAt)));
    if (done.length) await audit(db, r.associationId, r.userId, 'System', `acknowledgement recorded · ${r.name} (${r.unitCode}) · ${a.ref}`);
    return { acked: true };
  });

  /* ---------- events ---------- */
  app.get('/events', async req => {
    const r = await me(req);
    const { scope } = parse(z.object({ scope: z.enum(['upcoming', 'past']).default('upcoming') }), req.query);
    const now = new Date();
    // an event is "past" once it has ended, not when it starts
    const ends = sql`${events.startsAt} + make_interval(mins => ${events.minutes})`;
    return db.select({
      id: events.id, title: events.title, description: events.description, location: events.location, startsAt: events.startsAt,
      minutes: events.minutes, capacity: events.capacity, icon: events.icon,
      going: sql<number>`${events.baseGoing} + (select count(*)::int from ${rsvps} v where v.event_id = ${events.id} and v.status = 'Going')`,
      mine: sql<'Going' | 'Waitlist' | null>`(select v.status from ${rsvps} v where v.event_id = ${events.id} and v.user_id = ${r.userId})`,
    }).from(events)
      .where(and(eq(events.associationId, r.associationId), scope === 'upcoming' ? gte(ends, now) : lt(ends, now)))
      .orderBy(scope === 'upcoming' ? asc(events.startsAt) : desc(events.startsAt));
  });

  /** RSVP: a seat while there is one, otherwise the waitlist. Asking twice changes nothing. */
  app.post('/events/:id/rsvp', async req => {
    const r = await me(req);
    const { id } = parse(Id, req.params);
    return db.transaction(async tx => {
      const [e] = await tx.select().from(events).where(and(eq(events.id, id), eq(events.associationId, r.associationId))).for('update');
      if (!e) throw notFound('Event');
      if (e.startsAt.getTime() < Date.now()) throw conflict('event_started', 'This event has already started.');
      const [existing] = await tx.select().from(rsvps).where(and(eq(rsvps.eventId, id), eq(rsvps.userId, r.userId)));
      if (existing) return { status: existing.status };
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(rsvps).where(and(eq(rsvps.eventId, id), eq(rsvps.status, 'Going')))) as [{ n: number }];
      const status = e.baseGoing + n >= e.capacity ? 'Waitlist' : 'Going';
      await tx.insert(rsvps).values({ eventId: id, userId: r.userId, status });
      await audit(tx, r.associationId, r.userId, 'System', `${status === 'Going' ? 'RSVP' : 'waitlist join'} recorded for ${e.title} · ${r.name} (${r.unitCode})`);
      return { status };
    });
  });

  app.delete('/events/:id/rsvp', async (req, reply) => {
    const r = await me(req);
    const { id } = parse(Id, req.params);
    await db.delete(rsvps).where(and(eq(rsvps.eventId, id), eq(rsvps.userId, r.userId)));
    return reply.status(204).send();
  });

  /* ---------- polls ---------- */
  app.get('/polls', async req => {
    const r = await me(req);
    const list = await db.select().from(polls).where(eq(polls.associationId, r.associationId)).orderBy(desc(polls.createdAt));
    const out = [];
    for (const p of list) {
      const opts = await db.select({
        id: pollOptions.id, label: pollOptions.label,
        votes: sql<number>`${pollOptions.baseVotes} + (select count(*)::int from ${votes} v where v.option_id = ${pollOptions.id})`,
      }).from(pollOptions).where(eq(pollOptions.pollId, p.id)).orderBy(asc(pollOptions.position));
      const [mine] = await db.select({ optionId: votes.optionId }).from(votes).where(and(eq(votes.pollId, p.id), eq(votes.unitId, r.unitId)));
      out.push({
        id: p.id, question: p.question, eligibility: p.eligibility, closesAt: p.closesAt,
        // closes on its end date even if nobody closes it by hand
        closed: !!p.closedAt || p.closesAt.getTime() < Date.now(),
        canVote: p.eligibility === 'all' || r.role === 'Owner',
        options: opts, myOptionId: mine?.optionId ?? null,
      });
    }
    return out;
  });

  /** One vote per flat — the primary key on (poll, unit) makes a second vote impossible, even from another phone. */
  app.post('/polls/:id/vote', async req => {
    const r = await me(req);
    const { id } = parse(Id, req.params);
    const { optionId } = parse(z.object({ optionId: z.uuid() }), req.body);
    const [p] = await db.select().from(polls).where(and(eq(polls.id, id), eq(polls.associationId, r.associationId)));
    if (!p) throw notFound('Poll');
    if (p.closedAt || p.closesAt.getTime() < Date.now()) throw conflict('poll_closed', 'This poll has closed.');
    if (p.eligibility === 'owners' && r.role !== 'Owner') throw forbidden('Only owners can vote in this poll.');
    const [opt] = await db.select().from(pollOptions).where(and(eq(pollOptions.id, optionId), eq(pollOptions.pollId, id)));
    if (!opt) throw notFound('Option');
    const done = await db.insert(votes).values({ pollId: id, unitId: r.unitId, optionId, userId: r.userId }).onConflictDoNothing().returning();
    if (!done.length) throw conflict('already_voted', 'Your flat has already voted in this poll.');
    // the choice stays private: the audit records that the flat voted, not how
    await audit(db, r.associationId, r.userId, 'System', `vote recorded on “${p.question}” · ${r.unitCode} (choice private)`);
    return { voted: true, optionId };
  });

  /* ---------- directory ---------- */
  app.get('/directory', async req => {
    const r = await me(req);
    const rows = await db.select({ group: contacts.group, name: contacts.name, role: contacts.role, phone: contacts.phone })
      .from(contacts).where(eq(contacts.associationId, r.associationId)).orderBy(asc(contacts.position));
    return {
      committee: rows.filter(c => c.group === 'committee'),
      emergency: rows.filter(c => c.group === 'emergency'),
      vendors: rows.filter(c => c.group === 'vendors'),
    };
  });
};
