import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { DB } from '../db/client.js';
import { platformSettings, subscriptions, type Plan, type SubState } from '../db/schema.js';
import { MODULES, PLAN_RANK } from './ops.js';

/* What each plan includes, and holding a society to it.
   The operator decides, in the Owner Portal, which plan each module starts at. A part of the society
   console is tied to a module; when a society's plan does not include that module, its routes answer
   "this is part of the Professional plan" instead of doing the work. A suspended society's console is
   closed altogether, apart from reading its plan and writing to support. */

export const PLANS: Plan[] = ['Starter', 'Professional', 'Enterprise'];
export type PlanInfo = { tag: string; about: string; /** list price per year, rupees; 0 = priced per society */ price: number };
export type PlanConfig = { plans: Record<Plan, PlanInfo>; moduleFrom: Record<string, Plan> };

const DEFAULT_INFO: Record<Plan, PlanInfo> = {
  Starter: { tag: 'Run the society', about: 'The unit register, residents, maintenance billing, notices and the vendor directory.', price: 0 },
  Professional: { tag: 'Run it properly', about: 'Adds accounting, rent collection, work orders, and visitor and delivery management.', price: 0 },
  Enterprise: { tag: 'Everything, automated', about: 'Adds AI inspections and assistant, and the community app.', price: 0 },
};
const defaults = (): PlanConfig => ({ plans: structuredClone(DEFAULT_INFO), moduleFrom: Object.fromEntries(MODULES.map(m => [m.name, m.from])) });

/**
 * The parts of the society console a plan can switch off: the module each belongs to, and the routes
 * under /v1/admin/:aid/ that do its work. Anything not listed here is in every plan.
 */
export const FEATURES = {
  accounting: { module: 'Accounting', name: 'Expenses, bank and financial reports', match: /^finance\/(expenses|journal|bank|periods|reports|auditors)\b/ },
  owners: { module: 'Rent Collection', name: 'Owners, rent and payouts', match: /^owners\b/ },
  workorders: { module: 'Maintenance & Work Orders', name: 'Vendors, estimates and vendor bills', match: /^(vendor-list|invoices|reports\/maintenance|follow-ups)\b/ },
  gate: { module: 'Visitor Management', name: 'Visitor and delivery management', match: /^(visits|guards|watchlist|gate-codes)\b/ },
  inspections: { module: 'AI Inspections', name: 'Inspections', match: /^inspections\b/ },
  assistant: { module: 'AI Assistant', name: 'The staff assistant', match: /^(assistant|ai-audit)\b|^issues\/[^/]+\/suggestion$/ },
} as const;
export type Feature = keyof typeof FEATURES;

type Sub = { at: number; plan: Plan; state: SubState } | { at: number; none: true };
/** a short memory per database, so a busy console does not ask the same two questions on every request */
const memory = new WeakMap<object, { config: { at: number; config: PlanConfig } | null; subs: Map<string, Sub> }>();
const mem = (db: object) => memory.get(db) ?? memory.set(db, { config: null, subs: new Map() }).get(db)!;
/** call after changing the plan configuration or any subscription, so the next request sees it */
export function forgetPlans(db: object, associationId?: string) {
  const m = mem(db);
  if (associationId) m.subs.delete(associationId); else { m.config = null; m.subs.clear(); }
}

