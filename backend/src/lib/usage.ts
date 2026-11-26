import { AsyncLocalStorage } from 'node:async_hooks';
import type { DB } from '../db/client.js';
import { aiUsage } from '../db/schema.js';

/*
 * AI token use, and what it costs.
 *
 * Every request runs inside a small context (set by a hook in app.ts). The sign-in helpers fill in who the
 * request is for and which society; when the AI client finishes a model call it reads that context and records
 * one row: the model, the feature, and the tokens — never the text. Recording never fails a request: if the
 * table is missing (a migration not yet run) or the write fails, the call simply goes unrecorded.
 */

export type UsageCtx = { userId: string | null; associationId: string | null };
const ctx = new AsyncLocalStorage<UsageCtx>();

/** the society the current request is for, if known */
export const currentAssociation = () => ctx.getStore()?.associationId ?? null;
/** run the rest of a request inside a fresh context */
export const withUsageContext = (fn: () => void) => ctx.run({ userId: null, associationId: null }, fn);
/** say whose request this is; called once the caller is known (residentOf, staffOf) */
export function attribute(userId: string, associationId: string | null) {
  const c = ctx.getStore();
  if (!c) return;
  c.userId = userId;
  // an operator's request names its society in the route; a later, more specific answer wins
  if (associationId) c.associationId = associationId;
}

export type Usage = { feature: string; model: string; inputTokens: number; cachedInputTokens: number; outputTokens: number; fromCache?: boolean };
export type UsageSink = (u: Usage) => Promise<void>;

/** where model calls are recorded: the ai_usage table, attributed to the current request */
export const usageSink = (db: Pick<DB, 'insert'>): UsageSink => async u => {
  const c = ctx.getStore();
  try {
    await db.insert(aiUsage).values({ ...u, fromCache: u.fromCache ?? false, userId: c?.userId ?? null, associationId: c?.associationId ?? null });
  } catch (e) {
    console.warn(`[ai] usage not recorded: ${e instanceof Error ? e.message : e}`);
  }
};

/* ---------- prices ---------- */
/** USD per million tokens, by model, from AI_PRICES — e.g. {"gpt-5.4-mini":{"input":0.25,"cachedInput":0.025,"output":2}} */
export type Price = { input: number; cachedInput?: number; output: number };
export type Prices = Record<string, Price>;

export function parsePrices(raw: string): Prices {
  if (!raw.trim()) return {};
  try {
    const v = JSON.parse(raw) as Record<string, Partial<Price>>;
    const out: Prices = {};
    for (const [model, p] of Object.entries(v)) {
      if (typeof p?.input === 'number' && typeof p.output === 'number') out[model] = { input: p.input, output: p.output, ...(typeof p.cachedInput === 'number' ? { cachedInput: p.cachedInput } : {}) };
    }
    return out;
  } catch {
    console.warn('[ai] AI_PRICES is not valid JSON — costs are shown as "price not set"');
    return {};
  }
}

/** what some tokens of one model cost, in USD; null when that model has no price set */
export function costOf(prices: Prices, model: string, t: { inputTokens: number; cachedInputTokens: number; outputTokens: number }): number | null {
  const p = prices[model];
  if (!p) return null;
  const cached = Math.min(t.cachedInputTokens, t.inputTokens);
  return ((t.inputTokens - cached) * p.input + cached * (p.cachedInput ?? p.input) + t.outputTokens * p.output) / 1_000_000;
}
