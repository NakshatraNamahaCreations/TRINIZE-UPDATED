import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from './helpers.js';

// QA N-03: the Society Admin "Community hub" showed "Couldn't load · Something went wrong"
let t: Awaited<ReturnType<typeof testApp>>;
beforeAll(async () => { t = await testApp(); });
afterAll(async () => { await t.close(); });

describe('the community hub', () => {
  it('loads for the society office', async () => {
    const admin = (await t.staffIn()).accessToken;
    const r = await t.call('GET', `/v1/admin/${t.associationId}/community-insights`, { token: admin });
    if (r.status !== 200) console.error(r.body);
    expect(r.status).toBe(200);
  });
});
