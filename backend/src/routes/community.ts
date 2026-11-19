import { and, asc, desc, eq, notInArray, or, sql, type AnyColumn } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../app.js';
import { blocks, gratitudes, posts, reactions, replies, reports, users } from '../db/schema.js';
import { audit } from '../lib/audit.js';
import { residentOf, userIdFrom, type Resident } from '../lib/auth.js';
import { assertCanPost, holdsBorderline, notify, queueForModeration, thresholdOf } from '../lib/community.js';
import { badRequest, conflict, forbidden, HttpError, notFound, parse } from '../lib/http.js';
import { checkSafety } from '../lib/safety.js';

const postRef = (n: number) => 'D-' + n;
function parsePostRef(r: string) {
  const m = /^D-(\d{1,9})$/i.exec(r);
  if (!m) throw badRequest('invalid_ref', 'Post numbers look like D-231.');
  return Number(m[1]);
}
/** the author's flat, unless they chose to hide it (Profile → Privacy) */
const flatOf = (author: AnyColumn) => sql<string | null>`(
  select u.code from unit_members m join units u on u.id = m.unit_id
  where m.user_id = ${author} and m.status = 'active'
    and coalesce((select (s.privacy->>'showFlat')::boolean from user_settings s where s.user_id = ${author}), true)
  limit 1)`;

/** 422: nothing was posted — these words must go */
const blocked = (words: string[]) => Object.assign(new HttpError(422, 'blocked', 'That can’t be posted as written. Please rephrase.'), { words });

