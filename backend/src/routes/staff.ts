import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../app.js';
import { associations, refreshTokens, staffRoles, users, type StaffRole } from '../db/schema.js';
import { forgetAccess, SECTION_KEYS, SECTIONS, sectionsOf, type Section } from '../lib/access.js';
import { audit } from '../lib/audit.js';
import { staffOf, userIdFrom } from '../lib/auth.js';
import { hashPassword } from '../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound, parse } from '../lib/http.js';

const Aid = z.object({ aid: z.uuid() });
const AidId = Aid.extend({ id: z.uuid() });
const Password = z.string().min(8, 'A password needs at least 8 characters').max(100);
const Access = { full: z.boolean(), permissions: z.array(z.enum(SECTION_KEYS)).max(SECTION_KEYS.length).default([]) };
/** the people who sign in to the console; guards and property managers are looked after on their own pages */
const TEAM: StaffRole[] = ['admin', 'committee', 'moderator', 'auditor'];

/**
 * The society's own team: who can sign in to its console, and which sections each of them may use.
 *   GET    /v1/admin/:aid/staff/me            what the caller may use (the console draws its menu from this)
 *   GET    /v1/admin/:aid/staff               the team                       — full admins only, as is everything below
 *   POST   /v1/admin/:aid/staff               add someone
 *   PUT    /v1/admin/:aid/staff/:id           change their name, title or access
 *   PUT    /v1/admin/:aid/staff/:id/password  set a new password; they are signed out everywhere
 *   DELETE /v1/admin/:aid/staff/:id           take their access away
 */
