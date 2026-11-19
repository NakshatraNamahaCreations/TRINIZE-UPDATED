import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { openDb } from '../src/db/client.js';
import { DEMO, seed } from '../src/db/seed.js';
import type { Ai } from '../src/lib/ai.js';
import { MemoryMessenger } from '../src/lib/messenger.js';
import { MemorySms } from '../src/lib/sms.js';

/** A fresh API on an in-memory Postgres, migrated and seeded with the demo society. */
export async function testApp(opts: { ai?: Ai } = {}) {
  const config = loadConfig({ NODE_ENV: 'test', JWT_SECRET: 'test-secret-test-secret-test-secret-123', SMS_PROVIDER: 'memory', PAYMENTS: 'mock', UPLOAD_DIR: 'uploads-test', PUBLIC_URL: 'http://api.test' });
  const h = await openDb('pglite', { migrate: true });
  const seeded = await seed(h.db);
  const { associationId } = seeded;
  const sms = new MemorySms();
  const messenger = new MemoryMessenger();
  const app = await buildApp({ config, db: h.db, sms, ai: opts.ai, messenger });

  const call = async (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, opts: { token?: string; body?: unknown } = {}) => {
    const res = await app.inject({ method, url, headers: opts.token ? { authorization: 'Bearer ' + opts.token } : {}, payload: opts.body as never });
    return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
  };

  /** the full OTP sign-in, returning the session — once per number, since codes can't be re-sent within 30 s */
  const sessions = new Map<string, { accessToken: string; refreshToken: string }>();
  const signIn = async (phone = DEMO.residentPhone) => {
    const known = sessions.get(phone);
    if (known) return known;
    const s = await freshSignIn(phone);
    sessions.set(phone, s);
    return s;
  };
  const freshSignIn = async (phone: string) => {
    const r1 = await call('POST', '/v1/auth/otp/request', { body: { phone } });
    if (r1.status !== 200) throw new Error('otp request ' + JSON.stringify(r1.body));
    const r2 = await call('POST', '/v1/auth/otp/verify', { body: { phone, code: sms.last(phone) } });
    if (r2.status !== 200) throw new Error('otp verify ' + JSON.stringify(r2.body));
    return r2.body as { accessToken: string; refreshToken: string };
  };

  const staffIn = async (email = DEMO.adminEmail, password = DEMO.adminPassword) =>
    (await call('POST', '/v1/auth/staff/login', { body: { email, password } })).body as { accessToken: string };

  return { app, db: h.db, sms, messenger, call, signIn, staffIn, ...seeded, close: async () => { await app.close(); await h.close(); } };
}
