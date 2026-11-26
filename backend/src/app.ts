import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import rateLimit from '@fastify/rate-limit';
import fstatic from '@fastify/static';
import Fastify from 'fastify';
import type { Config } from './config.js';
import type { DB } from './db/client.js';
import { HttpError } from './lib/http.js';
import { noAi, type Ai } from './lib/ai.js';
import { messengerFrom, type Messenger } from './lib/messenger.js';
import { accessGuard } from './lib/access.js';
import { blockedError, isBlocked, userIdFrom } from './lib/auth.js';
import { planGuard } from './lib/plans.js';
import type { SmsProvider } from './lib/sms.js';
import { accountRoutes } from './routes/account.js';
import { adminRoutes } from './routes/admin.js';
import { admin2Routes } from './routes/admin2.js';
import { assistantRoutes } from './routes/assistant.js';
import { authRoutes } from './routes/auth.js';
import { checkinRoutes } from './routes/checkin.js';
import { communityRoutes } from './routes/community.js';
import { commsRoutes } from './routes/comms.js';
import { copilotRoutes } from './routes/copilot.js';
import { directoryRoutes } from './routes/directory.js';
import { financeRoutes } from './routes/finance.js';
import { gateRoutes } from './routes/gate.js';
import { inspectionRoutes } from './routes/inspections.js';
import { issueRoutes } from './routes/issues.js';
import { maintenanceRoutes } from './routes/maintenance.js';
import { opsRoutes } from './routes/ops.js';
import { ownerRoutes } from './routes/owner.js';
import { platformRoutes } from './routes/platform.js';
import { galleryRoutes } from './routes/gallery.js';
import { residentRoutes } from './routes/resident.js';
import { staffRoutes } from './routes/staff.js';
import { uploadRoutes } from './routes/uploads.js';
import { vpmRoutes } from './routes/vpm.js';
import { aiUsageRoutes } from './routes/aiusage.js';
import { siteVisitRoutes } from './routes/sitevisits.js';
import { emergencyRoutes } from './routes/emergency.js';
import { AiLimitError, AiQuota } from './lib/quota.js';
import { parsePrices, usageSink, withUsageContext } from './lib/usage.js';
import { withBudget } from './lib/budget.js';

export type Deps = { config: Config; db: DB; sms: SmsProvider; ai: Ai; messenger: Messenger; quota: AiQuota };

