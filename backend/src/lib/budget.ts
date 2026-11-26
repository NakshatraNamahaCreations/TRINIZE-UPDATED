import { and, eq, gte, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { aiBudgets, aiUsage } from '../db/schema.js';
import type { Ai } from './ai.js';
import { costOf, currentAssociation, type Prices } from './usage.js';

/*
 * A society's monthly AI spending cap. The operator sets it in dollars; once the society's spend this India-time
 * month reaches it, its AI features fall back to the built-in rules (the same as when no AI is connected) until the
 * month turns or the cap is raised. The abuse check on posts is never capped — safety doesn't stop for a budget —
 * and stored answers are still given, since they cost nothing. A model with no price can't be counted, so a cap is
 * only as complete as AI_PRICES. Any failure reading the cap (a migration not yet run) means "no cap".
 */

const IST = 330 * 60_000;
const TTL = 60_000;
/** the first instant of this India-time month */
export function monthStart(now = Date.now()) {
  const d = new Date(now + IST);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - IST);
}

type Reader = Pick<DB, 'select'>;
const caps = new Map<string, { at: number; usd: number | null }>();
const spends = new Map<string, { at: number; usd: number }>();
/** call after a cap changes, so the next request sees it */
export const forgetBudget = (aid?: string) => { if (aid) { caps.delete(aid); spends.delete(aid); } else { caps.clear(); spends.clear(); } };

export async function capOf(db: Reader, aid: string): Promise<number | null> {
  const hit = caps.get(aid);
  if (hit && Date.now() - hit.at < TTL) return hit.usd;
  let usd: number | null = null;
  try { usd = (await db.select({ usd: aiBudgets.monthlyUsd }).from(aiBudgets).where(eq(aiBudgets.associationId, aid)))[0]?.usd ?? null; } catch { usd = null; }
  caps.set(aid, { at: Date.now(), usd });
  return usd;
}

/** what the society's model calls have cost so far this month, in USD (unpriced models count as nothing) */
export async function monthSpend(db: Reader, prices: Prices, aid: string, fresh = false): Promise<number> {
  const hit = spends.get(aid);
  if (!fresh && hit && Date.now() - hit.at < TTL) return hit.usd;
  let usd = 0;
  try {
    const rows = await db.select({ model: aiUsage.model, input: sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)::int`, cached: sql<number>`coalesce(sum(${aiUsage.cachedInputTokens}), 0)::int`, output: sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)::int` })
      .from(aiUsage).where(and(eq(aiUsage.associationId, aid), gte(aiUsage.createdAt, monthStart()), eq(aiUsage.fromCache, false))).groupBy(aiUsage.model);
    usd = rows.reduce((n, r) => n + (costOf(prices, r.model, { inputTokens: r.input, cachedInputTokens: r.cached, outputTokens: r.output }) ?? 0), 0);
  } catch { usd = 0; }
  spends.set(aid, { at: Date.now(), usd });
  return usd;
}

/** has the society the current request is for used up its cap? */
async function overCap(db: Reader, prices: Prices) {
  const aid = currentAssociation();
  if (!aid) return false;
  const cap = await capOf(db, aid);
  return cap !== null && (await monthSpend(db, prices, aid)) >= cap;
}

/** the AI, held to each society's monthly cap: past it, answers, rewrites, drafts and readings return null (rules take over) */
export function withBudget(ai: Ai, db: Reader, prices: Prices): Ai {
  const gate = <A extends unknown[], R>(fn: (...a: A) => Promise<R | null>) => async (...a: A): Promise<R | null> => ((await overCap(db, prices)) ? null : fn(...a));
  return {
    get enabled() { return ai.enabled; },
    moderate: text => ai.moderate(text), // never capped
    answer: gate((q: string, c: Parameters<Ai['answer']>[1]) => ai.answer(q, c)),
    rewrite: gate((text: string, tone: string) => ai.rewrite(text, tone)),
    compose: gate((system: string, user: string) => ai.compose(system, user)),
    extract: <T>(o: Parameters<Ai['extract']>[0] & { check: import('zod').ZodType<T> }) => gate(() => ai.extract<T>(o))(),
    setUsageSink: sink => ai.setUsageSink?.(sink),
  };
}
