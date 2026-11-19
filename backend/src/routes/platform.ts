import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../app.js';
import { associations, opsActivity, refreshTokens, staffRoles, subscriptions, supportTickets, ticketReplies, users } from '../db/schema.js';
import { staffOf, userIdFrom } from '../lib/auth.js';
import { hashPassword, verifyPassword } from '../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound, parse } from '../lib/http.js';
import { MODULES } from '../lib/ops.js';
import { accessOf, FEATURES, forgetPlans, modulesWith, planConfig, PLANS, savePlanConfig, type Feature } from '../lib/plans.js';

const Id = z.object({ id: z.uuid() });
const Aid = z.object({ aid: z.uuid() });
const Password = z.string().min(8, 'A password needs at least 8 characters').max(100);
const PlanName = z.enum(['Starter', 'Professional', 'Enterprise']);
const SLA_HOURS = { High: 8, Medium: 24, Low: 72 } as const;
const CATEGORIES = ['Billing', 'Bug', 'Data', 'Access', 'Feature', 'Other'] as const;

/**
 * The platform's own housekeeping.
 *   /v1/ops/plans · /ops/associations/:id (edit, remove) · /ops/operators     the super admin
 *   /v1/admin/:aid/plan · /admin/:aid/support                                  a society: what it is on, and writing to Trinize
 *   /v1/auth/staff/password                                                    any staff member changing their own password
 */
