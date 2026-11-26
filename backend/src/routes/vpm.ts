import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../app.js';
import { associations, issues, opsActivity, primaryVpms as chosenVpms, refreshTokens, staffRoles, users } from '../db/schema.js';
import { staffOf, userIdFrom } from '../lib/auth.js';
import { seen } from '../lib/presence.js';
import { primaryVpms } from '../lib/vpm.js';
import { conflict, forbidden, notFound, parse } from '../lib/http.js';

const Phone = z.string().regex(/^[6-9]\d{9}$/, 'Mobile numbers have 10 digits and start with 6, 7, 8 or 9');

/**
 * Virtual Property Managers. The operator creates a VPM in the Owner Portal and assigns societies to
 * them; the VPM signs in on the mobile app (their mobile number + OTP) and manages only those societies,
 * using the same /v1/admin/:aid routes a society admin uses.
 */
export const vpmRoutes = ({ config, db }: Deps): FastifyPluginAsync => async app => {
  const uid = (req: FastifyRequest) => userIdFrom(req, config.JWT_SECRET);
  const operator = async (req: FastifyRequest) => staffOf(db, await uid(req), null, ['operator']);

  /* =============== the VPM, in the app =============== */
  /** who I am, the societies I manage with what's waiting in each, and the requests that most need me across all of them */
  app.get('/vpm/me', async req => {
    const userId = await uid(req);
    const [user] = await db.select({ id: users.id, name: users.name, phone: users.phone }).from(users).where(and(eq(users.id, userId), isNull(users.deletedAt)));
    const rows = await db.select({
      id: associations.id, name: associations.name, short: associations.short, city: associations.city,
      open: sql<number>`(select count(*)::int from issues i where i.association_id = ${associations.id} and i.status not in ('Resolved','Closed'))`,
      fresh: sql<number>`(select count(*)::int from issues i where i.association_id = ${associations.id} and i.status = 'Submitted')`,
      emergencies: sql<number>`(select count(*)::int from issues i where i.association_id = ${associations.id} and i.priority = 'Emergency' and i.status not in ('Resolved','Closed'))`,
      overdue: sql<number>`(select count(*)::int from issues i where i.association_id = ${associations.id} and i.status not in ('Resolved','Closed','On Hold') and i.sla_due_at < now())`,
      approvals: sql<number>`(select count(*)::int from issues i where i.association_id = ${associations.id} and i.approval = 'pending' and i.status not in ('Resolved','Closed'))`,
      resolvedWeek: sql<number>`(select count(*)::int from issue_events e join issues i on i.id = e.issue_id where i.association_id = ${associations.id} and e.status = 'Resolved' and e.created_at > now() - interval '7 days')`,
      homes: sql<number>`(select count(*)::int from units u where u.association_id = ${associations.id})`,
      residents: sql<number>`(select count(distinct m.user_id)::int from unit_members m join units u on u.id = m.unit_id where u.association_id = ${associations.id} and m.status = 'active')`,
    }).from(staffRoles).innerJoin(associations, eq(associations.id, staffRoles.associationId))
      .where(and(eq(staffRoles.userId, userId), eq(staffRoles.role, 'vpm'))).orderBy(associations.name);
    if (!user || !rows.length) throw forbidden('This number isn’t set up as a property manager, or no societies are assigned yet.');
    await seen(db, userId);
    // residents' unread messages, and visit requests waiting for an answer — counted apart, so that a table not yet
    // created (a migration not run) leaves the count out instead of stopping the manager from signing in
    const count = async (q: ReturnType<typeof sql>) => { try { return ((await db.execute(q)) as unknown as { rows: { aid: string; n: number }[] }).rows; } catch { return null; } };
    const ids = sql.join(rows.map(r => sql`${r.id}`), sql`, `);
    const unread = await count(sql`select c.association_id as aid, count(*)::int as n from conversation_messages m join conversations c on c.id = m.conversation_id
      where c.association_id in (${ids}) and m.from_role = 'resident' and m.read_at is null group by c.association_id`);
    const waiting = await count(sql`select association_id as aid, count(*)::int as n from site_visit_items where association_id in (${ids}) and status = 'Requested' group by association_id`);
    const societies = rows.map(r => ({ ...r, unread: unread ? unread.find(u => u.aid === r.id)?.n ?? 0 : undefined, visitRequests: waiting ? waiting.find(w => w.aid === r.id)?.n ?? 0 : undefined }));
    // emergencies first, then what is past its response time, then what nobody has picked up yet
    const attention = await db.select({
      aid: issues.associationId, society: associations.short, number: issues.number, title: issues.title, category: issues.category, priority: issues.priority, status: issues.status, slaDueAt: issues.slaDueAt,
      overdue: sql<boolean>`${issues.slaDueAt} < now() and ${issues.status} <> 'On Hold'`,
    }).from(issues).innerJoin(associations, eq(associations.id, issues.associationId))
      .where(and(inArray(issues.associationId, rows.map(r => r.id)), sql`${issues.status} not in ('Resolved','Closed')`,
        sql`(${issues.priority} = 'Emergency' or ${issues.status} = 'Submitted' or (${issues.slaDueAt} < now() and ${issues.status} <> 'On Hold'))`))
      .orderBy(sql`case when ${issues.priority} = 'Emergency' then 0 when ${issues.slaDueAt} < now() then 1 else 2 end`, issues.slaDueAt).limit(6);
    return { user, societies, attention: attention.map(({ number, ...a }) => ({ ...a, ref: 'ISS-' + number })) };
  });

  /* =============== the operator, in the Owner Portal =============== */
  const listVpms = async () => {
    const people = await db.selectDistinct({ id: users.id, name: users.name, phone: users.phone, email: users.email, createdAt: users.createdAt })
      .from(users).innerJoin(staffRoles, eq(staffRoles.userId, users.id)).where(and(eq(staffRoles.role, 'vpm'), isNull(users.deletedAt)));
    const links = await db.select({ userId: staffRoles.userId, id: associations.id, name: associations.name })
      .from(staffRoles).innerJoin(associations, eq(associations.id, staffRoles.associationId)).where(eq(staffRoles.role, 'vpm'));
    const open = await db.select({ associationId: issues.associationId, n: sql<number>`count(*)::int` }).from(issues)
      .where(sql`${issues.status} not in ('Resolved','Closed')`).groupBy(issues.associationId);
    // who residents see in each society, and how many managers share it
    const primary = await primaryVpms(db);
    return people.map(p => {
      const societies = links.filter(l => l.userId === p.id).map(({ id, name }) => ({
        id, name, primary: primary.get(id) === p.id, shared: links.filter(l => l.id === id).length,
      }));
      return { ...p, societies, openIssues: societies.reduce((n, s) => n + (open.find(o => o.associationId === s.id)?.n ?? 0), 0) };
    }).sort((a, b) => a.name.localeCompare(b.name));
  };

  app.get('/ops/vpms', async req => { await operator(req); return listVpms(); });

  /** Create a VPM and assign their societies. They sign in to the app with this mobile number. */
  app.post('/ops/vpms', async (req, reply) => {
    const op = await operator(req);
    const b = parse(z.object({ name: z.string().trim().min(2).max(80), phone: Phone, email: z.email().optional(), associationIds: z.array(z.uuid()).min(1, 'Assign at least one society') }), req.body);
    const id = await db.transaction(async tx => {
      const found = await tx.select({ id: associations.id }).from(associations).where(inArray(associations.id, b.associationIds));
      if (found.length !== new Set(b.associationIds).size) throw notFound('One of those societies');
      let [u] = await tx.select().from(users).where(eq(users.phone, b.phone));
      if (u?.deletedAt) throw conflict('number_unavailable', 'That number can’t be used.');
      if (u) {
        const [already] = await tx.select().from(staffRoles).where(and(eq(staffRoles.userId, u.id), eq(staffRoles.role, 'vpm')));
        if (already) throw conflict('already_vpm', 'That number already belongs to a property manager.');
      } else {
        [u] = await tx.insert(users).values({ name: b.name, phone: b.phone, email: b.email?.toLowerCase() ?? null }).returning();
      }
      await tx.insert(staffRoles).values([...new Set(b.associationIds)].map(associationId => ({ userId: u!.id, associationId, role: 'vpm' as const, title: 'Property Manager' })));
      await tx.insert(opsActivity).values({ who: op.name, what: `created property manager ${b.name} · ${found.length} ${found.length === 1 ? 'society' : 'societies'}` });
      return u!.id;
    });
    return reply.status(201).send((await listVpms()).find(v => v.id === id));
  });

  /** Replace the societies a VPM manages. They lose access to any that are removed at once. */
  app.put('/ops/vpms/:id/societies', async req => {
    const op = await operator(req);
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const { associationIds } = parse(z.object({ associationIds: z.array(z.uuid()).min(1, 'Assign at least one society') }), req.body);
    const [vpm] = await db.select({ name: users.name }).from(users).innerJoin(staffRoles, eq(staffRoles.userId, users.id)).where(and(eq(users.id, id), eq(staffRoles.role, 'vpm')));
    if (!vpm) throw notFound('Property manager');
    const want = [...new Set(associationIds)];
    const found = await db.select({ id: associations.id }).from(associations).where(inArray(associations.id, want));
    if (found.length !== want.length) throw notFound('One of those societies');
    await db.transaction(async tx => {
      await tx.delete(staffRoles).where(and(eq(staffRoles.userId, id), eq(staffRoles.role, 'vpm')));
      await tx.insert(staffRoles).values(want.map(associationId => ({ userId: id, associationId, role: 'vpm' as const, title: 'Property Manager' })));
      await tx.insert(opsActivity).values({ who: op.name, what: `reassigned ${vpm.name} · now ${want.length} ${want.length === 1 ? 'society' : 'societies'}` });
    });
    // a society they no longer manage stops showing them to residents
    try { await db.delete(chosenVpms).where(and(eq(chosenVpms.userId, id), sql`${chosenVpms.associationId} not in (${sql.join(want.map(w => sql`${w}`), sql`, `)})`)); } catch { /* not migrated yet: nothing was chosen */ }
    return (await listVpms()).find(v => v.id === id);
  });

  /** Make this VPM the one residents of a society see (and call) when several manage it. */
  app.put('/ops/vpms/:id/primary', async req => {
    const op = await operator(req);
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const { associationId } = parse(z.object({ associationId: z.uuid() }), req.body);
    const [link] = await db.select({ name: users.name, society: associations.name }).from(staffRoles)
      .innerJoin(users, eq(users.id, staffRoles.userId)).innerJoin(associations, eq(associations.id, staffRoles.associationId))
      .where(and(eq(staffRoles.userId, id), eq(staffRoles.role, 'vpm'), eq(staffRoles.associationId, associationId)));
    if (!link) throw notFound('That property manager in that society');
    await db.insert(chosenVpms).values({ associationId, userId: id }).onConflictDoUpdate({ target: chosenVpms.associationId, set: { userId: id, updatedAt: new Date() } });
    await db.insert(opsActivity).values({ who: op.name, what: `made ${link.name} the primary property manager for ${link.society}` });
    return listVpms();
  });

  /** Remove a VPM: their access to every society ends and they are signed out everywhere. */
  app.delete('/ops/vpms/:id', async (req, reply) => {
    const op = await operator(req);
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const gone = await db.delete(staffRoles).where(and(eq(staffRoles.userId, id), eq(staffRoles.role, 'vpm'))).returning();
    if (!gone.length) throw notFound('Property manager');
    try { await db.delete(chosenVpms).where(eq(chosenVpms.userId, id)); } catch { /* not migrated yet: nothing was chosen */ }
    await db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.userId, id), isNull(refreshTokens.revokedAt)));
    const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, id));
    await db.insert(opsActivity).values({ who: op.name, what: `removed property manager ${u?.name ?? ''}` });
    return reply.status(204).send();
  });
};