type Reader = Pick<DB, 'select'>;
export async function planConfig(db: Reader): Promise<PlanConfig> {
  const cached = mem(db).config;
  if (cached && Date.now() - cached.at < 30_000) return cached.config;
  const [row] = await db.select().from(platformSettings).where(eq(platformSettings.key, 'plans'));
  const saved = (row?.value ?? {}) as Partial<PlanConfig>, base = defaults();
  const config: PlanConfig = {
    plans: Object.fromEntries(PLANS.map(p => [p, { ...base.plans[p], ...saved.plans?.[p] }])) as Record<Plan, PlanInfo>,
    // a module added to the code later takes its built-in plan until the operator moves it
    moduleFrom: { ...base.moduleFrom, ...Object.fromEntries(Object.entries(saved.moduleFrom ?? {}).filter(([name, plan]) => name in base.moduleFrom && PLANS.includes(plan))) },
  };
  mem(db).config = { at: Date.now(), config };
  return config;
}
export async function savePlanConfig(db: Pick<DB, 'select' | 'insert'>, patch: { plans?: Partial<Record<Plan, Partial<PlanInfo>>>; moduleFrom?: Record<string, Plan> }, by: string) {
  forgetPlans(db);
  const now = await planConfig(db);
  const value: PlanConfig = {
    plans: Object.fromEntries(PLANS.map(p => [p, { ...now.plans[p], ...patch.plans?.[p] }])) as Record<Plan, PlanInfo>,
    moduleFrom: { ...now.moduleFrom, ...patch.moduleFrom },
  };
  await db.insert(platformSettings).values({ key: 'plans', value, updatedBy: by }).onConflictDoUpdate({ target: platformSettings.key, set: { value, updatedBy: by, updatedAt: new Date() } });
  forgetPlans(db);
  return planConfig(db);
}

/** the catalogue as the portal shows it: every module with the plan it starts at */
export const modulesWith = (c: PlanConfig) => MODULES.map(m => ({ ...m, from: c.moduleFrom[m.name] ?? m.from }));
export const planIncludes = (c: PlanConfig, plan: Plan, feature: Feature) => PLAN_RANK[plan] >= PLAN_RANK[c.moduleFrom[FEATURES[feature].module] ?? 'Enterprise'];

async function subscriptionOf(db: Reader, associationId: string) {
  const subs = mem(db).subs, hit = subs.get(associationId);
  if (hit && Date.now() - hit.at < 15_000) return hit;
  const [s] = await db.select({ plan: subscriptions.plan, state: subscriptions.state }).from(subscriptions).where(eq(subscriptions.associationId, associationId));
  const next = s ? { at: Date.now(), ...s } : { at: Date.now(), none: true as const };
  subs.set(associationId, next);
  return next;
}

/** what a society's console may use right now */
export async function accessOf(db: Reader, associationId: string) {
  const [c, s] = await Promise.all([planConfig(db), subscriptionOf(db, associationId)]);
  const keys = Object.keys(FEATURES) as Feature[];
  // a society with no subscription on file (older data, tests) is not held to any plan
  if ('none' in s) return { plan: null, state: null, suspended: false, features: Object.fromEntries(keys.map(k => [k, true])) as Record<Feature, boolean>, needs: {} as Partial<Record<Feature, Plan>> };
  const features = Object.fromEntries(keys.map(k => [k, planIncludes(c, s.plan, k)])) as Record<Feature, boolean>;
  const needs = Object.fromEntries(keys.filter(k => !features[k]).map(k => [k, c.moduleFrom[FEATURES[k].module] ?? 'Enterprise'])) as Partial<Record<Feature, Plan>>;
  return { plan: s.plan, state: s.state, suspended: s.state === 'Suspended', features, needs };
}

const ADMIN = /^\/v1\/admin\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([^?]*)/i;
/** Runs before every society-console route. It never grants anything — sign-in and roles are still checked by the route itself. */
export const planGuard = (db: Reader) => async (req: FastifyRequest, reply: FastifyReply) => {
  const m = ADMIN.exec(req.url);
  if (!m || !req.headers.authorization) return; // not signed in: the route itself answers 401
  const [, aid, rest] = m as unknown as [string, string, string];
  if (/^(plan|support)\b/.test(rest)) return; // always open: what am I on, and how do I reach Trinize
  const a = await accessOf(db, aid!);
  if (a.suspended) return reply.status(403).send({ error: { code: 'subscription_suspended', message: 'This society’s subscription is suspended. Contact Trinize support to restore access.' } });
  const key = (Object.keys(FEATURES) as Feature[]).find(k => FEATURES[k].match.test(rest!));
  if (key && !a.features[key]) return reply.status(403).send({ error: { code: 'plan_required', message: `${FEATURES[key].name} is part of the ${a.needs[key]} plan. This society is on ${a.plan}.`, feature: key, plan: a.needs[key] } });
};
