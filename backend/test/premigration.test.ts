import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO } from '../src/db/seed.js';
import { testApp } from './helpers.js';

/* The backend reloads new code before anyone runs the migrations. On a database without 0019–0024 the
   apps must still sign in and work — the new features are simply off until the migration runs. */

let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => {
  t = await testApp();
  const client = (t.db as unknown as { $client: { exec(q: string): Promise<unknown> } }).$client;
  await client.exec(`DROP TABLE IF EXISTS site_visit_items, site_visits, site_visit_plans, staff_notes, ai_usage, ai_answer_cache, staff_presence, ai_budgets, primary_vpms CASCADE;
    ALTER TABLE associations DROP COLUMN IF EXISTS primary_vpm_id;`);
});
afterAll(() => t.close());

describe('before the new migrations have run', () => {
  it('still signs in residents, property managers and the office, and serves their screens', async () => {
    const resident = (await t.signIn(DEMO.residentPhone)).accessToken;
    const vpm = (await t.signIn(DEMO.vpmPhone)).accessToken;
    const admin = (await t.staffIn()).accessToken;
    const op = (await t.staffIn(DEMO.operatorEmail, DEMO.operatorPassword)).accessToken;
    const status = async (url: string, token: string) => (await t.call('GET', url, { token })).status;

    expect(await status('/v1/me', resident)).toBe(200);
    expect(await status('/v1/vpm/me', vpm)).toBe(200);
    expect(await status(`/v1/admin/${t.associationId}/issues`, vpm)).toBe(200);
    expect(await status(`/v1/admin/${t.associationId}/issues`, admin)).toBe(200);
    expect(await status('/v1/ops/vpms', op)).toBe(200);
    // the property manager's card: shown as long as the manager can be found, whatever the new tables hold
    const m = await t.call('GET', '/v1/manager', { token: resident });
    expect(m.status).toBe(200);
    expect(m.body).toMatchObject({ manager: { name: 'Imran Qureshi', online: false }, next: null, visits: [] });
    // the Community Assistant still answers
    expect((await t.call('POST', '/v1/assistant/chat', { token: resident, body: { text: 'What are the pool timings?' } })).status).toBe(200);
  });
});