export const staffRoutes = ({ config, db }: Deps): FastifyPluginAsync => async app => {
  const uid = (req: FastifyRequest) => userIdFrom(req, config.JWT_SECRET);

  app.get('/admin/:aid/staff/me', async req => {
    const { aid } = parse(Aid, req.params);
    const s = await staffOf(db, await uid(req), aid, ['admin', 'committee', 'moderator', 'auditor', 'operator']);
    const mine = await sectionsOf(db, s.userId, aid);
    const [a] = await db.select({ name: associations.name, short: associations.short, city: associations.city }).from(associations).where(eq(associations.id, aid));
    return { role: s.role, title: s.title, full: mine === null && s.role !== 'committee' && s.role !== 'moderator' && s.role !== 'auditor', permissions: mine ?? SECTION_KEYS, sections: SECTIONS,
      // the console names the society it is running — never a built-in one
      society: { name: a?.name ?? '', short: a?.short ?? '', city: a?.city ?? '' } };
  });

  /** only someone with the whole console may decide who else gets in */
  const manager = async (req: FastifyRequest) => {
    const { aid } = parse(Aid, req.params);
    const s = await staffOf(db, await uid(req), aid, ['admin', 'operator']);
    if ((await sectionsOf(db, s.userId, aid)) !== null) throw forbidden('Only a society admin with full access can manage the team.');
    return { aid, s };
  };

  const team = async (aid: string, me: string) => (await db
    .select({ id: staffRoles.id, userId: users.id, name: users.name, email: users.email, phone: users.phone, role: staffRoles.role, title: staffRoles.title, permissions: staffRoles.permissions, twoStep: users.totpEnabled, since: users.createdAt })
    .from(staffRoles).innerJoin(users, eq(users.id, staffRoles.userId))
    .where(and(eq(staffRoles.associationId, aid), inArray(staffRoles.role, TEAM), isNull(users.deletedAt))).orderBy(asc(users.name)))
    .map(r => ({
      ...r, you: r.userId === me,
      // full = the admin; limited = a chosen list of sections; role = an older built-in role (committee, moderator, auditor) with no list yet
      access: r.permissions !== null ? 'limited' as const : r.role === 'admin' ? 'full' as const : 'role' as const,
      permissions: r.permissions ?? (r.role === 'admin' ? [...SECTION_KEYS] : []),
    }));
  const fullAdmins = async (aid: string) => (await db.select({ id: staffRoles.id }).from(staffRoles)
    .where(and(eq(staffRoles.associationId, aid), eq(staffRoles.role, 'admin'), isNull(staffRoles.permissions)))).length;
  const one = async (aid: string, id: string, me: string) => {
    const hit = (await team(aid, me)).find(x => x.id === id);
    if (!hit) throw notFound('That team member');
    return hit;
  };
  const chosen = (b: { full: boolean; permissions: Section[] }) => {
    if (b.full) return null;
    if (!b.permissions.length) throw badRequest('no_sections', 'Choose at least one section this person may use, or give them full access.');
    return [...new Set(b.permissions)];
  };
  const names = (keys: string[] | null) => keys === null ? 'full access' : keys.map(k => SECTIONS.find(s => s.key === k)?.name ?? k).join(', ');
  const signOutEverywhere = (userId: string) => db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));

  app.get('/admin/:aid/staff', async req => { const { aid, s } = await manager(req); return team(aid, s.userId); });

  app.post('/admin/:aid/staff', async (req, reply) => {
    const { aid, s } = await manager(req);
    const b = parse(z.object({ name: z.string().trim().min(2).max(80), email: z.email(), password: Password, title: z.string().trim().max(60).default(''), ...Access }), req.body);
    const permissions = chosen(b), email = b.email.toLowerCase();
    const [taken] = await db.select().from(users).where(eq(users.email, email));
    // an email that already signs in to a console (this one or another) is refused; a resident's own email, or someone removed earlier, is given a console login
    const holds = taken ? await db.select({ id: staffRoles.id }).from(staffRoles).where(eq(staffRoles.userId, taken.id)) : [];
    if (taken && holds.length) throw conflict('email_taken', 'That email already has a console login. Use a different one.');
    const passwordHash = await hashPassword(b.password);
    const [u] = taken
      ? await db.update(users).set({ name: taken.phone ? taken.name : b.name, passwordHash, totpEnabled: false, totpSecret: null, deletedAt: null }).where(eq(users.id, taken.id)).returning()
      : await db.insert(users).values({ name: b.name, email, passwordHash }).returning();
    const [row] = await db.insert(staffRoles).values({ userId: u!.id, associationId: aid, role: 'admin', title: b.title || null, permissions }).returning();
    forgetAccess(db);
    await audit(db, aid, s.userId, s.name, `added ${u!.name} to the team · ${names(permissions)}`);
    return reply.status(201).send(await one(aid, row!.id, s.userId));
  });

  app.put('/admin/:aid/staff/:id', async req => {
    const { aid, s } = await manager(req);
    const { id } = parse(AidId, req.params);
    const b = parse(z.object({ name: z.string().trim().min(2).max(80), title: z.string().trim().max(60).default(''), ...Access }), req.body);
    const cur = await one(aid, id, s.userId), permissions = chosen(b);
    const same = cur.access === (permissions === null ? 'full' : 'limited') && [...cur.permissions].sort().join() === [...(permissions ?? SECTION_KEYS)].sort().join();
    if (!same) {
      if (cur.you) throw conflict('not_yourself', 'You can’t change your own access. Ask another admin with full access.');
      if (cur.access === 'full' && (await fullAdmins(aid)) <= 1) throw conflict('last_one', 'This is the only admin with full access. Give someone else full access first.');
    }
    await db.update(users).set({ name: b.name }).where(eq(users.id, cur.userId));
    // anyone managed here works as the office inside their sections — the list is what holds them back
    await db.update(staffRoles).set({ title: b.title || null, ...(same ? {} : { role: 'admin' as const, permissions }) }).where(eq(staffRoles.id, id));
    forgetAccess(db);
    await audit(db, aid, s.userId, s.name, same ? `updated ${b.name}’s details on the team` : `changed ${b.name}’s access · ${names(permissions)}`);
    return one(aid, id, s.userId);
  });

  app.put('/admin/:aid/staff/:id/password', async req => {
    const { aid, s } = await manager(req);
    const { id } = parse(AidId, req.params);
    const { password } = parse(z.object({ password: Password }), req.body);
    const cur = await one(aid, id, s.userId);
    await db.update(users).set({ passwordHash: await hashPassword(password), totpEnabled: false, totpSecret: null }).where(eq(users.id, cur.userId));
    if (!cur.you) await signOutEverywhere(cur.userId);
    await audit(db, aid, s.userId, s.name, `reset the console password of ${cur.name}`);
    return { ok: true };
  });

  app.delete('/admin/:aid/staff/:id', async (req, reply) => {
    const { aid, s } = await manager(req);
    const { id } = parse(AidId, req.params);
    const cur = await one(aid, id, s.userId);
    if (cur.you) throw conflict('not_yourself', 'You can’t remove your own access. Ask another admin with full access.');
    if (cur.access === 'full' && (await fullAdmins(aid)) <= 1) throw conflict('last_one', 'This is the only admin with full access. Give someone else full access first.');
    await db.delete(staffRoles).where(eq(staffRoles.id, id));
    await signOutEverywhere(cur.userId);
    forgetAccess(db);
    await audit(db, aid, s.userId, s.name, `removed ${cur.name} from the team`);
    return reply.status(204).send();
  });
};
