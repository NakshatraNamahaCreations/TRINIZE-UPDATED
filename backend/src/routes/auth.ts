import { and, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../app.js';
import { otpCodes, refreshTokens, staffRoles, unitMembers, units, users, vendors } from '../db/schema.js';
import { jwtVerify, SignJWT } from 'jose';
import { blockedError, isBlocked, issueSession, rotateRefresh, userIdFrom } from '../lib/auth.js';
import { newSecret, otpauthUrl, verifyCode } from '../lib/totp.js';
import { hashOtp, safeEqual, sha256, sixDigits, verifyPassword } from '../lib/crypto.js';
import { badRequest, HttpError, notFound, parse, unauthorized } from '../lib/http.js';

const Phone = z.string().regex(/^[6-9]\d{9}$/, 'Mobile numbers have 10 digits and start with 6, 7, 8 or 9');
const OTP_TTL_S = 300;
const RESEND_S = 30;
const MAX_PER_HOUR = 5;
const MAX_ATTEMPTS = 5;

export const authRoutes = ({ config, db, sms }: Deps): FastifyPluginAsync => async app => {
  const key = new TextEncoder().encode(config.JWT_SECRET);

  /**
   * A number may sign in to the app only while it belongs somewhere: a verified home, a guard's post,
   * a property manager's societies, or a vendor's work orders. A number that was removed from its flat,
   * or was never added to one, is told so here — it is never let in to an app with nothing in it.
   */
  const NOT_REGISTERED = 'This number isn’t registered with a society. Ask your society office to add it to your flat.';
  const mayUseApp = async (phone: string) => {
    const [user] = await db.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.phone, phone), isNull(users.deletedAt)));
    if (!user) throw new HttpError(404, 'not_registered', NOT_REGISTERED);
    const homes = await db.select({ status: unitMembers.status, code: units.code }).from(unitMembers).innerJoin(units, eq(units.id, unitMembers.unitId)).where(eq(unitMembers.userId, user.id));
    if (homes.some(h => h.status === 'active')) return user;
    const [post] = await db.select({ id: staffRoles.id }).from(staffRoles).where(and(eq(staffRoles.userId, user.id), inArray(staffRoles.role, ['guard', 'vpm']))).limit(1);
    if (post) return user;
    const [trade] = await db.select({ id: vendors.id }).from(vendors).where(eq(vendors.userId, user.id)).limit(1);
    if (trade) return user;
    // added by the flat's owner, but the office has not confirmed them yet
    if (homes.length) throw new HttpError(403, 'awaiting_verification', `Your number has been added to ${homes[0]!.code} and is waiting for the society office to verify it. You can sign in once they do.`);
    throw new HttpError(404, 'not_registered', NOT_REGISTERED);
  };
  /** Step 1: text a code to a number registered with a society. */
  app.post('/otp/request', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async req => {
    const { phone } = parse(z.object({ phone: Phone }), req.body);
    // codes cost money and could be used to spam — only a number that can actually use the app gets one
    await mayUseApp(phone);

    const hourAgo = new Date(Date.now() - 3600e3);
    const recent = await db.select({ createdAt: otpCodes.createdAt }).from(otpCodes)
      .where(and(eq(otpCodes.phone, phone), gt(otpCodes.createdAt, hourAgo))).orderBy(desc(otpCodes.createdAt));
    const wait = recent[0] ? RESEND_S - Math.floor((Date.now() - recent[0].createdAt.getTime()) / 1000) : 0;
    if (wait > 0) throw new HttpError(429, 'resend_wait', `Wait ${wait} seconds before asking for a new code.`);
    if (recent.length >= MAX_PER_HOUR) throw new HttpError(429, 'too_many_codes', 'Too many codes requested. Try again in an hour.');

    const code = config.fixedOtp ?? sixDigits();
    await db.insert(otpCodes).values({ phone, codeHash: hashOtp(config.JWT_SECRET, phone, code), expiresAt: new Date(Date.now() + OTP_TTL_S * 1000) });
    await sms.sendOtp(phone, code);
    return { sent: true, expiresIn: OTP_TTL_S, resendIn: RESEND_S };
  });

  /** Step 2: check the code and start a session. */
  app.post('/otp/verify', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async req => {
    const { phone, code } = parse(z.object({ phone: Phone, code: z.string().regex(/^\d{6}$/, 'The code has 6 digits') }), req.body);
    const [otp] = await db.select().from(otpCodes)
      .where(and(eq(otpCodes.phone, phone), isNull(otpCodes.consumedAt))).orderBy(desc(otpCodes.createdAt)).limit(1);
    if (!otp || otp.expiresAt.getTime() < Date.now()) throw badRequest('code_expired', 'That code has expired. Ask for a new one.');
    if (otp.attempts >= MAX_ATTEMPTS) throw new HttpError(429, 'too_many_attempts', 'Too many wrong tries. Ask for a new code.');
    if (!safeEqual(otp.codeHash, hashOtp(config.JWT_SECRET, phone, code))) {
      await db.update(otpCodes).set({ attempts: sql`${otpCodes.attempts} + 1` }).where(eq(otpCodes.id, otp.id));
      const left = MAX_ATTEMPTS - otp.attempts - 1;
      throw badRequest('wrong_code', left > 0 ? `That code isn’t right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'That code isn’t right. Ask for a new one.');
    }
    await db.update(otpCodes).set({ consumedAt: new Date() }).where(eq(otpCodes.id, otp.id));
    // checked again: the office may have removed them between the code being sent and typed in
    const user = await mayUseApp(phone);
    // a blocked resident is told so here, rather than signing in to an app where nothing opens
    if (await isBlocked(db, user.id)) throw blockedError();
    return { ...(await issueSession(db, config.JWT_SECRET, user.id)), user };
  });

  app.post('/refresh', async req => {
    const { refreshToken } = parse(z.object({ refreshToken: z.string().min(20) }), req.body);
    return rotateRefresh(db, config.JWT_SECRET, refreshToken);
  });

  /** Sign out this device. Idempotent. */
  app.post('/logout', async (req, reply) => {
    const { refreshToken } = parse(z.object({ refreshToken: z.string().min(20) }), req.body);
    await db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.tokenHash, sha256(refreshToken)), isNull(refreshTokens.revokedAt)));
    return reply.status(204).send();
  });

  /** Society Admin / Owner Portal sign-in. (2FA is planned for launch hardening.) */
  app.post('/staff/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async req => {
    const { email, password } = parse(z.object({ email: z.email(), password: z.string().min(1) }), req.body);
    const [user] = await db.select().from(users).where(and(eq(users.email, email.toLowerCase()), isNull(users.deletedAt)));
    if (!user || !(await verifyPassword(password, user.passwordHash))) throw unauthorized('Email or password is incorrect.');
    const roles = await db.select({ role: staffRoles.role, associationId: staffRoles.associationId, title: staffRoles.title }).from(staffRoles).where(eq(staffRoles.userId, user.id));
    if (!roles.length) throw unauthorized('Email or password is incorrect.');
    if (user.totpEnabled) {
      // password was right; a short-lived ticket lets them finish with the authenticator code
      const mfaToken = await new SignJWT({ mfa: true }).setProtectedHeader({ alg: 'HS256' }).setSubject(user.id).setIssuer('trinize-mfa').setExpirationTime('5m').sign(key);
      return { mfaRequired: true, mfaToken };
    }
    return { ...(await issueSession(db, config.JWT_SECRET, user.id)), user: { id: user.id, name: user.name, email: user.email }, roles };
  });

  /** second step: the 6-digit code from the authenticator app */
  app.post('/staff/mfa', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async req => {
    const { mfaToken, code } = parse(z.object({ mfaToken: z.string().min(20), code: z.string().regex(/^\d{6}$/) }), req.body);
    let userId: string;
    try {
      const { payload } = await jwtVerify(mfaToken, key, { issuer: 'trinize-mfa' });
      userId = payload.sub!;
    } catch {
      throw unauthorized('That sign-in attempt expired. Start again.');
    }
    const [user] = await db.select().from(users).where(and(eq(users.id, userId), isNull(users.deletedAt)));
    if (!user?.totpSecret || !user.totpEnabled || !verifyCode(user.totpSecret, code)) throw unauthorized('That code isn’t right.');
    const roles = await db.select({ role: staffRoles.role, associationId: staffRoles.associationId, title: staffRoles.title }).from(staffRoles).where(eq(staffRoles.userId, user.id));
    return { ...(await issueSession(db, config.JWT_SECRET, user.id)), user: { id: user.id, name: user.name, email: user.email }, roles };
  });

  /** turn on two-step sign-in: get a secret to scan, then confirm it with a code */
  app.post('/staff/2fa/setup', async req => {
    const userId = await userIdFrom(req, config.JWT_SECRET);
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user?.email) throw unauthorized();
    if (user.totpEnabled) throw badRequest('already_enabled', 'Two-step sign-in is already on.');
    const secret = newSecret();
    await db.update(users).set({ totpSecret: secret }).where(eq(users.id, userId));
    return { secret, otpauthUrl: otpauthUrl(secret, user.email) };
  });
  app.post('/staff/2fa/enable', async req => {
    const userId = await userIdFrom(req, config.JWT_SECRET);
    const { code } = parse(z.object({ code: z.string().regex(/^\d{6}$/) }), req.body);
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user?.totpSecret) throw badRequest('not_set_up', 'Start the setup first.');
    if (!verifyCode(user.totpSecret, code)) throw badRequest('wrong_code', 'That code isn’t right. Check the time on your phone and try again.');
    await db.update(users).set({ totpEnabled: true }).where(eq(users.id, userId));
    return { enabled: true };
  });

  app.get('/staff/me', async req => {
    const userId = await userIdFrom(req, config.JWT_SECRET);
    const [user] = await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, userId));
    const roles = await db.select({ role: staffRoles.role, associationId: staffRoles.associationId, title: staffRoles.title }).from(staffRoles).where(eq(staffRoles.userId, userId));
    if (!user || !roles.length) throw unauthorized();
    return { user, roles };
  });
};