export const platformRoutes = ({ config, db }: Deps): FastifyPluginAsync => async app => {
  const uid = (req: FastifyRequest) => userIdFrom(req, config.JWT_SECRET);
  const operator = async (req: FastifyRequest) => staffOf(db, await uid(req), null, ['operator']);
  const log = (who: string, what: string) => db.insert(opsActivity).values({ who, what });

  /* ================= plans ================= */
  const plansOut = async () => {
    const c = await planConfig(db);
    return { plans: c.plans, modules: modulesWith(c), features: Object.fromEntries((Object.keys(FEATURES) as Feature[]).map(k => [k, { name: FEATURES[k].name, module: FEATURES[k].module, from: c.moduleFrom[FEATURES[k].module] }])) };
  };
  app.get('/ops/plans', async req => { await operator(req); return plansOut(); });
  /** change what a plan is called for, what it costs, and which plan each module starts at — it applies to every society at once */
  app.put('/ops/plans', async req => {
    const op = await operator(req);
    const Info = z.object({ tag: z.string().trim().min(2).max(60), about: z.string().trim().min(5).max(300), price: z.number().int().min(0).max(100_000_000) }).partial();
    const b = parse(z.object({ plans: z.partialRecord(PlanName, Info), moduleFrom: z.record(z.string(), PlanName) }).partial(), req.body);
    const unknown = Object.keys(b.moduleFrom ?? {}).filter(n => !MODULES.some(m => m.name === n));
    if (unknown.length) throw badRequest('unknown_module', `There is no module called “${unknown[0]}”.`);
    const before = await planConfig(db);
    const moved = Object.entries(b.moduleFrom ?? {}).filter(([n, p]) => before.moduleFrom[n] !== p).map(([n, p]) => `${n}: ${before.moduleFrom[n]} → ${p}`);
    await savePlanConfig(db, b, op.name);
    await log(op.name, `changed the plans${moved.length ? ' · ' + moved.join(', ') : ''}${b.plans ? ' · details of ' + Object.keys(b.plans).join(', ') : ''}`);
    return plansOut();
  });

  /* ================= a society's details ================= */
  app.put('/ops/associations/:id', async req => {
    const op = await operator(req);
    const { id } = parse(Id, req.params);
    const b = parse(z.object({
      name: z.string().trim().min(3).max(80), short: z.string().trim().min(2).max(40), city: z.string().trim().min(2).max(60), kind: z.enum(['Apartment', 'Villa', 'Plotted', 'Mixed']),
      plots: z.number().int().min(1).max(100000), registration: z.string().trim().max(60), address: z.string().trim().max(200),
      adminName: z.string().trim().min(2).max(80), adminRole: z.string().trim().max(40), adminPhone: z.string().trim().max(20), adminEmail: z.email(),
    }).partial(), req.body);
    const [was] = await db.select().from(associations).where(eq(associations.id, id));
    if (!was) throw notFound('Association');
    if (!Object.keys(b).length) throw conflict('nothing_to_change', 'Nothing was changed.');
    if (b.name && b.name.toLowerCase() !== was.name.toLowerCase()) {
      const [dup] = await db.select({ id: associations.id }).from(associations).where(sql`lower(${associations.name}) = ${b.name.toLowerCase()}`);
      if (dup) throw conflict('name_taken', 'There is already an association with that name.');
    }
    const { name, short, city, ...sub } = b;
    await db.transaction(async tx => {
      if (name || short || city) await tx.update(associations).set({ ...(name ? { name } : {}), ...(short ? { short } : {}), ...(city ? { city } : {}) }).where(eq(associations.id, id));
      if (Object.keys(sub).length) await tx.update(subscriptions).set({ ...sub, ...(sub.adminEmail ? { adminEmail: sub.adminEmail.toLowerCase() } : {}) }).where(eq(subscriptions.associationId, id));
      await tx.insert(opsActivity).values({ who: op.name, what: `edited ${name ?? was.name} · ${Object.keys(b).join(', ')}` });
    });
    return { ok: true };
  });

  /**
   * Remove a society and everything recorded under it. There is no undo, so the caller must send the
   * society's exact name. People's logins are kept (a resident may belong to another society); the
   * console logins that only ever served this society are closed.
   */
  app.delete('/ops/associations/:id', async (req, reply) => {
    const op = await operator(req);
    const { id } = parse(Id, req.params);
    const { confirm } = parse(z.object({ confirm: z.string() }), req.body ?? {});
    const [a] = await db.select().from(associations).where(eq(associations.id, id));
    if (!a) throw notFound('Association');
    if (confirm.trim() !== a.name) throw badRequest('confirm_name', `Type the society’s name exactly — “${a.name}” — to remove it.`);
    await db.transaction(async tx => {
      const staff = (await tx.select({ userId: staffRoles.userId }).from(staffRoles).where(eq(staffRoles.associationId, id))).map(s => s.userId);
      await tx.delete(associations).where(eq(associations.id, id));
      // someone whose only job was this society's console has nothing left to sign in to
      if (staff.length) {
        const still = new Set((await tx.select({ userId: staffRoles.userId }).from(staffRoles).where(inArray(staffRoles.userId, staff))).map(s => s.userId));
        const gone = staff.filter(u => !still.has(u));
        if (gone.length) await tx.update(refreshTokens).set({ revokedAt: new Date() }).where(and(inArray(refreshTokens.userId, gone), isNull(refreshTokens.revokedAt)));
      }
      await tx.insert(opsActivity).values({ who: op.name, what: `removed ${a.name} and all of its records` });
    });
    forgetPlans(db, id);
    return reply.status(204).send();
  });

  /* ================= super admins ================= */
  const operators = () => db.select({ id: users.id, name: users.name, email: users.email, title: staffRoles.title, twoStep: users.totpEnabled, since: users.createdAt })
    .from(staffRoles).innerJoin(users, eq(users.id, staffRoles.userId)).where(and(eq(staffRoles.role, 'operator'), isNull(users.deletedAt))).orderBy(asc(users.name));
  app.get('/ops/operators', async req => { const me = await operator(req); return (await operators()).map(o => ({ ...o, me: o.id === me.userId })); });
  app.post('/ops/operators', async (req, reply) => {
    const op = await operator(req);
    const b = parse(z.object({ name: z.string().trim().min(2).max(80), email: z.email(), password: Password, title: z.string().trim().max(60).default('Platform operator') }), req.body);
    const email = b.email.toLowerCase();
    const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    // someone removed earlier can be added back: their old login is reused with the new password.
    // An email that still signs in to something (a society console, say) is refused.
    const holds = taken ? await db.select({ id: staffRoles.id }).from(staffRoles).where(eq(staffRoles.userId, taken.id)) : [];
    if (taken && holds.length) throw conflict('email_taken', 'That email already has a login.');
    const passwordHash = await hashPassword(b.password);
    const [u] = taken
      ? await db.update(users).set({ name: b.name, passwordHash, totpEnabled: false, totpSecret: null, deletedAt: null }).where(eq(users.id, taken.id)).returning()
      : await db.insert(users).values({ name: b.name, email, passwordHash }).returning();
    await db.insert(staffRoles).values({ userId: u!.id, associationId: null, role: 'operator', title: b.title });
    await log(op.name, `added ${b.name} as a super admin`);
    return reply.status(201).send((await operators()).find(o => o.id === u!.id));
  });
  /** set a new password for another super admin who has lost theirs; they are signed out everywhere */
  app.put('/ops/operators/:id/password', async req => {
    const op = await operator(req);
    const { id } = parse(Id, req.params);
    const { password } = parse(z.object({ password: Password }), req.body);
    const target = (await operators()).find(o => o.id === id);
    if (!target) throw notFound('That super admin');
    await db.update(users).set({ passwordHash: await hashPassword(password), totpEnabled: false, totpSecret: null }).where(eq(users.id, id));
    await db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.userId, id), isNull(refreshTokens.revokedAt)));
    await log(op.name, `reset the password of ${target.name}`);
    return { ok: true };
  });
  app.delete('/ops/operators/:id', async (req, reply) => {
    const op = await operator(req);
    const { id } = parse(Id, req.params);
    const all = await operators(), target = all.find(o => o.id === id);
    if (!target) throw notFound('That super admin');
    if (id === op.userId) throw conflict('not_yourself', 'You can’t remove your own access. Ask another super admin.');
    if (all.length <= 1) throw conflict('last_one', 'This is the only super admin. Add another before removing this one.');
    await db.delete(staffRoles).where(and(eq(staffRoles.userId, id), eq(staffRoles.role, 'operator')));
    await db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.userId, id), isNull(refreshTokens.revokedAt)));
    await log(op.name, `removed ${target.name} as a super admin`);
    return reply.status(204).send();
  });

  /** anyone who signs in with a password changes their own here */
  app.post('/auth/staff/password', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async req => {
    const userId = await uid(req);
    const b = parse(z.object({ current: z.string().min(1), next: Password }), req.body);
    const [u] = await db.select().from(users).where(and(eq(users.id, userId), isNull(users.deletedAt)));
    if (!u?.passwordHash || !(await verifyPassword(b.current, u.passwordHash))) throw forbidden('Your current password isn’t right.');
    if (b.current === b.next) throw badRequest('same_password', 'Choose a password different from the current one.');
    await db.update(users).set({ passwordHash: await hashPassword(b.next) }).where(eq(users.id, userId));
    return { ok: true };
  });

  /* ================= a society: its plan, and writing to Trinize ================= */
  const staff = async (req: FastifyRequest) => {
    const { aid } = parse(Aid, req.params);
    return { aid, s: await staffOf(db, await uid(req), aid, ['admin', 'committee', 'moderator', 'auditor', 'operator']) };
  };
  /** what this society's console may use — read by the console to show or lock its sections */
  app.get('/admin/:aid/plan', async req => {
    const { aid } = await staff(req);
    const [a, c, sub] = await Promise.all([accessOf(db, aid), planConfig(db), db.select({ renewsAt: subscriptions.renewsAt }).from(subscriptions).where(eq(subscriptions.associationId, aid))]);
    return { plan: a.plan, state: a.state, suspended: a.suspended, renewsAt: sub[0]?.renewsAt ?? null, features: a.features, needs: a.needs,
      names: Object.fromEntries((Object.keys(FEATURES) as Feature[]).map(k => [k, FEATURES[k].name])), plans: PLANS.map(p => ({ name: p, ...c.plans[p] })) };
  });

  const ticketOut = (t: typeof supportTickets.$inferSelect) => ({ id: t.id, ref: 'ISS-' + t.number, category: t.category, title: t.title, raisedBy: t.raisedBy, priority: t.priority, status: t.status, assignee: t.assignee, createdAt: t.createdAt, resolvedAt: t.resolvedAt,
    slaState: t.status === 'Resolved' ? 'met' : t.slaDueAt.getTime() < Date.now() ? 'over' : 'ok' });
  const mine = async (aid: string, id: string) => {
    const [t] = await db.select().from(supportTickets).where(and(eq(supportTickets.id, id), eq(supportTickets.associationId, aid)));
    if (!t) throw notFound('That issue');
    return t;
  };
  const thread = async (t: typeof supportTickets.$inferSelect) => ({ ...ticketOut(t), replies: await db.select({ by: ticketReplies.byName, text: ticketReplies.text, at: ticketReplies.createdAt, mine: sql<boolean>`${ticketReplies.byUserId} in (select user_id from staff_roles where association_id = ${t.associationId})` })
    .from(ticketReplies).where(eq(ticketReplies.ticketId, t.id)).orderBy(asc(ticketReplies.createdAt)) });

  app.get('/admin/:aid/support', async req => {
    const { aid } = await staff(req);
    return { categories: CATEGORIES, tickets: (await db.select().from(supportTickets).where(eq(supportTickets.associationId, aid)).orderBy(desc(supportTickets.createdAt)).limit(200)).map(ticketOut) };
  });
  /** the society office writes to Trinize: it lands in the super admin's Support issues, with a response time by priority */
  app.post('/admin/:aid/support', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { aid, s } = await staff(req);
    const b = parse(z.object({ category: z.enum(CATEGORIES), title: z.string().trim().min(5, 'Say in a few words what is wrong').max(140), details: z.string().trim().min(10, 'Describe the problem so we can act on it').max(4000), priority: z.enum(['Low', 'Medium', 'High']).default('Medium') }), req.body);
    const t = await db.transaction(async tx => {
      const [{ next }] = (await tx.select({ next: sql<number>`coalesce(max(${supportTickets.number}), 2000) + 1` }).from(supportTickets)) as [{ next: number }];
      const [row] = await tx.insert(supportTickets).values({ number: next, associationId: aid, category: b.category, title: b.title, raisedBy: s.name, source: `Society office · ${s.title ?? s.role}`, priority: b.priority, slaDueAt: new Date(Date.now() + SLA_HOURS[b.priority] * 3600e3) }).returning();
      await tx.insert(ticketReplies).values({ ticketId: row!.id, byUserId: s.userId, byName: s.name, text: b.details });
      const [soc] = await tx.select({ name: associations.name }).from(associations).where(eq(associations.id, aid));
      await tx.insert(opsActivity).values({ who: s.name, what: `raised ISS-${next} · ${b.title} · ${soc?.name ?? ''}` });
      return row!;
    });
    return reply.status(201).send(await thread(t));
  });
  app.get('/admin/:aid/support/:id', async req => {
    const { aid } = await staff(req);
    return thread(await mine(aid, parse(Aid.extend({ id: z.uuid() }), req.params).id));
  });
  /** add to the conversation; writing on a resolved issue reopens it */
  app.post('/admin/:aid/support/:id/reply', async req => {
    const { aid, s } = await staff(req);
    const t = await mine(aid, parse(Aid.extend({ id: z.uuid() }), req.params).id);
    const { text } = parse(z.object({ text: z.string().trim().min(1).max(4000) }), req.body);
    await db.insert(ticketReplies).values({ ticketId: t.id, byUserId: s.userId, byName: s.name, text });
    const [now] = t.status === 'Resolved' ? await db.update(supportTickets).set({ status: 'In progress', resolvedAt: null }).where(eq(supportTickets.id, t.id)).returning() : [t];
    await log(s.name, `${t.status === 'Resolved' ? 'reopened' : 'replied on'} ISS-${t.number}`);
    return thread(now!);
  });
};
