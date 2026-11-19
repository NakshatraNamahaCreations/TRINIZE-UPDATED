import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { jwtVerify, SignJWT } from 'jose';
import type { DB } from '../db/client.js';
import { refreshTokens, staffRoles, standings, unitMembers, units, users, type StaffRole } from '../db/schema.js';
import { opaqueToken, sha256 } from './crypto.js';
import { forbidden, HttpError, unauthorized } from './http.js';

const ACCESS_TTL = '15m';
const REFRESH_DAYS = 30;

/* ---------- tokens ---------- */
export async function signAccess(secret: string, userId: string) {
  return new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(userId).setIssuedAt().setExpirationTime(ACCESS_TTL)
    .setIssuer('trinize').sign(new TextEncoder().encode(secret));
}

/** Refresh tokens are random, stored only as a hash, and rotated on every use. */
export async function issueRefresh(db: DB, userId: string) {
  const token = opaqueToken();
  await db.insert(refreshTokens).values({ userId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + REFRESH_DAYS * 864e5) });
  return token;
}

export async function issueSession(db: DB, secret: string, userId: string) {
  return { accessToken: await signAccess(secret, userId), refreshToken: await issueRefresh(db, userId), expiresIn: 15 * 60 };
}

/**
 * Exchange a refresh token for a new pair. Presenting a token that was already used means it was
 * copied — every session for that user is revoked.
 */
export async function rotateRefresh(db: DB, secret: string, token: string) {
  const [row] = await db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, sha256(token)));
  if (!row) throw unauthorized();
  if (row.revokedAt) {
    await db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.userId, row.userId), isNull(refreshTokens.revokedAt)));
    throw unauthorized('This sign-in was used somewhere else. Sign in again.');
  }
  if (row.expiresAt.getTime() < Date.now()) throw unauthorized();
  await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, row.id));
  return issueSession(db, secret, row.userId);
}

/* ---------- who is calling ---------- */
export async function userIdFrom(req: FastifyRequest, secret: string): Promise<string> {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) throw unauthorized();
  try {
    const { payload } = await jwtVerify(h.slice(7), new TextEncoder().encode(secret), { issuer: 'trinize' });
    if (!payload.sub) throw new Error('no subject');
    return payload.sub;
  } catch {
    throw unauthorized();
  }
}

export type Resident = { userId: string; name: string; unitId: string; unitCode: string; unitLabel: string; associationId: string; role: 'Owner' | 'Tenant' | 'Family' };

/* ---------- blocked by the office ---------- */
const BLOCKED_MESSAGE = 'Your account has been blocked by the society office. Contact them to restore access.';
export const blockedError = () => new HttpError(403, 'account_blocked', BLOCKED_MESSAGE);
/** a short memory per database, so every request does not ask the same question; cleared the moment someone's standing changes */
const blockedMemory = new WeakMap<object, Map<string, { at: number; blocked: boolean }>>();
export const forgetBlocked = (db: object, userId: string) => { blockedMemory.get(db)?.delete(userId); };
/** has a society office blocked this person from the app? */
export async function isBlocked(db: DB, userId: string) {
  const mem = blockedMemory.get(db) ?? blockedMemory.set(db, new Map()).get(db)!;
  const hit = mem.get(userId);
  if (hit && Date.now() - hit.at < 5000) return hit.blocked;
  const [s] = await db.select({ userId: standings.userId }).from(standings).where(and(eq(standings.userId, userId), eq(standings.status, 'Blocked'))).limit(1);
  mem.set(userId, { at: Date.now(), blocked: !!s });
  return !!s;
}

/** The caller's active home. A resident with no verified unit can't use community features yet. */
export async function residentOf(db: DB, userId: string): Promise<Resident> {
  const [m] = await db
    .select({ userId: users.id, name: users.name, unitId: units.id, unitCode: units.code, unitLabel: units.label, associationId: units.associationId, role: unitMembers.role, standing: standings.status })
    .from(unitMembers)
    .innerJoin(units, eq(units.id, unitMembers.unitId))
    .innerJoin(users, eq(users.id, unitMembers.userId))
    .leftJoin(standings, and(eq(standings.userId, users.id), eq(standings.associationId, units.associationId)))
    .where(and(eq(unitMembers.userId, userId), eq(unitMembers.status, 'active'), isNull(users.deletedAt)))
    .limit(1);
  if (!m) throw forbidden('Your number isn’t linked to a verified flat yet. Contact your society office.');
  // blocked by the office: nothing a resident can do in the app works until they are unblocked
  if (m.standing === 'Blocked') throw blockedError();
  const { standing: _s, ...resident } = m;
  return resident;
}

export type Staff = { userId: string; name: string; role: StaffRole; associationId: string | null; title: string | null };

/** Staff access to one association (operators reach all of them). */
export async function staffOf(db: DB, userId: string, associationId: string | null, allowed: StaffRole[]): Promise<Staff> {
  const rows = await db
    .select({ userId: users.id, name: users.name, role: staffRoles.role, associationId: staffRoles.associationId, title: staffRoles.title })
    .from(staffRoles).innerJoin(users, eq(users.id, staffRoles.userId))
    .where(and(eq(staffRoles.userId, userId), isNull(users.deletedAt)));
  // a VPM does the society admin's job in the societies assigned to them — and nowhere else
  const can = (role: StaffRole) => allowed.includes(role) || (role === 'vpm' && allowed.includes('admin'));
  const hit = rows.find(r => can(r.role) && (r.role === 'operator' || (associationId !== null && r.associationId === associationId)));
  if (!hit) throw forbidden();
  return hit;
}

/** first association a staff member administers — what the Society Admin console opens */
export async function staffHome(db: DB, userId: string) {
  const [r] = await db.select({ associationId: staffRoles.associationId, role: staffRoles.role }).from(staffRoles)
    .where(eq(staffRoles.userId, userId)).limit(1);
  return r ?? null;
}

