import { and, desc, eq } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../app.js';
import { issueEvents, issues, issueUpdates } from '../db/schema.js';
import { audit } from '../lib/audit.js';
import { residentOf, userIdFrom } from '../lib/auth.js';
import { conflict, forbidden, parse } from '../lib/http.js';
import { CATEGORIES, createIssue, loadIssue, parseRef, ref } from '../lib/issues.js';
import { announceNew } from './maintenance.js';

const Ref = z.object({ ref: z.string() });
/** photos must be files this API stored — never arbitrary URLs */
const OwnPhoto = (base: string) => z.string().refine(u => u.startsWith(base + '/files/'), 'photoUrl must come from /v1/uploads');

export const issueRoutes = ({ config, db }: Deps): FastifyPluginAsync => async app => {
  const me = async (req: FastifyRequest) => residentOf(db, await userIdFrom(req, config.JWT_SECRET));

  /** The resident's own tickets, newest first. */
  app.get('/', async req => {
    const r = await me(req);
    const rows = await db.select({ number: issues.number }).from(issues)
      .where(and(eq(issues.associationId, r.associationId), eq(issues.reporterId, r.userId))).orderBy(desc(issues.createdAt));
    return Promise.all(rows.map(x => loadIssue(db, r.associationId, x.number, { viewerId: r.userId })));
  });

  app.post('/', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const r = await me(req);
    const b = parse(z.object({
      title: z.string().trim().min(4).max(120),
      details: z.string().trim().max(2000).optional(),
      category: z.enum(CATEGORIES),
      location: z.string().trim().min(2).max(80),
      priority: z.enum(['Low', 'Medium', 'High', 'Emergency']),
      via: z.enum(['chat', 'form']),
      photoUrl: OwnPhoto(config.PUBLIC_URL).optional(),
    }), req.body);
    const row = await createIssue(db, { ...b, associationId: r.associationId, reporterId: r.userId, reporterName: r.name, unitId: r.unitId });
    await announceNew(db, r.associationId, row.number, row.title, row.priority);
    return reply.status(201).send(await loadIssue(db, r.associationId, row.number, { viewerId: r.userId }));
  });

  /** Residents see their own tickets in full. */
  app.get('/:ref', async req => {
    const r = await me(req);
    const issue = await loadIssue(db, r.associationId, parseRef(parse(Ref, req.params).ref), { viewerId: r.userId });
    if (!issue.mine) throw forbidden('You can only open issues you reported.');
    return issue;
  });

  const mineOrThrow = async (req: FastifyRequest) => {
    const r = await me(req);
    const n = parseRef(parse(Ref, req.params).ref);
    const [i] = await db.select().from(issues).where(and(eq(issues.associationId, r.associationId), eq(issues.number, n)));
    if (!i || i.reporterId !== r.userId) throw forbidden('You can only update issues you reported.');
    return { r, i };
  };

  /** A comment and/or photo on the ticket. */
  app.post('/:ref/updates', async (req, reply) => {
    const { r, i } = await mineOrThrow(req);
    const b = parse(z.object({ text: z.string().trim().max(1000).default(''), photoUrl: OwnPhoto(config.PUBLIC_URL).optional() })
      .refine(x => x.text || x.photoUrl, 'Write a comment or attach a photo'), req.body);
    if (i.status === 'Closed') throw conflict('issue_closed', 'This issue is closed.');
    await db.insert(issueUpdates).values({ issueId: i.id, userId: r.userId, text: b.text, photoUrl: b.photoUrl ?? null });
    return reply.status(201).send(await loadIssue(db, r.associationId, i.number, { viewerId: r.userId }));
  });

  /** Not fixed after all — back to the office with a reason. */
  app.post('/:ref/reopen', async req => {
    const { r, i } = await mineOrThrow(req);
    const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(500) }), req.body);
    if (i.status !== 'Resolved') throw conflict('not_resolved', 'Only a resolved issue can be reopened.');
    await db.transaction(async tx => {
      await tx.update(issues).set({ status: 'Acknowledged', rating: null }).where(eq(issues.id, i.id));
      await tx.insert(issueEvents).values({ issueId: i.id, status: 'Acknowledged', note: 'Reopened by resident: ' + reason, byUserId: r.userId });
      await audit(tx, r.associationId, r.userId, r.name, `${ref(i.number)} reopened by resident`);
    });
    return loadIssue(db, r.associationId, i.number, { viewerId: r.userId });
  });

  /** Private 1–5 rating once it's fixed. */
  app.post('/:ref/rating', async req => {
    const { r, i } = await mineOrThrow(req);
    const { stars } = parse(z.object({ stars: z.number().int().min(1).max(5) }), req.body);
    if (!['Resolved', 'Closed'].includes(i.status)) throw conflict('not_resolved', 'You can rate an issue once it’s resolved.');
    await db.update(issues).set({ rating: stars }).where(eq(issues.id, i.id));
    return { rated: stars };
  });
};
