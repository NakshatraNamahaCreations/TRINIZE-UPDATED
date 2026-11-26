import { and, eq, gte, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../app.js';
import { aiAnswerCache, aiBudgets, aiUsage, associations, opsActivity } from '../db/schema.js';
import { capOf, forgetBudget, monthSpend } from '../lib/budget.js';
import { staffOf, userIdFrom } from '../lib/auth.js';
import { notFound, parse } from '../lib/http.js';
import { costOf, parsePrices, type Prices } from '../lib/usage.js';

const Days = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });

/**
 * What the AI has cost.
 *   /v1/ops/ai-usage            the operator: every society, by society, model, feature and day
 *   /v1/admin/:aid/ai-usage     a society's admin: their own society only
 * Tokens are counted when each call is made (lib/usage.ts); the money is worked out here from AI_PRICES,
 * so a price change applies to the past too. A model with no price shows its tokens and "price not set".
 */
export const aiUsageRoutes = ({ config, db }: Deps): FastifyPluginAsync => async app => {
  const uid = (req: FastifyRequest) => userIdFrom(req, config.JWT_SECRET);
  const prices: Prices = parsePrices(config.AI_PRICES);
  // a cap counts dollars, so it can only be held to while the models in use have a price
  const capEnforceable = !!prices[config.AI_MODEL] && !!prices[config.AI_MODEL_FAST || config.AI_MODEL];
  /** a society's cap and what it has spent this India-time month */
  const budgetOf = async (aid: string) => {
    const cap = await capOf(db, aid);
    const spent = Math.round((await monthSpend(db, prices, aid, true)) * 1_000_000) / 1_000_000;
    return { monthlyUsd: cap, spentThisMonth: spent, capped: cap !== null && spent >= cap, enforceable: capEnforceable };
  };

  const report = async (days: number, aid?: string) => {
    const since = new Date(Date.now() - days * 86_400_000);
    const where = and(gte(aiUsage.createdAt, since), aid ? eq(aiUsage.associationId, aid) : undefined);
    const sums = { calls: sql<number>`count(*) filter (where not ${aiUsage.fromCache})::int`, stored: sql<number>`count(*) filter (where ${aiUsage.fromCache})::int`,
      input: sql<number>`coalesce(sum(${aiUsage.inputTokens}), 0)::int`, cached: sql<number>`coalesce(sum(${aiUsage.cachedInputTokens}), 0)::int`, output: sql<number>`coalesce(sum(${aiUsage.outputTokens}), 0)::int` };
    // everything is grouped by model first, because each model has its own price
    const rows = await db.select({ aid: aiUsage.associationId, model: aiUsage.model, feature: aiUsage.feature, day: sql<string>`to_char(${aiUsage.createdAt} at time zone 'Asia/Kolkata', 'YYYY-MM-DD')`, ...sums })
      .from(aiUsage).where(where).groupBy(aiUsage.associationId, aiUsage.model, aiUsage.feature, sql`4`);
    const priced = (r: (typeof rows)[number]) => (r.calls ? costOf(prices, r.model, { inputTokens: r.input, cachedInputTokens: r.cached, outputTokens: r.output }) : 0);
    type Sum = { calls: number; stored: number; input: number; cached: number; output: number; cost: number; unpriced: number };
    const add = (into: Sum, r: (typeof rows)[number]) => {
      const c = priced(r);
      into.calls += r.calls; into.stored += r.stored; into.input += r.input; into.cached += r.cached; into.output += r.output;
      if (c === null) into.unpriced += r.calls; else into.cost += c;
      return into;
    };
    const blank = (): Sum => ({ calls: 0, stored: 0, input: 0, cached: 0, output: 0, cost: 0, unpriced: 0 });
    const by = <K extends string>(key: (r: (typeof rows)[number]) => K) => {
      const m = new Map<K, Sum>();
      for (const r of rows) m.set(key(r), add(m.get(key(r)) ?? blank(), r));
      return m;
    };
    const round = (s: Sum) => ({ ...s, cost: Math.round(s.cost * 1_000_000) / 1_000_000 }); // to the millionth of a dollar: a single call costs fractions of a cent
    const names = new Map((await db.select({ id: associations.id, name: associations.name }).from(associations)).map(a => [a.id, a.name]));
    const kept = aid ? await db.select({ n: sql<number>`count(*)::int` }).from(aiAnswerCache).where(eq(aiAnswerCache.associationId, aid)) : await db.select({ n: sql<number>`count(*)::int` }).from(aiAnswerCache);
    return {
      days, currency: 'USD',
      /** models that were used but have no price in AI_PRICES — their calls are counted, not costed */
      unpricedModels: [...new Set(rows.filter(r => r.calls && !prices[r.model]).map(r => r.model))],
      total: round(rows.reduce(add, blank())),
      storedAnswersNow: kept[0]?.n ?? 0,
      byModel: [...by(r => r.model)].map(([model, s]) => ({ model, price: prices[model] ?? null, ...round(s) })).filter(m => m.calls).sort((a, b) => b.cost - a.cost || b.calls - a.calls),
      byFeature: [...by(r => r.feature)].map(([feature, s]) => ({ feature, ...round(s) })).sort((a, b) => b.cost - a.cost || b.calls + b.stored - (a.calls + a.stored)),
      // every society is listed (a cap can be set before it uses anything), with its cap and this month's spend
      bySociety: aid ? [] : await (async () => {
        const used = by(r => r.aid ?? '');
        const list = [...names.keys(), ...(used.has('') ? [''] : [])];
        return Promise.all(list.map(async id => ({ id: id || null, name: id ? names.get(id)! : 'Not tied to a society', ...round(used.get(id) ?? blank()), budget: id ? await budgetOf(id) : null })));
      })().then(l => l.sort((a, b) => b.cost - a.cost || b.calls - a.calls || a.name.localeCompare(b.name))),
      budget: aid ? await budgetOf(aid) : null,
      capEnforceable,
      byDay: [...by(r => r.day)].map(([date, s]) => ({ date, ...round(s) })).sort((a, b) => a.date.localeCompare(b.date)),
    };
  };

  app.get('/ops/ai-usage', async req => {
    await staffOf(db, await uid(req), null, ['operator']);
    return report(parse(Days, req.query).days);
  });
  /** set a society's monthly AI cap in USD, or clear it with null */
  app.put('/ops/ai-budgets/:aid', async req => {
    const op = await staffOf(db, await uid(req), null, ['operator']);
    const { aid } = parse(z.object({ aid: z.uuid() }), req.params);
    const { monthlyUsd } = parse(z.object({ monthlyUsd: z.number().positive().max(100_000).nullable() }), req.body);
    const [a] = await db.select({ name: associations.name }).from(associations).where(eq(associations.id, aid));
    if (!a) throw notFound('That society');
    if (monthlyUsd === null) await db.delete(aiBudgets).where(eq(aiBudgets.associationId, aid));
    else await db.insert(aiBudgets).values({ associationId: aid, monthlyUsd, updatedBy: op.name }).onConflictDoUpdate({ target: aiBudgets.associationId, set: { monthlyUsd, updatedBy: op.name, updatedAt: new Date() } });
    forgetBudget(aid);
    await db.insert(opsActivity).values({ who: op.name, what: monthlyUsd === null ? `removed the AI spending cap for ${a.name}` : `set the AI spending cap for ${a.name} to $${monthlyUsd} a month` });
    return budgetOf(aid);
  });

  app.get('/admin/:aid/ai-usage', async req => {
    const { aid } = parse(z.object({ aid: z.uuid() }), req.params);
    await staffOf(db, await uid(req), aid, ['admin', 'operator']);
    return report(parse(Days, req.query).days, aid);
  });
};