export async function buildApp(given: Omit<Deps, 'ai' | 'messenger' | 'quota'> & { ai?: Ai; messenger?: Messenger; quota?: AiQuota }) {
  // the AI is held to each society's monthly spending cap (lib/budget.ts)
  const deps: Deps = { ...given, ai: withBudget(given.ai ?? noAi, given.db, parsePrices(given.config.AI_PRICES)), messenger: given.messenger ?? messengerFrom(given.config), quota: given.quota ?? AiQuota.from(given.config) };
  const app = Fastify({
    logger: deps.config.NODE_ENV === 'test' ? false : { level: 'info', redact: ['req.headers.authorization', 'req.body.code', 'req.body.password', 'req.body.refreshToken'] },
    trustProxy: true,
    bodyLimit: 1_000_000,
  });

  const origins = deps.config.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
  // the mobile app sends no Origin; browsers must come from a listed console
  await app.register(cors, { origin: (origin, cb) => cb(null, !origin || origins.includes(origin)), credentials: false,
    // browsers ask before PUT and DELETE; without these the consoles could read but not save
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'] });
  // counted per signed-in person, not per network address: a society office, its Wi-Fi or a mobile network often
  // puts many people behind one address, and one busy console must not lock out the rest. Requests without a
  // valid sign-in (signing in, OTP, the visitor check-in page) are still counted per address.
  await app.register(rateLimit, {
    max: 300, timeWindow: '1 minute',
    keyGenerator: async req => {
      if (!req.headers.authorization) return 'ip:' + req.ip;
      try { return 'user:' + (await userIdFrom(req, deps.config.JWT_SECRET)); } catch { return 'ip:' + req.ip; }
    },
  });
  await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
  // live gate updates; the sockets only ever receive a line or two from a client
  await app.register(websocket, { options: { maxPayload: 4096 } });

  const uploadDir = resolve(deps.config.UPLOAD_DIR);
  mkdirSync(uploadDir, { recursive: true });
  await app.register(fstatic, { root: uploadDir, prefix: '/files/', decorateReply: false });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AiLimitError) {
      reply.header('retry-after', String(err.retryAfter));
      return reply.status(429).send({ error: { code: err.code, message: err.message, retryAfter: err.retryAfter, scope: err.scope } });
    }
    if (err instanceof HttpError) return reply.status(err.status).send({ error: { code: err.code, message: err.message } });
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429) return reply.status(429).send({ error: { code: 'rate_limited', message: 'Too many requests — try again in a minute.' } });
    if (status && status < 500) return reply.status(status).send({ error: { code: 'bad_request', message: (err as Error).message } });
    req.log.error(err);
    return reply.status(500).send({ error: { code: 'server_error', message: 'Something went wrong on our side.' } });
  });

  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('cross-origin-resource-policy', 'cross-origin'); // uploaded photos are shown by the apps
    if (deps.config.NODE_ENV === 'production') reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
  });

  // a society is held to its plan before any of its console's routes run
  // each request gets its own record of whose it is, so the AI tokens it uses are counted against the right person and society
  app.addHook('onRequest', (_req, _reply, done) => withUsageContext(() => done()));
  deps.ai.setUsageSink?.(usageSink(deps.db));
  app.addHook('onRequest', planGuard(deps.db));
  // and each person on its team to the sections they were given
  app.addHook('onRequest', accessGuard(deps.db, deps.config.JWT_SECRET));

  /*
   * A resident the office has blocked is out of the whole app at once — every screen, not only the ones that
   * happen to look up their flat: the owner portal, notifications, the directory and uploads included.
   * The consoles (/admin, /ops), the guard's post, sign-in itself and the visitor's public pages are not the
   * resident app, and are left to their own rules.
   */
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/v1/') || /^\/v1\/(auth|admin|ops|gate|checkin|checkin-status)(\/|\?|$)/.test(req.url) || !req.headers.authorization) return;
    let userId: string;
    try { userId = await userIdFrom(req, deps.config.JWT_SECRET); } catch { return; } // not signed in: the route answers 401
    if (await isBlocked(deps.db, userId)) { const e = blockedError(); return reply.status(e.status).send({ error: { code: e.code, message: e.message } }); }
  });

  app.get('/health', async () => ({ ok: true }));
  await app.register(authRoutes(deps), { prefix: '/v1/auth' });
  await app.register(residentRoutes(deps), { prefix: '/v1' });
  await app.register(maintenanceRoutes(deps), { prefix: '/v1' }); // before /v1/issues/:ref so /issues/common isn't read as a ticket number
  await app.register(issueRoutes(deps), { prefix: '/v1/issues' });
  await app.register(uploadRoutes(deps), { prefix: '/v1/uploads' });
  await app.register(communityRoutes(deps), { prefix: '/v1' });
  await app.register(accountRoutes(deps), { prefix: '/v1' });
  await app.register(adminRoutes(deps), { prefix: '/v1/admin' });
  await app.register(admin2Routes(deps), { prefix: '/v1/admin' });
  await app.register(assistantRoutes(deps), { prefix: '/v1' });
  await app.register(opsRoutes(deps), { prefix: '/v1/ops' });
  await app.register(vpmRoutes(deps), { prefix: '/v1' });
  await app.register(siteVisitRoutes(deps), { prefix: '/v1' });
  await app.register(aiUsageRoutes(deps), { prefix: '/v1' });
  await app.register(gateRoutes(deps), { prefix: '/v1' });
  await app.register(checkinRoutes(deps)); // the visitor's own page and its API: /visit/:token, /v1/checkin/*
  await app.register(commsRoutes(deps), { prefix: '/v1' });
  await app.register(financeRoutes(deps), { prefix: '/v1' });
  await app.register(ownerRoutes(deps), { prefix: '/v1' });
  await app.register(emergencyRoutes(deps), { prefix: '/v1' });
  await app.register(inspectionRoutes(deps), { prefix: '/v1' });
  await app.register(copilotRoutes(deps), { prefix: '/v1' });
  await app.register(platformRoutes(deps), { prefix: '/v1' });
  await app.register(galleryRoutes(deps), { prefix: '/v1' });
  await app.register(staffRoutes(deps), { prefix: '/v1' });
  await app.register(directoryRoutes(deps), { prefix: '/v1' });
  return app;
}
