import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aiUsage, users } from '../src/db/schema.js';
import { DEMO } from '../src/db/seed.js';
import { OpenAiProvider, type Ai } from '../src/lib/ai.js';
import type { Usage } from '../src/lib/usage.js';
import type { UsageSink } from '../src/lib/usage.js';
import { testApp } from './helpers.js';

/** A stand-in model: counts calls, keeps what it was shown, and reports tokens through the same sink the real client uses. */
const seen: { q: string; titles: string[]; history: number }[] = [];
let moderated = 0;
let sink: UsageSink | null = null;
const fake: Ai = {
  enabled: true,
  moderate: async () => { moderated++; return { level: 'safe', words: [] }; },
  answer: async (q, ctx) => {
    seen.push({ q, titles: ctx.docs.map(d => d.title), history: ctx.history.length });
    // a little wait, so two requests at once really do overlap
    await new Promise(r => setTimeout(r, 15 + Math.random() * 25));
    await sink?.({ feature: 'answer', model: 'test-model', inputTokens: 100, cachedInputTokens: 20, outputTokens: 10 });
    const pool = ctx.docs.find(d => /pool/i.test(d.title + d.body));
    return pool ? { text: 'Answer to: ' + q, sources: [pool.title] } : { text: 'Not in the documents.', sources: [] };
  },
  rewrite: async () => null, compose: async () => null, extract: async () => null,
  setUsageSink: s => { sink = s; },
};

let t: Awaited<ReturnType<typeof testApp>>;
let ananya: string, rohit: string, admin: string, op: string;
beforeAll(async () => {
  t = await testApp({ ai: fake, env: { AI_MODEL: 'test-model', AI_MODEL_FAST: 'test-model', AI_PRICES: JSON.stringify({ 'test-model': { input: 1, cachedInput: 0.5, output: 2 } }) } });
  ananya = (await t.signIn(DEMO.residentPhone)).accessToken;
  rohit = (await t.signIn('9900112233')).accessToken;
  admin = (await t.staffIn()).accessToken;
  op = (await t.staffIn(DEMO.operatorEmail, DEMO.operatorPassword)).accessToken;
});
afterAll(() => t.close());

const ask = async (token: string, text: string) => {
  const r = await t.call('POST', '/v1/assistant/chat', { token, body: { text } });
  expect(r.status).toBe(200);
  return r.body as { text: string; source: string | null };
};

describe('stored answers', () => {
  it('writes a shared question once, and gives the next resident the same answer without a model call', async () => {
    const before = seen.length;
    const a = await ask(ananya, 'What are the pool timings?');
    expect(seen.length).toBe(before + 1);
    // what the model saw for a shareable question: no personal records, no chat history
    const call = seen.at(-1)!;
    expect(call.titles.some(x => x.startsWith('Your '))).toBe(false);
    expect(call.history).toBe(0);

    const b = await ask(rohit, 'what are the   POOL timings?');
    expect(seen.length).toBe(before + 1);
    expect(b.text).toBe(a.text);
    expect(b.source).toBe(a.source);
  });

  it('asks the model again once the society’s information changes', async () => {
    const before = seen.length;
    const doc = await t.call('POST', `/v1/admin/${t.associationId}/knowledge`, { token: admin, body: { title: 'Pool deck repairs', section: '', body: 'The pool deck is being retiled; the shallow end is closed until further notice.' } });
    expect(doc.status).toBe(201);
    await ask(rohit, 'What are the pool timings?');
    expect(seen.length).toBe(before + 1);
  });

  it('never stores a question about the resident themselves', async () => {
    const before = seen.length;
    await ask(ananya, 'When is my pool booking?');
    await ask(ananya, 'When is my pool booking?');
    expect(seen.length).toBe(before + 2);
    // and those calls carried the resident's own records
    expect(seen.at(-1)!.titles).toContain('Your issues');
  });

  it('keeps questions in other scripts apart', async () => {
    const before = seen.length;
    const pool = await ask(ananya, 'पूल का समय क्या है?');
    const gym = await ask(ananya, 'जिम का समय क्या है?');
    expect(seen.length).toBe(before + 2);
    expect(pool.text).not.toBe(gym.text);
    expect((await ask(rohit, 'पूल का समय क्या है?')).text).toBe(pool.text);
    expect(seen.length).toBe(before + 2);
  });
});