export const communityRoutes = ({ config, db, ai }: Deps): FastifyPluginAsync => async app => {
  /** word lists first (instant, free); if they pass and AI is connected, a second opinion for what lists can't catch */
  const moderate = async (text: string, associationId: string) => {
    const rules = checkSafety(text, await thresholdOf(db, associationId));
    if (rules.level !== 'safe' || !ai.enabled) return rules;
    return (await ai.moderate(text)) ?? rules;
  };
  const me = async (req: FastifyRequest) => residentOf(db, await userIdFrom(req, config.JWT_SECRET));
  const blockedBy = async (userId: string) => (await db.select({ id: blocks.blockedUserId }).from(blocks).where(eq(blocks.userId, userId))).map(b => b.id);

  // error bodies for "blocked"/"needs_review" carry the words so the app can name them
  app.setErrorHandler((err, _req, reply) => {
    const words = (err as { words?: string[] }).words;
    if (err instanceof HttpError && words) return reply.status(err.status).send({ error: { code: err.code, message: err.message, words } });
    throw err;
  });

  const listPosts = async (r: Resident, where?: ReturnType<typeof and>) => {
    const hidden = await blockedBy(r.userId);
    const rows = await db.select({
      id: posts.id, number: posts.number, title: posts.title, body: posts.body, state: posts.state, pinned: posts.pinned, createdAt: posts.createdAt,
      authorId: posts.authorId, by: users.name, unit: flatOf(posts.authorId),
      comments: sql<number>`(select count(*)::int from replies c where c.post_id = ${posts.id} and c.state = 'published')`,
      reactions: sql<Record<string, number>>`coalesce((select jsonb_object_agg(k.kind, k.n) from (select kind, count(*)::int n from reactions x where x.post_id = ${posts.id} group by kind) k), '{}'::jsonb)`,
      myReaction: sql<string | null>`(select x.kind from reactions x where x.post_id = ${posts.id} and x.user_id = ${r.userId})`,
    }).from(posts).leftJoin(users, eq(users.id, posts.authorId))
      .where(and(
        eq(posts.associationId, r.associationId),
        // everyone sees published posts; authors also see their own held or removed ones
        or(eq(posts.state, 'published'), eq(posts.authorId, r.userId)),
        hidden.length ? or(notInArray(posts.authorId, hidden), sql`${posts.authorId} is null`) : undefined,
        where,
      )).orderBy(desc(posts.pinned), desc(posts.createdAt));
    return rows.map(({ number, authorId, ...p }) => ({ ...p, ref: postRef(number), by: p.by ?? 'Former resident', authorId, mine: authorId === r.userId }));
  };

  /* ---------- posts ---------- */
  app.get('/posts', async req => listPosts(await me(req)));

  /**
   * Publish a post. Abusive text is refused (422 blocked). Borderline text comes back 409 needs_review
   * with the words; sending it again with `confirm: true` posts it held for a moderator, visible only to its author.
   */
  app.post('/posts', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const r = await me(req);
    const b = parse(z.object({ text: z.string().trim().min(3).max(4000), confirm: z.boolean().default(false) }), req.body);
    await assertCanPost(db, r.userId, r.associationId);
    const safety = await moderate(b.text, r.associationId);
    if (safety.level === 'block') throw blocked(safety.words);
    if (safety.level === 'warn' && !b.confirm) {
      throw Object.assign(conflict('needs_review', 'This may come across as hostile. Rephrase it, or post it for a moderator to review first.'), { words: safety.words });
    }
    const flagged = safety.level === 'warn';
    // the society decides whether a warned post waits for a moderator or goes up at once; either way it is put in the queue
    const held = flagged && await holdsBorderline(db, r.associationId);
    const first = b.text.split('\n')[0] ?? b.text;
    const title = first.length > 52 ? first.slice(0, 49) + '…' : first;
    const row = await db.transaction(async tx => {
      const [{ next }] = (await tx.select({ next: sql<number>`coalesce(max(${posts.number}), 231) + 1` }).from(posts).where(eq(posts.associationId, r.associationId))) as [{ next: number }];
      const [p] = await tx.insert(posts).values({ associationId: r.associationId, number: next, authorId: r.userId, title, body: b.text, state: held ? 'held' : 'published' }).returning();
      if (!p) throw new Error('insert failed');
      if (flagged) await queueForModeration(tx, { associationId: r.associationId, kind: 'Discussion post', authorId: r.userId, text: b.text, category: 'Aggressive', severity: 'Medium', reason: 'Author chose to post after a warning (' + safety.words.join(', ') + '). ' + (held ? 'Review in context.' : 'It is already visible — hide it if it should not be.'), context: 'New post in Discussions', targetType: 'post', targetId: p.id });
      return p;
    });
    const [post] = await listPosts(r, eq(posts.id, row.id));
    return reply.status(201).send(post);
  });

  const findPost = async (r: Resident, ref: string) => {
    const [p] = await db.select().from(posts).where(and(eq(posts.associationId, r.associationId), eq(posts.number, parsePostRef(ref))));
    if (!p || (p.state !== 'published' && p.authorId !== r.userId)) throw notFound('Post');
    return p;
  };

  app.get('/posts/:ref', async req => {
    const r = await me(req);
    const p = await findPost(r, parse(z.object({ ref: z.string() }), req.params).ref);
    const hidden = await blockedBy(r.userId);
    if (p.authorId && hidden.includes(p.authorId)) throw new HttpError(403, 'author_blocked', 'You blocked this resident.');
    const [post] = await listPosts(r, eq(posts.id, p.id));
    const thread = await db.select({ id: replies.id, text: replies.text, state: replies.state, createdAt: replies.createdAt, authorId: replies.authorId, by: users.name, unit: flatOf(replies.authorId) })
      .from(replies).leftJoin(users, eq(users.id, replies.authorId))
      .where(and(eq(replies.postId, p.id), or(eq(replies.state, 'published'), and(eq(replies.authorId, r.userId), eq(replies.state, 'held'))),
        hidden.length ? or(notInArray(replies.authorId, hidden), sql`${replies.authorId} is null`) : undefined))
      .orderBy(asc(replies.createdAt));
    return { ...post, replies: thread.map(x => ({ ...x, by: x.by ?? 'Former resident', mine: x.authorId === r.userId })) };
  });

  /** residents can always take down what they wrote */
  app.delete('/posts/:ref', async (req, reply) => {
    const r = await me(req);
    const p = await findPost(r, parse(z.object({ ref: z.string() }), req.params).ref);
    if (p.authorId !== r.userId) throw forbidden('You can only delete your own posts.');
    await db.delete(posts).where(eq(posts.id, p.id));
    return reply.status(204).send();
  });

  /** A reply. Abusive → refused; borderline → posted held (only its author sees it) and queued for a moderator. */
  app.post('/posts/:ref/replies', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const r = await me(req);
    const p = await findPost(r, parse(z.object({ ref: z.string() }), req.params).ref);
    const { text } = parse(z.object({ text: z.string().trim().min(1).max(1000) }), req.body);
    if (p.state !== 'published') throw conflict('post_not_open', 'Replies open once this post is published.');
    await assertCanPost(db, r.userId, r.associationId);
    const safety = await moderate(text, r.associationId);
    if (safety.level === 'block') throw blocked(safety.words);
    const flagged = safety.level === 'warn';
    const held = flagged && await holdsBorderline(db, r.associationId);
    const [row] = await db.insert(replies).values({ postId: p.id, authorId: r.userId, text, state: held ? 'held' : 'published' }).returning();
    if (!row) throw new Error('insert failed');
    if (flagged) {
      await queueForModeration(db, { associationId: r.associationId, kind: 'Discussion reply', authorId: r.userId, text, category: 'Aggressive', severity: 'Medium', reason: 'Reply tripped the warning list (' + safety.words.join(', ') + '). ' + (held ? 'Review in thread context.' : 'It is already visible — hide it if it should not be.'), context: 'Reply on “' + p.title + '”', targetType: 'reply', targetId: row.id });
    }
    if (!held && p.authorId && p.authorId !== r.userId) {
      await notify(db, [p.authorId], { kind: 'discussions', title: r.name + ' replied to your post', body: text.slice(0, 120), href: '/discussions/' + postRef(p.number) });
    }
    return reply.status(201).send({ id: row.id, text: row.text, state: row.state, createdAt: row.createdAt, by: r.name, unit: r.unitCode, authorId: r.userId, mine: true });
  });

  app.delete('/replies/:id', async (req, reply) => {
    const r = await me(req);
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const done = await db.delete(replies).where(and(eq(replies.id, id), eq(replies.authorId, r.userId))).returning();
    if (!done.length) throw notFound('Comment');
    return reply.status(204).send();
  });

  /** set, change or clear (kind: null) your one reaction on a post */
  app.put('/posts/:ref/reaction', async req => {
    const r = await me(req);
    const p = await findPost(r, parse(z.object({ ref: z.string() }), req.params).ref);
    const { kind } = parse(z.object({ kind: z.string().min(1).max(16).nullable() }), req.body);
    if (kind === null) await db.delete(reactions).where(and(eq(reactions.postId, p.id), eq(reactions.userId, r.userId)));
    else await db.insert(reactions).values({ postId: p.id, userId: r.userId, kind }).onConflictDoUpdate({ target: [reactions.postId, reactions.userId], set: { kind } });
    return { kind };
  });

  /* ---------- report & block ---------- */
  /** One report per item. Goes to the moderation queue; the author is never told who reported. */
  app.post('/reports', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async req => {
    const r = await me(req);
    const b = parse(z.object({ targetType: z.enum(['post', 'reply']), targetId: z.uuid() }), req.body);
    let authorId: string | null, text: string, context: string;
    if (b.targetType === 'post') {
      const [p] = await db.select().from(posts).where(and(eq(posts.id, b.targetId), eq(posts.associationId, r.associationId)));
      if (!p) throw notFound('Post');
      authorId = p.authorId; text = p.title === p.body ? p.body : p.title + '\n\n' + p.body; context = 'Discussion ' + postRef(p.number);
    } else {
      const [c] = await db.select({ authorId: replies.authorId, text: replies.text, number: posts.number, aid: posts.associationId })
        .from(replies).innerJoin(posts, eq(posts.id, replies.postId)).where(eq(replies.id, b.targetId));
      if (!c || c.aid !== r.associationId) throw notFound('Comment');
      authorId = c.authorId; text = c.text; context = 'Reply in discussion ' + postRef(c.number);
    }
    if (authorId === r.userId) throw badRequest('own_content', 'You can delete your own content instead of reporting it.');
    const done = await db.insert(reports).values({ associationId: r.associationId, reporterId: r.userId, ...b }).onConflictDoNothing().returning();
    if (!done.length) return { reported: true, already: true };
    await queueForModeration(db, { associationId: r.associationId, kind: b.targetType === 'post' ? 'Reported post' : 'Reported reply', authorId, text, category: 'Reported by a resident', severity: 'Medium', reason: `Reported by ${r.name} (${r.unitCode}). The reporter is visible to moderators only.`, context, targetType: b.targetType, targetId: b.targetId });
    await audit(db, r.associationId, r.userId, 'System', `resident report queued for moderation · ${context}`);
    return { reported: true, already: false };
  });

  app.get('/blocks', async req => {
    const r = await me(req);
    return db.select({ userId: blocks.blockedUserId, name: users.name }).from(blocks).innerJoin(users, eq(users.id, blocks.blockedUserId)).where(eq(blocks.userId, r.userId));
  });
  app.post('/blocks', async req => {
    const r = await me(req);
    const { userId } = parse(z.object({ userId: z.uuid() }), req.body);
    if (userId === r.userId) throw badRequest('self_block', 'You can’t block yourself.');
    await db.insert(blocks).values({ userId: r.userId, blockedUserId: userId }).onConflictDoNothing();
    return { blocked: true };
  });
  app.delete('/blocks/:userId', async (req, reply) => {
    const r = await me(req);
    const { userId } = parse(z.object({ userId: z.uuid() }), req.params);
    await db.delete(blocks).where(and(eq(blocks.userId, r.userId), eq(blocks.blockedUserId, userId)));
    return reply.status(204).send();
  });

  /* ---------- gratitude ---------- */
  /** The wall: notes to the whole community, plus the ones you sent or received (those stay private). */
  app.get('/gratitudes', async req => {
    const r = await me(req);
    const rows = await db.select({ id: gratitudes.id, fromId: gratitudes.fromId, by: users.name, to: gratitudes.toLabel, toUserId: gratitudes.toUserId, category: gratitudes.category, text: gratitudes.text, createdAt: gratitudes.createdAt })
      .from(gratitudes).leftJoin(users, eq(users.id, gratitudes.fromId))
      .where(and(eq(gratitudes.associationId, r.associationId), eq(gratitudes.state, 'sent'),
        or(sql`${gratitudes.toUserId} is null and ${gratitudes.toLabel} = 'The whole community'`, eq(gratitudes.fromId, r.userId), eq(gratitudes.toUserId, r.userId))))
      .orderBy(desc(gratitudes.createdAt)).limit(100);
    return rows.map(g => ({ ...g, by: g.by ?? 'Former resident', mine: g.fromId === r.userId, toMe: g.toUserId === r.userId }));
  });

  app.post('/gratitudes', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const r = await me(req);
    const b = parse(z.object({ text: z.string().trim().min(1).max(200), category: z.string().trim().min(1).max(40), toUserId: z.uuid().optional(), toLabel: z.string().trim().min(1).max(60) }), req.body);
    await assertCanPost(db, r.userId, r.associationId);
    const safety = await moderate(b.text, r.associationId);
    const held = safety.level === 'block' || (safety.level === 'warn' && await holdsBorderline(db, r.associationId));
    const [g] = await db.insert(gratitudes).values({ associationId: r.associationId, fromId: r.userId, toUserId: b.toUserId ?? null, toLabel: b.toLabel, category: b.category, text: b.text, state: held ? 'held' : 'sent' }).returning();
    if (!g) throw new Error('insert failed');
    if (held) {
      await queueForModeration(db, { associationId: r.associationId, kind: 'Gratitude note', authorId: r.userId, text: b.text, category: safety.level === 'block' ? 'Abusive' : 'Aggressive', severity: safety.level === 'block' ? 'High' : 'Medium', reason: 'Gratitude text failed the safety check — held before delivery.', context: 'Gratitude to ' + b.toLabel, targetType: 'gratitude', targetId: g.id });
    } else {
      if (b.toUserId) await notify(db, [b.toUserId], { kind: 'gratitude', title: 'Gratitude received', body: `${r.name} thanked you: “${b.text.slice(0, 100)}”`, href: '/impact?focus=gratitudes' });
      // the note's text is private to the recipient, so the audit records only that one was sent
      await audit(db, r.associationId, r.userId, 'System', `gratitude sent · ${r.name} → ${b.toLabel} · ${b.category}`);
    }
    return reply.status(201).send({ id: g.id, state: g.state });
  });

  // residents to thank or block by name
  app.get('/neighbours', async req => {
    const r = await me(req);
    const rows = await db.execute(sql`select distinct u.id, u.name, un.code as unit from users u join unit_members m on m.user_id = u.id and m.status = 'active' join units un on un.id = m.unit_id where un.association_id = ${r.associationId} and u.deleted_at is null and u.id <> ${r.userId} order by u.name`);
    return (rows as unknown as { rows: unknown[] }).rows;
  });

};
