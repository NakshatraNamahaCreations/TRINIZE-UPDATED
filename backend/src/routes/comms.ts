import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../app.js';
import {
  associations, CHANNELS, CONVERSATION_TOPICS, conversationMessages, conversations, MESSAGE_TYPES, messageDeliveries, messages, messageTemplates,
  staffRoles, unitMembers, units, users, type Audience,
} from '../db/schema.js';
import { ruleRewrite } from '../lib/assistant.js';
import { audit } from '../lib/audit.js';
import { residentOf, staffOf, userIdFrom } from '../lib/auth.js';
import { audienceLabel, deliver, resolveAudience } from '../lib/comms.js';
import { notify } from '../lib/community.js';
import { badRequest, conflict, notFound, parse } from '../lib/http.js';

const Id = z.object({ id: z.uuid() });
const When = z.iso.datetime({ offset: true });
const AudienceIn = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }),
  z.object({ kind: z.literal('towers'), towers: z.array(z.string().min(1).max(60)).min(1).max(60) }),
  z.object({ kind: z.literal('units'), unitIds: z.array(z.uuid()).min(1).max(2000) }),
  z.object({ kind: z.literal('role'), role: z.enum(['Owner', 'Tenant', 'Family']) }),
  z.object({ kind: z.literal('residents'), userIds: z.array(z.uuid()).min(1).max(2000) }),
]);
const MessageIn = z.object({
  type: z.enum(MESSAGE_TYPES).default('Announcement'), title: z.string().trim().min(3).max(120), body: z.string().trim().min(3).max(4000),
  priority: z.enum(['Normal', 'Important', 'Emergency']).default('Normal'), channels: z.array(z.enum(CHANNELS)).min(1, 'Choose at least one channel'),
  audience: AudienceIn.default({ kind: 'all' }), attachmentUrl: z.url().nullish(), attachmentName: z.string().trim().max(120).nullish(),
  promotional: z.boolean().default(false), requiresAck: z.boolean().default(false),
  startsAt: When.nullish(), expiresAt: When.nullish(), pinned: z.boolean().default(false),
  /** send = now · schedule = at scheduledAt · draft = keep for later */
  action: z.enum(['send', 'schedule', 'draft']).default('send'), scheduledAt: When.nullish(),
});

/**
 * Communication hub.
 *   /v1/admin/:aid/comms/*          the office: compose, schedule, templates, history, delivery records, report
 *   /v1/admin/:aid/conversations/*  the office's side of direct messages
 *   /v1/conversations/*             the resident's side
 */