describe('token use and cost', () => {
  it('records each call against the person who asked, even when two ask at once', async () => {
    const ids = Object.fromEntries((await t.db.select({ id: users.id, phone: users.phone }).from(users)).map(u => [u.phone, u.id]));
    const start = new Date();
    await Promise.all([ask(ananya, 'When is my pool slot?'), ask(rohit, 'When is my pool pass ready?'), ask(ananya, 'When is my pool key ready?')]);
    const rows = (await t.db.select().from(aiUsage)).filter(r => r.createdAt >= start && !r.fromCache);
    expect(rows).toHaveLength(3);
    expect(rows.filter(r => r.userId === ids[DEMO.residentPhone]).length).toBe(2);
    expect(rows.filter(r => r.userId === ids['9900112233']).length).toBe(1);
    expect(rows.every(r => r.associationId === t.associationId)).toBe(true);
  });

  it('prices the tokens, counts stored answers, and shows the operator every society', async () => {
    const r = (await t.call('GET', '/v1/ops/ai-usage?days=7', { token: op })).body;
    // each call: 80 input at $1/M, 20 cached at $0.50/M, 10 output at $2/M = $0.00011
    expect(r.total.calls).toBeGreaterThanOrEqual(8);
    expect(r.total.stored).toBeGreaterThanOrEqual(2);
    expect(r.total.cost).toBeCloseTo(r.total.calls * 0.00011, 6);
    expect(r.unpricedModels).toEqual([]);
    expect(r.bySociety[0]).toMatchObject({ id: t.associationId });
    expect(r.byModel.find((m: { model: string }) => m.model === 'test-model').price).toEqual({ input: 1, cachedInput: 0.5, output: 2 });
    // the society's admin sees their own society; a resident sees nothing
    expect((await t.call('GET', `/v1/admin/${t.associationId}/ai-usage`, { token: admin })).body.total.calls).toBe(r.total.calls);
    expect((await t.call('GET', '/v1/ops/ai-usage', { token: admin })).status).toBe(403);
    expect((await t.call('GET', `/v1/admin/${t.associationId}/ai-usage`, { token: ananya })).status).toBe(403);
  });
});

describe('the monthly spending cap', () => {
  it('stops model calls past the cap, keeps answering from rules and the store, and never stops the abuse check', async () => {
    const B = `/v1/ops/ai-budgets/${t.associationId}`;
    expect((await t.call('PUT', B, { token: admin, body: { monthlyUsd: 1 } })).status).toBe(403);
    const set = await t.call('PUT', B, { token: op, body: { monthlyUsd: 0.0001 } });
    expect(set.body).toMatchObject({ monthlyUsd: 0.0001, capped: true, enforceable: true });

    const calls = seen.length, checks = moderated;
    const r = await t.call('POST', '/v1/assistant/chat', { token: rohit, body: { text: 'When does the gym close at night?' } });
    expect(r.status).toBe(200);
    expect(r.body.text.length).toBeGreaterThan(0);
    expect(seen.length).toBe(calls); // no model call
    expect(moderated).toBe(checks + 1); // the abuse check still ran

    const report = (await t.call('GET', `/v1/admin/${t.associationId}/ai-usage`, { token: admin })).body;
    expect(report.budget).toMatchObject({ monthlyUsd: 0.0001, capped: true });
    expect((await t.call('GET', '/v1/ops/ai-usage', { token: op })).body.bySociety.find((x: { id: string }) => x.id === t.associationId).budget.capped).toBe(true);

    // cleared: the model is back
    await t.call('PUT', B, { token: op, body: { monthlyUsd: null } });
    await t.call('POST', '/v1/assistant/chat', { token: rohit, body: { text: 'When does the gym open in the morning?' } });
    expect(seen.length).toBe(calls + 1);
  });
});

describe('the OpenAI client reports what each call used', () => {
  it('passes the provider’s token counts to the sink — a refused reply too', async () => {
    const got: Usage[] = [];
    const p = new OpenAiProvider('sk-test', 'main-model', 'fast-model');
    let refuse = false;
    (p as unknown as { client: unknown }).client = { chat: { completions: { create: async () => ({
      usage: { prompt_tokens: 50, completion_tokens: 7, prompt_tokens_details: { cached_tokens: 10 } },
      choices: [{ message: refuse ? { content: null, refusal: 'no' } : { content: 'A reply', refusal: null } }],
    }) } } };
    p.setUsageSink(async u => { got.push(u); });
    expect(await p.compose('system', 'user')).toBe('A reply');
    refuse = true;
    expect(await p.rewrite('hello', 'Polite')).toBeNull();
    expect(got).toEqual([
      { feature: 'compose', model: 'main-model', inputTokens: 50, cachedInputTokens: 10, outputTokens: 7 },
      { feature: 'rewrite', model: 'fast-model', inputTokens: 50, cachedInputTokens: 10, outputTokens: 7 },
    ]);
  });
});
