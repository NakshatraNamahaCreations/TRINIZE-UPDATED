import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../app.js';
import {
  associations, events, eventSuggestions, gratitudes, moderationItems, pollOptions, polls, posts, refreshTokens, replies, rsvps, staffRoles, standings, unitMembers, units, users, votes,
  type StaffRole,
} from '../db/schema.js';
import { audit } from '../lib/audit.js';
import { eraseAccount } from '../lib/erase.js';
import { forgetBlocked, staffOf, userIdFrom } from '../lib/auth.js';
import { notify, residentsOf } from '../lib/community.js';
import { conflict, notFound, parse } from '../lib/http.js';

const Aid = z.object({ aid: z.uuid() });
const AidId = Aid.extend({ id: z.uuid() });
const ACTIONS = ['Allowed', 'Warned author', 'Rewrite suggested', 'Hidden'] as const;

/** Society Admin, Phase 2: moderation, events and polls, event ideas, residents' standing. */
export const admin2Routes = ({ config, db }: Deps): FastifyPluginAsync => async app => {
  const staff = async (req: FastifyRequest, roles: StaffRole[] = ['admin', 'committee', 'moderator', 'operator']) => {
    const { aid } = parse(Aid, req.params);
    return { aid, s: await staffOf(db, await userIdFrom(req, config.JWT_SECRET), aid, roles) };
  };

  /* ---------- moderation ---------- */
  app.get('/:aid/moderation', async req => {
    const { aid } = await staff(req);
    const { state } = parse(z.object({ state: z.enum(['open', 'done']).default('open') }), req.query);
    const rows = await db.select({
      id: moderationItems.id, number: moderationItems.number, kind: moderationItems.kind, text: moderationItems.text, category: moderationItems.category,
      severity: moderationItems.severity, reason: moderationItems.reason, context: moderationItems.context, state: moderationItems.state,
      action: moderationItems.action, createdAt: moderationItems.createdAt, resolvedAt: moderationItems.resolvedAt, authorId: moderationItems.authorId, by: users.name,
      unit: sql<string | null>`(select u.code from unit_members m join units u on u.id = m.unit_id where m.user_id = ${moderationItems.authorId} limit 1)`,
    }).from(moderationItems).leftJoin(users, eq(users.id, moderationItems.authorId))
      .where(and(eq(moderationItems.associationId, aid), eq(moderationItems.state, state))).orderBy(desc(moderationItems.createdAt));
    return rows.map(({ number, ...m }) => ({ ...m, ref: 'MOD-' + number, by: m.by ?? 'Former resident' }));
  });

  /**
   * Decide an item. Allowed publishes held content; Hidden removes it; Warned author / Rewrite suggested
   * keep it out of view, tell the author, and (for a warning) count against their standing.
   */
  app.post('/:aid/moderation/:id/action', async req => {
    const { aid, s } = await staff(req, ['admin', 'moderator', 'operator']);
    const { id } = parse(AidId, req.params);
    const { action } = parse(z.object({ action: z.enum(ACTIONS) }), req.body);
    return db.transaction(async tx => {
      const [m] = await tx.select().from(moderationItems).where(and(eq(moderationItems.id, id), eq(moderationItems.associationId, aid))).for('update');
      if (!m) throw notFound('Item');
      if (m.state === 'done') throw conflict('already_decided', 'Someone has already decided this one.');
      const visible = action === 'Allowed';
      if (m.targetId) {
        const state = visible ? 'published' : 'hidden';
        if (m.targetType === 'post') await tx.update(posts).set({ state }).where(eq(posts.id, m.targetId));
        if (m.targetType === 'reply') await tx.update(replies).set({ state }).where(eq(replies.id, m.targetId));
        // an allowed gratitude note is delivered; anything else stays undelivered
        if (m.targetType === 'gratitude' && visible) await tx.update(gratitudes).set({ state: 'sent' }).where(eq(gratitudes.id, m.targetId));
      }
      if (action === 'Warned author' && m.authorId) {
        await tx.insert(standings).values({ userId: m.authorId, associationId: aid, status: 'Warned', warnings: 1 })
          .onConflictDoUpdate({ target: [standings.userId, standings.associationId], set: { warnings: sql`${standings.warnings} + 1`, status: sql`case when ${standings.status} = 'Active' then 'Warned' else ${standings.status} end` } });
      }
      await tx.update(moderationItems).set({ state: 'done', action, resolvedBy: s.userId, resolvedAt: new Date() }).where(eq(moderationItems.id, id));
      if (m.authorId && !m.kind.startsWith('Reported')) {
        const body = action === 'Allowed' ? 'A moderator reviewed it and it’s now visible.'
          : action === 'Rewrite suggested' ? 'A moderator asked for it to be rephrased before it can be posted.'
          : action === 'Warned author' ? 'It wasn’t published. Please keep posts respectful — this counts as a warning.'
          : 'A moderator removed it under the community guidelines.';
        await notify(tx, [m.authorId], { kind: 'discussions', title: 'Update on your ' + m.kind.toLowerCase(), body, href: '/profile/account' });
      }
      await audit(tx, aid, s.userId, s.name, `moderation MOD-${m.number} · ${action}`);
      return { ref: 'MOD-' + m.number, state: 'done', action };
    });
  });

  app.put('/:aid/moderation-threshold', async req => {
    const { aid, s } = await staff(req, ['admin', 'operator']);
    const { threshold } = parse(z.object({ threshold: z.enum(['Lenient', 'Standard', 'Strict']) }), req.body);
    await db.update(associations).set({ moderationThreshold: threshold }).where(eq(associations.id, aid));
    await audit(db, aid, s.userId, s.name, `abuse-guard threshold set to ${threshold}`);
    return { threshold };
  });

  /* ---------- events & polls ---------- */
  app.get('/:aid/events', async req => {
    const { aid } = await staff(req);
    return db.select({
      id: events.id, title: events.title, description: events.description, location: events.location, startsAt: events.startsAt, minutes: events.minutes, capacity: events.capacity,
      going: sql<number>`${events.baseGoing} + (select count(*)::int from rsvps v where v.event_id = ${events.id} and v.status = 'Going')`,
      waitlist: sql<number>`(select count(*)::int from rsvps v where v.event_id = ${events.id} and v.status = 'Waitlist')`,
    }).from(events).where(and(eq(events.associationId, aid), sql`${events.startsAt} + make_interval(mins => ${events.minutes}) >= now()`)).orderBy(events.startsAt);
  });

  app.get('/:aid/polls', async req => {
    const { aid } = await staff(req);
    const list = await db.select().from(polls).where(eq(polls.associationId, aid)).orderBy(desc(polls.createdAt));
    const opts = await db.select({
      pollId: pollOptions.pollId, label: pollOptions.label, position: pollOptions.position,
      votes: sql<number>`${pollOptions.baseVotes} + (select count(*)::int from votes v where v.option_id = ${pollOptions.id})`,
    }).from(pollOptions).innerJoin(polls, eq(polls.id, pollOptions.pollId)).where(eq(polls.associationId, aid)).orderBy(pollOptions.position);
    return list.map(p => ({
      id: p.id, question: p.question, eligibility: p.eligibility, closesAt: p.closesAt, closed: !!p.closedAt || p.closesAt.getTime() < Date.now(),
      options: opts.filter(o => o.pollId === p.id).map(o => ({ label: o.label, votes: o.votes })),
    }));
  });

  app.post('/:aid/events', async (req, reply) => {
    const { aid, s } = await staff(req, ['admin', 'committee', 'operator']);
    const b = parse(z.object({
      title: z.string().trim().min(3).max(80), description: z.string().trim().max(600).default(''), location: z.string().trim().min(2).max(80),
      startsAt: z.iso.datetime({ offset: true }), minutes: z.number().int().min(15).max(1440), capacity: z.number().int().min(1).max(100000), icon: z.string().max(40).optional(),
    }), req.body);
    const [e] = await db.insert(events).values({ ...b, startsAt: new Date(b.startsAt), associationId: aid }).returning();
    await notify(db, await residentsOf(db, aid), { kind: 'events', title: 'New event: ' + b.title, body: b.location, href: '/events' });
    await audit(db, aid, s.userId, s.name, `event published · ${b.title}`);
    return reply.status(201).send(e);
  });

  app.post('/:aid/polls', async (req, reply) => {
    const { aid, s } = await staff(req, ['admin', 'committee', 'operator']);
    const b = parse(z.object({
      question: z.string().trim().min(5).max(200), options: z.array(z.string().trim().min(1).max(80)).min(2).max(6),
      eligibility: z.enum(['all', 'owners']).default('all'), closesAt: z.iso.datetime({ offset: true }),
    }), req.body);
    if (new Date(b.closesAt).getTime() <= Date.now()) throw conflict('closes_in_past', 'The closing time must be in the future.');
    const poll = await db.transaction(async tx => {
      const [p] = await tx.insert(polls).values({ associationId: aid, question: b.question, eligibility: b.eligibility, closesAt: new Date(b.closesAt) }).returning();
      await tx.insert(pollOptions).values(b.options.map((label, position) => ({ pollId: p!.id, label, position })));
      return p!;
    });
    await notify(db, await residentsOf(db, aid), { kind: 'polls', title: 'New poll: ' + b.question, body: 'Voting is open', href: '/polls' });
    await audit(db, aid, s.userId, s.name, `poll opened · ${b.question}`);
    return reply.status(201).send(poll);
  });

  app.post('/:aid/polls/:id/close', async req => {
    const { aid, s } = await staff(req, ['admin', 'committee', 'operator']);
    const { id } = parse(AidId, req.params);
    const done = await db.update(polls).set({ closedAt: new Date() }).where(and(eq(polls.id, id), eq(polls.associationId, aid), sql`${polls.closedAt} is null`)).returning();
    if (!done.length) throw notFound('Open poll');
    await audit(db, aid, s.userId, s.name, `poll closed · ${done[0]!.question}`);
    return { closed: true };
  });

  /** votes on a poll: the ones cast in the app plus any counted before it */
  const votesOn = async (pollId: string) => {
    const [cast] = (await db.select({ n: sql<number>`count(*)::int` }).from(votes).where(eq(votes.pollId, pollId))) as [{ n: number }];
    const [base] = (await db.select({ n: sql<number>`coalesce(sum(${pollOptions.baseVotes}), 0)::int` }).from(pollOptions).where(eq(pollOptions.pollId, pollId))) as [{ n: number }];
    return cast.n + base.n;
  };

  /**
   * Correct a poll. Before anyone has voted, everything can change. Once votes are in, the question
   * and options are fixed (changing them would change what people voted for) and only the closing
   * time can move. A closed poll is final.
   */
  app.put('/:aid/polls/:id', async req => {
    const { aid, s } = await staff(req, ['admin', 'committee', 'operator']);
    const { id } = parse(AidId, req.params);
    const b = parse(z.object({
      question: z.string().trim().min(5).max(200), options: z.array(z.string().trim().min(1).max(80)).min(2).max(6),
      eligibility: z.enum(['all', 'owners']), closesAt: z.iso.datetime({ offset: true }),
    }).partial(), req.body);
    const [p] = await db.select().from(polls).where(and(eq(polls.id, id), eq(polls.associationId, aid)));
    if (!p) throw notFound('Poll');
    if (p.closedAt || p.closesAt.getTime() < Date.now()) throw conflict('poll_closed', 'This poll is closed and its result is final. Open a new poll instead.');
    if (b.closesAt && new Date(b.closesAt).getTime() <= Date.now()) throw conflict('closes_in_past', 'The closing time must be in the future.');
    if (b.options && new Set(b.options.map(o => o.toLowerCase())).size !== b.options.length) throw conflict('same_options', 'Two options are the same.');
    const was = await db.select().from(pollOptions).where(eq(pollOptions.pollId, id)).orderBy(pollOptions.position);
    const wording = (b.question !== undefined && b.question !== p.question) || (b.eligibility !== undefined && b.eligibility !== p.eligibility)
      || (b.options !== undefined && (b.options.length !== was.length || b.options.some((o, i) => o !== was[i]!.label)));
    const cast = await votesOn(id);
    if (wording && cast > 0) throw conflict('has_votes', `${cast} vote${cast === 1 ? ' has' : 's have'} been cast, so the question, options and who can vote are fixed. You can still change the closing time, or delete this poll and open a new one.`);
    await db.transaction(async tx => {
      await tx.update(polls).set({ ...(b.question ? { question: b.question } : {}), ...(b.eligibility ? { eligibility: b.eligibility } : {}), ...(b.closesAt ? { closesAt: new Date(b.closesAt) } : {}) }).where(eq(polls.id, id));
      if (wording && b.options) {
        await tx.delete(pollOptions).where(eq(pollOptions.pollId, id));
        await tx.insert(pollOptions).values(b.options.map((label, position) => ({ pollId: id, label, position })));
      }
      await audit(tx, aid, s.userId, s.name, `poll edited · ${b.question ?? p.question}`);
    });
    return { ok: true };
  });

  /** Remove a poll and every vote on it. */
  app.delete('/:aid/polls/:id', async (req, reply) => {
    const { aid, s } = await staff(req, ['admin', 'committee', 'operator']);
    const { id } = parse(AidId, req.params);
    const [p] = await db.select().from(polls).where(and(eq(polls.id, id), eq(polls.associationId, aid)));
    if (!p) throw notFound('Poll');
    const cast = await votesOn(id);
    await db.delete(polls).where(eq(polls.id, id));
    await audit(db, aid, s.userId, s.name, `poll deleted · ${p.question} · ${cast} vote${cast === 1 ? '' : 's'} discarded`);
    return reply.status(204).send();
  });

  /** who has said they are coming (or is waiting for a seat) — the people to tell when an event changes */
  const attendees = async (eventId: string) => (await db.select({ userId: rsvps.userId, status: rsvps.status }).from(rsvps).where(eq(rsvps.eventId, eventId)));

  /** Correct an event. People who have RSVP'd are told when the time or place moves. */
  app.put('/:aid/events/:id', async req => {
    const { aid, s } = await staff(req, ['admin', 'committee', 'operator']);
    const { id } = parse(AidId, req.params);
    const b = parse(z.object({
      title: z.string().trim().min(3).max(80), description: z.string().trim().max(600), location: z.string().trim().min(2).max(80),
      startsAt: z.iso.datetime({ offset: true }), minutes: z.number().int().min(15).max(1440), capacity: z.number().int().min(1).max(100000),
    }).partial(), req.body);
    const [e] = await db.select().from(events).where(and(eq(events.id, id), eq(events.associationId, aid)));
    if (!e) throw notFound('Event');
    const moved = (b.startsAt !== undefined && new Date(b.startsAt).getTime() !== e.startsAt.getTime()) || (b.location !== undefined && b.location !== e.location);
    if (b.startsAt && moved && new Date(b.startsAt).getTime() <= Date.now()) throw conflict('starts_in_past', 'The start time must be in the future.');
    const people = await attendees(id), going = e.baseGoing + people.filter(p => p.status === 'Going').length;
    if (b.capacity !== undefined && b.capacity < going) throw conflict('below_going', `${going} ${going === 1 ? 'person is' : 'people are'} already going, so the capacity can’t be lower than that.`);
    const { startsAt, ...rest } = b;
    const [now] = await db.update(events).set({ ...rest, ...(startsAt ? { startsAt: new Date(startsAt) } : {}) }).where(eq(events.id, id)).returning();
    if (moved) await notify(db, people.map(p => p.userId), { kind: 'events', title: 'Event changed: ' + now!.title, body: `Now ${now!.startsAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} at ${now!.location}`, href: '/events' });
    await audit(db, aid, s.userId, s.name, `event edited · ${now!.title}`);
    return now;
  });

  /** Cancel an event: it disappears from the app and everyone who RSVP'd is told. */
  app.delete('/:aid/events/:id', async (req, reply) => {
    const { aid, s } = await staff(req, ['admin', 'committee', 'operator']);
    const { id } = parse(AidId, req.params);
    const [e] = await db.select().from(events).where(and(eq(events.id, id), eq(events.associationId, aid)));
    if (!e) throw notFound('Event');
    const people = await attendees(id);
    await db.delete(events).where(eq(events.id, id));
    if (e.startsAt.getTime() > Date.now()) await notify(db, people.map(p => p.userId), { kind: 'events', title: 'Event cancelled: ' + e.title, body: 'The society office has cancelled this event.', href: '/events' });
    await audit(db, aid, s.userId, s.name, `event deleted · ${e.title} · ${people.length} RSVP${people.length === 1 ? '' : 's'}`);
    return reply.status(204).send();
  });

  /* ---------- residents' event ideas ---------- */
  app.get('/:aid/event-suggestions', async req => {
    const { aid } = await staff(req);
    return db.select({ id: eventSuggestions.id, title: eventSuggestions.title, when: eventSuggestions.whenText, where: eventSuggestions.location, note: eventSuggestions.note, status: eventSuggestions.status, by: users.name, createdAt: eventSuggestions.createdAt })
      .from(eventSuggestions).leftJoin(users, eq(users.id, eventSuggestions.userId)).where(eq(eventSuggestions.associationId, aid)).orderBy(desc(eventSuggestions.createdAt));
  });

  app.post('/:aid/event-suggestions/:id/decision', async req => {
    const { aid, s } = await staff(req, ['admin', 'committee', 'operator']);
    const { id } = parse(AidId, req.params);
    const { decision } = parse(z.object({ decision: z.enum(['approved', 'declined']) }), req.body);
    const [sg] = await db.update(eventSuggestions).set({ status: decision }).where(and(eq(eventSuggestions.id, id), eq(eventSuggestions.associationId, aid), eq(eventSuggestions.status, 'pending'))).returning();
    if (!sg) throw notFound('Pending suggestion');
    if (sg.userId) await notify(db, [sg.userId], { kind: 'events', title: `Your event idea was ${decision}`, body: sg.title, href: '/events' });
    await audit(db, aid, s.userId, s.name, `event suggestion ${decision} · ${sg.title}`);
    return { status: decision };
  });

  /** counts for the dashboard that no list carries: gratitude notes delivered (the notes themselves stay private to their recipients) */
  app.get('/:aid/stats', async req => {
    const { aid } = await staff(req);
    const [g] = await db.select({ n: sql<number>`count(*)::int` }).from(gratitudes).where(and(eq(gratitudes.associationId, aid), eq(gratitudes.state, 'sent')));
    return { gratitudes: g?.n ?? 0 };
  });

  /* ---------- people ---------- */
  app.get('/:aid/users', async req => {
    const { aid } = await staff(req);
    return db.select({
      userId: users.id, name: users.name, unit: units.code, role: unitMembers.role, memberStatus: unitMembers.status, memberId: unitMembers.id,
      status: sql<string>`coalesce(${standings.status}, 'Active')`, warnings: sql<number>`coalesce(${standings.warnings}, 0)`,
    }).from(unitMembers).innerJoin(units, eq(units.id, unitMembers.unitId)).innerJoin(users, eq(users.id, unitMembers.userId))
      .leftJoin(standings, and(eq(standings.userId, users.id), eq(standings.associationId, aid)))
      .where(eq(units.associationId, aid)).orderBy(units.code, users.name);
  });

  app.put('/:aid/users/:id/standing', async req => {
    const { aid, s } = await staff(req, ['admin', 'operator']);
    const { id } = parse(AidId, req.params);
    const { status } = parse(z.object({ status: z.enum(['Active', 'Warned', 'Restricted', 'Suspended', 'Blocked']) }), req.body);
    if (status === 'Blocked' && id === s.userId) throw conflict('own_account', 'You can’t block your own account.');
    const [m] = await db.select({ name: users.name }).from(unitMembers).innerJoin(units, eq(units.id, unitMembers.unitId)).innerJoin(users, eq(users.id, unitMembers.userId))
      .where(and(eq(unitMembers.userId, id), eq(units.associationId, aid)));
    if (!m) throw notFound('Resident');
    await db.insert(standings).values({ userId: id, associationId: aid, status }).onConflictDoUpdate({ target: [standings.userId, standings.associationId], set: { status } });
    forgetBlocked(db, id); // a block, or an unblock, counts from this request on
    // blocked means out of the app now, not when their session next runs out
    if (status === 'Blocked') await db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.userId, id), isNull(refreshTokens.revokedAt)));
    await audit(db, aid, s.userId, s.name, status === 'Blocked' ? `blocked ${m.name} from the app` : `standing of ${m.name} set to ${status}`);
    return { status };
  });

  /**
   * Delete a resident for good: their account, sign-in, posts and private data are erased, and they leave every flat.
   * The issues they raised stay as anonymous records. There is no undo, so this is the society admin's alone, and it
   * refuses anyone who is also on the console team (their console sign-in would go with it) or lives in another society too.
   */
  app.delete('/:aid/users/:id', async (req, reply) => {
    const { aid, s } = await staff(req, ['admin']);
    const { id } = parse(AidId, req.params);
    if (id === s.userId) throw conflict('own_account', 'You can’t delete your own account.');
    const homes = await db.select({ name: users.name, unit: units.code, associationId: units.associationId }).from(unitMembers)
      .innerJoin(units, eq(units.id, unitMembers.unitId)).innerJoin(users, eq(users.id, unitMembers.userId)).where(eq(unitMembers.userId, id));
    const here = homes.filter(h => h.associationId === aid);
    if (!here.length) throw notFound('Resident');
    if (homes.length > here.length) throw conflict('lives_elsewhere', 'This person is also registered in another society, so their account can’t be deleted from here. Remove them from the flat instead.');
    const [onTeam] = await db.select({ id: staffRoles.id }).from(staffRoles).where(eq(staffRoles.userId, id)).limit(1);
    if (onTeam) throw conflict('on_team', 'This person also signs in to a console or the gate. Remove them under Team & access (or Gate → Guards) first.');
    await db.transaction(async tx => {
      await eraseAccount(tx, id);
      await audit(tx, aid, s.userId, s.name, `resident deleted permanently · ${here[0]!.name} (${here.map(h => h.unit).join(', ')})`);
    });
    return reply.status(204).send();
  });

  /** verify a household member an owner added — they can sign in from then on */
  app.post('/:aid/members/:id/verify', async req => {
    const { aid, s } = await staff(req, ['admin', 'operator']);
    const { id } = parse(AidId, req.params);
    const [m] = await db.select({ id: unitMembers.id, userId: unitMembers.userId, unit: units.code, name: users.name }).from(unitMembers)
      .innerJoin(units, eq(units.id, unitMembers.unitId)).innerJoin(users, eq(users.id, unitMembers.userId))
      .where(and(eq(unitMembers.id, id), eq(units.associationId, aid), eq(unitMembers.status, 'pending')));
    if (!m) throw notFound('Pending member');
    await db.update(unitMembers).set({ status: 'active' }).where(eq(unitMembers.id, id));
    await audit(db, aid, s.userId, s.name, `member verified · ${m.name} → ${m.unit}`);
    return { status: 'active' };
  });
};