export const commsRoutes = ({ config, db, messenger, ai }: Deps): FastifyPluginAsync => async app => {
  const uid = (req: FastifyRequest) => userIdFrom(req, config.JWT_SECRET);
  const office = async (req: FastifyRequest, roles: ('admin' | 'committee' | 'moderator')[] = ['admin']) => {
    const { aid } = parse(z.object({ aid: z.uuid() }), req.params);
    return { aid, staff: await staffOf(db, await uid(req), aid, roles) };
  };
  const signature = (s: { name: string; title: string | null; role: string }) => (s.title && s.role !== 'vpm' ? `${s.name} (${s.title})` : s.name);

  /** message + how its deliveries went */
  const withStats = async (where: ReturnType<typeof and>, limit = 300) => {
    const rows = await db.select().from(messages).where(where).orderBy(desc(messages.createdAt)).limit(limit);
    if (!rows.length) return [];
    const stats = await db.select({
      messageId: messageDeliveries.messageId,
      recipients: sql<number>`count(distinct ${messageDeliveries.userId})::int`,
      reached: sql<number>`count(*) filter (where ${messageDeliveries.status} in ('Delivered','Sent'))::int`,
      logged: sql<number>`count(*) filter (where ${messageDeliveries.status} = 'Logged')::int`,
      skipped: sql<number>`count(*) filter (where ${messageDeliveries.status} = 'Skipped')::int`,
      failed: sql<number>`count(*) filter (where ${messageDeliveries.status} = 'Failed')::int`,
      onBoard: sql<number>`count(*) filter (where ${messageDeliveries.channel} = 'portal' and ${messageDeliveries.status} = 'Delivered')::int`,
      read: sql<number>`count(*) filter (where ${messageDeliveries.readAt} is not null)::int`,
    }).from(messageDeliveries).where(inArray(messageDeliveries.messageId, rows.map(r => r.id))).groupBy(messageDeliveries.messageId);
    return rows.map(({ number, associationId: _a, createdBy: _c, ...m }) => {
      const s = stats.find(x => x.messageId === m.id);
      const expired = m.status === 'Sent' && !!m.expiresAt && m.expiresAt.getTime() < Date.now();
      return { ...m, ref: 'MSG-' + number, expired, stats: { recipients: s?.recipients ?? 0, reached: s?.reached ?? 0, logged: s?.logged ?? 0, skipped: s?.skipped ?? 0, failed: s?.failed ?? 0, onBoard: s?.onBoard ?? 0, read: s?.read ?? 0 } };
    });
  };
  const oneMessage = async (aid: string, id: string) => {
    const [m] = await withStats(and(eq(messages.id, id), eq(messages.associationId, aid)), 1);
    if (!m) throw notFound('That message');
    return m;
  };

  /* ---------------- compose ---------------- */
  /** what the audience picker needs: the blocks, and every resident with how they can be reached */
  app.get('/admin/:aid/comms/audience', async req => {
    const { aid } = await office(req, ['admin', 'committee']);
    const people = await resolveAudience(db, aid, { kind: 'all' });
    const flats = await db.select({ id: units.id, code: units.code, tower: units.tower }).from(units).where(eq(units.associationId, aid)).orderBy(units.code);
    const count = (f: (p: (typeof people)[number]) => boolean) => people.filter(f).length;
    return {
      total: people.length,
      towers: [...new Set(flats.map(f => f.tower))].sort().map(t => ({ name: t, residents: count(p => p.tower === t) })),
      roles: (['Owner', 'Tenant', 'Family'] as const).map(r => ({ role: r, residents: count(p => p.role === r) })),
      units: flats.map(f => ({ ...f, residents: count(p => p.unit === f.code) })),
      residents: people.map(p => ({ id: p.userId, name: p.name, unit: p.unit, role: p.role, hasEmail: !!p.email, hasPhone: !!p.phone })),
      reach: { email: count(p => !!p.email), phone: count(p => !!p.phone) },
    };
  });

  /** tidy up a rough draft. With an AI key it is rewritten by the model; without one, by the built-in rules. */
  app.post('/admin/:aid/comms/polish', async req => {
    await office(req);
    const { text, tone } = parse(z.object({ text: z.string().trim().min(5).max(4000), tone: z.enum(['Clear', 'Friendly', 'Formal', 'Urgent']).default('Clear') }), req.body);
    const how = tone === 'Formal' ? 'formal and precise, as an official society notice' : tone === 'Friendly' ? 'warm and neighbourly' : tone === 'Urgent' ? 'urgent and direct — what happened, what to do now' : 'clear and short, plain words';
    const byAi = ai.enabled ? await ai.rewrite(text, how).catch(() => null) : null;
    return { text: byAi ?? ruleRewrite(text, tone === 'Formal' ? 'formal' : 'friendly'), by: byAi ? 'ai' : 'rules' };
  });

  /** how many people an audience reaches, before anything is sent */
  app.post('/admin/:aid/comms/audience/count', async req => {
    const { aid } = await office(req, ['admin', 'committee']);
    const { audience } = parse(z.object({ audience: AudienceIn }), req.body);
    const people = await resolveAudience(db, aid, audience);
    return { residents: people.length, withEmail: people.filter(p => p.email).length, withPhone: people.filter(p => p.phone).length, label: await audienceLabel(db, aid, audience) };
  });

  /* ---------------- messages ---------------- */
  const checkTiming = (b: z.infer<typeof MessageIn>) => {
    if (b.action === 'schedule') {
      if (!b.scheduledAt) throw badRequest('when', 'Choose when to send it.');
      if (new Date(b.scheduledAt).getTime() < Date.now() - 60_000) throw badRequest('in_the_past', 'Choose a time that hasn’t passed.');
    }
    if (b.expiresAt && new Date(b.expiresAt).getTime() <= Math.max(Date.now(), b.startsAt ? new Date(b.startsAt).getTime() : 0)) throw badRequest('bad_expiry', 'The notice must expire after it starts showing.');
    if (b.attachmentUrl && !b.attachmentUrl.startsWith(config.PUBLIC_URL + '/files/')) throw badRequest('bad_attachment', 'Upload the attachment first.');
  };
  const fields = async (aid: string, b: z.infer<typeof MessageIn>) => ({
    type: b.type, title: b.title, body: b.body, priority: b.type === 'Emergency' ? 'Emergency' as const : b.priority, channels: [...new Set(b.channels)], audience: b.audience as Audience,
    audienceLabel: await audienceLabel(db, aid, b.audience as Audience), attachmentUrl: b.attachmentUrl ?? null, attachmentName: b.attachmentName ?? null,
    promotional: b.promotional || b.type === 'Offer', requiresAck: b.requiresAck, startsAt: b.startsAt ? new Date(b.startsAt) : null, expiresAt: b.expiresAt ? new Date(b.expiresAt) : null, pinned: b.pinned,
    status: b.action === 'schedule' ? 'Scheduled' as const : 'Draft' as const, scheduledAt: b.action === 'schedule' ? new Date(b.scheduledAt!) : null,
  });

  app.post('/admin/:aid/comms/messages', async (req, reply) => {
    const { aid, staff } = await office(req);
    const b = parse(MessageIn, req.body);
    checkTiming(b);
    const [{ next }] = (await db.select({ next: sql<number>`coalesce(max(${messages.number}), 100) + 1` }).from(messages).where(eq(messages.associationId, aid))) as [{ next: number }];
    const [m] = await db.insert(messages).values({ ...(await fields(aid, b)), associationId: aid, number: next, createdBy: staff.userId, byName: signature(staff) }).returning();
    if (b.action === 'send') {
      try { await deliver(db, messenger, m!.id); }
      catch (e) { await db.delete(messages).where(eq(messages.id, m!.id)); throw e; } // nobody in the audience: nothing is kept
    }
    await audit(db, aid, staff.userId, staff.name, `${b.action === 'send' ? 'sent' : b.action === 'schedule' ? 'scheduled' : 'drafted'} MSG-${next} · ${b.type} · ${m!.audienceLabel} · ${m!.channels.join(', ')}`);
    return reply.status(201).send(await oneMessage(aid, m!.id));
  });

  /** the dashboard: sent, scheduled, drafts — filter by status, channel, type, dates or words */
  app.get('/admin/:aid/comms/messages', async req => {
    const { aid } = await office(req, ['admin', 'committee']);
    const f = parse(z.object({
      status: z.enum(['Draft', 'Scheduled', 'Sent', 'Cancelled', 'Expired', 'Failed']).optional(), channel: z.enum(CHANNELS).optional(), type: z.enum(MESSAGE_TYPES).optional(),
      from: z.iso.date().optional(), to: z.iso.date().optional(), q: z.string().trim().max(60).optional(),
    }), req.query);
    const like = f.q ? '%' + f.q.replace(/[%_]/g, '') + '%' : null;
    const rows = await withStats(and(
      eq(messages.associationId, aid),
      f.status && f.status !== 'Expired' && f.status !== 'Failed' ? eq(messages.status, f.status) : undefined,
      f.status === 'Expired' ? and(eq(messages.status, 'Sent'), lte(messages.expiresAt, new Date())) : undefined,
      f.channel ? sql`${messages.channels} @> ${JSON.stringify([f.channel])}::jsonb` : undefined,
      f.type ? eq(messages.type, f.type) : undefined,
      f.from ? gte(messages.createdAt, new Date(f.from + 'T00:00:00+05:30')) : undefined,
      f.to ? lte(messages.createdAt, new Date(f.to + 'T23:59:59+05:30')) : undefined,
      like ? or(ilike(messages.title, like), ilike(messages.body, like), ilike(messages.audienceLabel, like)) : undefined,
    ));
    return f.status === 'Failed' ? rows.filter(r => r.stats.failed > 0) : rows;
  });

  /** one message with every delivery: who, which channel, what happened, when they read it */
  app.get('/admin/:aid/comms/messages/:id', async req => {
    const { aid } = await office(req, ['admin', 'committee']);
    const { id } = parse(Id, req.params);
    const m = await oneMessage(aid, id);
    const deliveries = await db.select({ userId: users.id, name: users.name, unit: sql<string | null>`(select un.code from unit_members um join units un on un.id = um.unit_id where um.user_id = ${users.id} and un.association_id = ${aid} limit 1)`,
      channel: messageDeliveries.channel, status: messageDeliveries.status, detail: messageDeliveries.detail, sentAt: messageDeliveries.sentAt, readAt: messageDeliveries.readAt })
      .from(messageDeliveries).innerJoin(users, eq(users.id, messageDeliveries.userId)).where(eq(messageDeliveries.messageId, id)).orderBy(users.name, messageDeliveries.channel);
    return { ...m, deliveries };
  });

  /** change a draft or a scheduled message — never one that has gone out */
  app.put('/admin/:aid/comms/messages/:id', async req => {
    const { aid } = await office(req);
    const { id } = parse(Id, req.params);
    const b = parse(MessageIn, req.body);
    checkTiming(b);
    const cur = await oneMessage(aid, id);
    if (cur.status === 'Sent' || cur.status === 'Cancelled') throw conflict('locked', 'A message that has been sent can’t be changed. Send a correction instead.');
    await db.update(messages).set(await fields(aid, b)).where(eq(messages.id, id));
    if (b.action === 'send') await deliver(db, messenger, id);
    return oneMessage(aid, id);
  });

  app.post('/admin/:aid/comms/messages/:id/send', async req => {
    const { aid, staff } = await office(req);
    const { id } = parse(Id, req.params);
    const cur = await oneMessage(aid, id);
    await deliver(db, messenger, id);
    await audit(db, aid, staff.userId, staff.name, `sent ${cur.ref} · ${cur.audienceLabel}`);
    return oneMessage(aid, id);
  });

  /** cancel a scheduled message or discard a draft */
  app.post('/admin/:aid/comms/messages/:id/cancel', async req => {
    const { aid, staff } = await office(req);
    const { id } = parse(Id, req.params);
    const cur = await oneMessage(aid, id);
    if (cur.status === 'Sent') throw conflict('already_sent', 'This message has already gone out.');
    await db.update(messages).set({ status: 'Cancelled' }).where(eq(messages.id, id));
    await audit(db, aid, staff.userId, staff.name, `cancelled ${cur.ref}`);
    return oneMessage(aid, id);
  });

  /** take a notice off the board early (it stays in the record) or change its pin */
  app.post('/admin/:aid/comms/messages/:id/board', async req => {
    const { aid } = await office(req);
    const { id } = parse(Id, req.params);
    const b = parse(z.object({ pinned: z.boolean().optional(), expireNow: z.boolean().optional() }), req.body);
    const cur = await oneMessage(aid, id);
    if (cur.status !== 'Sent' || !cur.announcementId) throw conflict('not_on_board', 'This message isn’t on the notice board.');
    const set = { ...(b.pinned !== undefined ? { pinned: b.pinned } : {}), ...(b.expireNow ? { expiresAt: new Date() } : {}) };
    if (Object.keys(set).length) {
      await db.update(messages).set(set).where(eq(messages.id, id));
      await db.execute(sql`update announcements set pinned = coalesce(${b.pinned ?? null}, pinned), expires_at = case when ${!!b.expireNow} then now() else expires_at end where id = ${cur.announcementId}`);
    }
    return oneMessage(aid, id);
  });

  /* ---------------- records and reports ---------------- */
  /** everything one resident has been sent, and what they have written to the office */
  app.get('/admin/:aid/comms/history/:id', async req => {
    const { aid } = await office(req, ['admin', 'committee']);
    const { id } = parse(Id, req.params);
    const sent = await db.select({ ref: sql<string>`'MSG-' || ${messages.number}`, title: messages.title, type: messages.type, channel: messageDeliveries.channel, status: messageDeliveries.status,
      detail: messageDeliveries.detail, sentAt: messageDeliveries.sentAt, readAt: messageDeliveries.readAt })
      .from(messageDeliveries).innerJoin(messages, eq(messages.id, messageDeliveries.messageId))
      .where(and(eq(messageDeliveries.userId, id), eq(messages.associationId, aid))).orderBy(desc(messageDeliveries.sentAt)).limit(300);
    const threads = await db.select({ id: conversations.id, subject: conversations.subject, topic: conversations.topic, status: conversations.status, lastMessageAt: conversations.lastMessageAt })
      .from(conversations).where(and(eq(conversations.userId, id), eq(conversations.associationId, aid))).orderBy(desc(conversations.lastMessageAt));
    return { sent, conversations: threads };
  });

  app.get('/admin/:aid/comms/report', async req => {
    const { aid } = await office(req, ['admin', 'committee']);
    const { days } = parse(z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }), req.query);
    const since = new Date(Date.now() - days * 864e5).toISOString();
    const rows = async <T>(q: ReturnType<typeof sql>) => ((await db.execute(q)) as unknown as { rows: T[] }).rows;
    const byChannel = await rows<{ channel: string; total: number; reached: number; logged: number; skipped: number; failed: number; read: number }>(sql`
      select d.channel, count(*)::int as total,
        count(*) filter (where d.status in ('Delivered','Sent'))::int as reached, count(*) filter (where d.status = 'Logged')::int as logged,
        count(*) filter (where d.status = 'Skipped')::int as skipped, count(*) filter (where d.status = 'Failed')::int as failed,
        count(*) filter (where d.read_at is not null)::int as read
      from message_deliveries d join messages m on m.id = d.message_id
      where m.association_id = ${aid} and d.sent_at >= ${since}::timestamptz group by d.channel order by total desc`);
    const byType = await rows<{ type: string; messages: number; on_board: number; read: number }>(sql`
      select m.type, count(distinct m.id)::int as messages,
        count(d.id) filter (where d.channel = 'portal' and d.status = 'Delivered')::int as on_board, count(d.id) filter (where d.read_at is not null)::int as read
      from messages m left join message_deliveries d on d.message_id = m.id
      where m.association_id = ${aid} and m.status = 'Sent' and m.sent_at >= ${since}::timestamptz group by m.type order by messages desc`);
    const byTower = await rows<{ tower: string; notices: number }>(sql`
      select un.tower, count(distinct d.message_id)::int as notices
      from message_deliveries d join messages m on m.id = d.message_id join unit_members um on um.user_id = d.user_id join units un on un.id = um.unit_id and un.association_id = m.association_id
      where m.association_id = ${aid} and d.channel = 'portal' and d.sent_at >= ${since}::timestamptz group by un.tower order by un.tower`);
    const problems = await rows<{ ref: string; title: string; name: string; channel: string; status: string; detail: string; sent_at: Date }>(sql`
      select 'MSG-' || m.number as ref, m.title, u.name, d.channel, d.status, d.detail, d.sent_at
      from message_deliveries d join messages m on m.id = d.message_id join users u on u.id = d.user_id
      where m.association_id = ${aid} and d.status in ('Failed','Skipped') and d.sent_at >= ${since}::timestamptz order by d.sent_at desc limit 100`);
    const [totals] = await rows<{ sent: number; scheduled: number; drafts: number }>(sql`
      select count(*) filter (where status = 'Sent' and sent_at >= ${since}::timestamptz)::int as sent, count(*) filter (where status = 'Scheduled')::int as scheduled,
        count(*) filter (where status = 'Draft')::int as drafts from messages where association_id = ${aid}`);
    const board = byChannel.find(c => c.channel === 'portal');
    return { days, totals, readRate: board?.reached ? Math.round((board.read / board.reached) * 100) : null, byChannel, byType, byTower, problems };
  });

  /* ---------------- direct messages ---------------- */
  type Conv = typeof conversations.$inferSelect;
  const convOut = async (list: Conv[], forStaff: boolean) => {
    if (!list.length) return [];
    const ids = list.map(c => c.id);
    const last = await db.select({ conversationId: conversationMessages.conversationId, text: conversationMessages.text, fromRole: conversationMessages.fromRole, createdAt: conversationMessages.createdAt })
      .from(conversationMessages).where(inArray(conversationMessages.conversationId, ids)).orderBy(desc(conversationMessages.createdAt));
    const unread = await db.select({ conversationId: conversationMessages.conversationId, n: sql<number>`count(*)::int` }).from(conversationMessages)
      .where(and(inArray(conversationMessages.conversationId, ids), eq(conversationMessages.fromRole, forStaff ? 'resident' : 'staff'), isNull(conversationMessages.readAt))).groupBy(conversationMessages.conversationId);
    const who = forStaff ? await db.select({ id: users.id, name: users.name, unit: units.code }).from(users)
      .leftJoin(unitMembers, eq(unitMembers.userId, users.id)).leftJoin(units, eq(units.id, unitMembers.unitId)).where(inArray(users.id, list.map(c => c.userId))) : [];
    return list.map(c => {
      const l = last.find(x => x.conversationId === c.id), p = who.find(x => x.id === c.userId);
      return { id: c.id, subject: c.subject, topic: c.topic, status: c.status, lastMessageAt: c.lastMessageAt, createdAt: c.createdAt,
        preview: l ? l.text.slice(0, 120) : '', lastFrom: l?.fromRole ?? null, unread: unread.find(x => x.conversationId === c.id)?.n ?? 0,
        ...(forStaff ? { resident: p?.name ?? 'Resident', unit: p?.unit ?? null, userId: c.userId } : {}) };
    });
  };
  const thread = async (c: Conv, reader: 'resident' | 'staff') => {
    // opening it marks the other side's messages as read
    await db.update(conversationMessages).set({ readAt: new Date() })
      .where(and(eq(conversationMessages.conversationId, c.id), eq(conversationMessages.fromRole, reader === 'staff' ? 'resident' : 'staff'), isNull(conversationMessages.readAt)));
    const msgs = await db.select({ id: conversationMessages.id, from: conversationMessages.fromRole, by: conversationMessages.fromName, text: conversationMessages.text, attachmentUrl: conversationMessages.attachmentUrl,
      at: conversationMessages.createdAt, readAt: conversationMessages.readAt }).from(conversationMessages).where(eq(conversationMessages.conversationId, c.id)).orderBy(asc(conversationMessages.createdAt));
    const [head] = await convOut([c], reader === 'staff');
    return { ...head!, unread: 0, messages: msgs };
  };
  const Text = z.object({ text: z.string().trim().min(1).max(4000), attachmentUrl: z.url().optional() });
  const staffIds = async (aid: string) =>
    (await db.select({ userId: staffRoles.userId }).from(staffRoles).where(and(eq(staffRoles.associationId, aid), inArray(staffRoles.role, ['admin', 'vpm'])))).map(s => s.userId);

  /* the resident */
  app.get('/conversations', async req => {
    const me = await residentOf(db, await uid(req));
    return convOut(await db.select().from(conversations).where(and(eq(conversations.userId, me.userId), eq(conversations.associationId, me.associationId))).orderBy(desc(conversations.lastMessageAt)), false);
  });
  app.post('/conversations', async (req, reply) => {
    const me = await residentOf(db, await uid(req));
    const b = parse(Text.extend({ subject: z.string().trim().min(3).max(120), topic: z.enum(CONVERSATION_TOPICS).default('General') }), req.body);
    const [c] = await db.insert(conversations).values({ associationId: me.associationId, userId: me.userId, subject: b.subject, topic: b.topic }).returning();
    await db.insert(conversationMessages).values({ conversationId: c!.id, fromUserId: me.userId, fromRole: 'resident', fromName: me.name, text: b.text, attachmentUrl: b.attachmentUrl ?? null });
    await notify(db, await staffIds(me.associationId), { kind: 'messages', title: `${me.name} (${me.unitCode}): ${b.subject}`, body: b.text.slice(0, 140), href: '/messages/' + c!.id });
    return reply.status(201).send(await thread(c!, 'resident'));
  });
  const mine = async (req: FastifyRequest) => {
    const me = await residentOf(db, await uid(req));
    const { id } = parse(Id, req.params);
    const [c] = await db.select().from(conversations).where(and(eq(conversations.id, id), eq(conversations.userId, me.userId)));
    if (!c) throw notFound('That conversation');
    return { me, c };
  };
  app.get('/conversations/:id', async req => { const { c } = await mine(req); return thread(c, 'resident'); });
  app.post('/conversations/:id/messages', async req => {
    const { me, c } = await mine(req);
    const b = parse(Text, req.body);
    await db.insert(conversationMessages).values({ conversationId: c.id, fromUserId: me.userId, fromRole: 'resident', fromName: me.name, text: b.text, attachmentUrl: b.attachmentUrl ?? null });
    // writing again reopens a closed conversation
    const [u] = await db.update(conversations).set({ lastMessageAt: new Date(), status: 'Open' }).where(eq(conversations.id, c.id)).returning();
    await notify(db, await staffIds(c.associationId), { kind: 'messages', title: `${me.name} (${me.unitCode}) replied`, body: b.text.slice(0, 140), href: '/messages/' + c.id });
    return thread(u!, 'resident');
  });

  /* the office */
  app.get('/admin/:aid/conversations', async req => {
    const { aid } = await office(req);
    const { status } = parse(z.object({ status: z.enum(['Open', 'Closed']).optional() }), req.query);
    return convOut(await db.select().from(conversations).where(and(eq(conversations.associationId, aid), status ? eq(conversations.status, status) : undefined)).orderBy(desc(conversations.lastMessageAt)).limit(300), true);
  });
  /** the office writes first */
  app.post('/admin/:aid/conversations', async (req, reply) => {
    const { aid, staff } = await office(req);
    const b = parse(Text.extend({ userId: z.uuid(), subject: z.string().trim().min(3).max(120), topic: z.enum(CONVERSATION_TOPICS).default('General') }), req.body);
    const [r] = await resolveAudience(db, aid, { kind: 'residents', userIds: [b.userId] });
    if (!r) throw notFound('That resident');
    const [c] = await db.insert(conversations).values({ associationId: aid, userId: b.userId, subject: b.subject, topic: b.topic }).returning();
    await db.insert(conversationMessages).values({ conversationId: c!.id, fromUserId: staff.userId, fromRole: 'staff', fromName: signature(staff), text: b.text, attachmentUrl: b.attachmentUrl ?? null });
    await notify(db, [b.userId], { kind: 'messages', title: 'Society office: ' + b.subject, body: b.text.slice(0, 140), href: '/messages/' + c!.id });
    return reply.status(201).send(await thread(c!, 'staff'));
  });
  const theirs = async (req: FastifyRequest) => {
    const { aid, staff } = await office(req);
    const { id } = parse(Id, req.params);
    const [c] = await db.select().from(conversations).where(and(eq(conversations.id, id), eq(conversations.associationId, aid)));
    if (!c) throw notFound('That conversation');
    return { staff, c };
  };
  app.get('/admin/:aid/conversations/:id', async req => { const { c } = await theirs(req); return thread(c, 'staff'); });
  app.post('/admin/:aid/conversations/:id/messages', async req => {
    const { staff, c } = await theirs(req);
    const b = parse(Text, req.body);
    await db.insert(conversationMessages).values({ conversationId: c.id, fromUserId: staff.userId, fromRole: 'staff', fromName: signature(staff), text: b.text, attachmentUrl: b.attachmentUrl ?? null });
    const [u] = await db.update(conversations).set({ lastMessageAt: new Date() }).where(eq(conversations.id, c.id)).returning();
    await notify(db, [c.userId], { kind: 'messages', title: 'Society office replied', body: b.text.slice(0, 140), href: '/messages/' + c.id });
    return thread(u!, 'staff');
  });
  app.post('/admin/:aid/conversations/:id/status', async req => {
    const { c } = await theirs(req);
    const { status } = parse(z.object({ status: z.enum(['Open', 'Closed']) }), req.body);
    const [u] = await db.update(conversations).set({ status }).where(eq(conversations.id, c.id)).returning();
    return thread(u!, 'staff');
  });
};
