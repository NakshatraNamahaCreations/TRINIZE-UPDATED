import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../db/client.js';
import { vendors, type Priority } from '../db/schema.js';
import type { Ai } from './ai.js';
import { CATEGORIES, COMMON_ASSETS, SLA_HOURS } from './issues.js';

/* Reading a complaint: which trade it needs, how urgent it is, and who should get it.
   Built-in rules always work; with an AI key the model reads the words instead, and the rules are the fallback. */

export type Category = (typeof CATEGORIES)[number];

const CATEGORY_WORDS: [Category, RegExp][] = [
  ['Lifts', /\b(lift|elevator)s?\b/],
  ['Plumbing', /\b(water|tap|leak\w*|seepage|pipe|drain\w*|flush|sink|toilet|commode|geyser|tank|sump|motor|pump|overflow\w*|blocked|clog\w*|stp|sewage|damp\w*|plumb\w*)\b/],
  ['Electrical', /\b(light|lights|bulb|power|electric\w*|switch\w*|socket|wiring|fuse|mcb|short circuit|sparks?|generator|dg|inverter|fan|meter)\b/],
  ['HVAC', /\b(ac|a\/c|air ?con\w*|cooling|hvac|chiller|ventilation|exhaust)\b/],
  ['Pest control', /\b(pest|cockroach\w*|rats?|rodent\w*|termite\w*|mosquito\w*|bed ?bugs?|ants)\b/],
  ['Sanitation', /\b(garbage|waste|trash|clean\w*|dirty|smell\w*|stink\w*|housekeeping|sweep\w*|litter|stain\w*)\b/],
  ['Security', /\b(security|guard|cctv|camera|intercom|gate|lock|theft|stranger|boom barrier|access card)\b/],
  ['Appliance', /\b(fridge|refrigerator|washing machine|oven|microwave|chimney|hob|stove|dishwasher|tv|purifier)\b/],
];
const EMERGENCY = /\b(fire|smoke|gas leak|sparks?|short circuit|electrocut\w*|shock|flood\w*|burst|stuck in (the )?lift|trapped|collapse\w*)\b/;
const HIGH = /\b(no water|no power|no electricity|power cut|not working|leak\w*|overflow\w*|sewage|broken|urgent|asap|immediately|seepage|out of (order|service))\b/;
const LOW = /\b(paint\w*|cosmetic|minor|whenever|no hurry|squeak\w*|loose handle|touch.?up)\b/;

export function categoryOf(text: string): Category {
  const t = text.toLowerCase();
  return CATEGORY_WORDS.find(([, re]) => re.test(t))?.[0] ?? 'General maintenance';
}
export function priorityOf(text: string): Priority {
  const t = text.toLowerCase();
  return EMERGENCY.test(t) ? 'Emergency' : HIGH.test(t) ? 'High' : LOW.test(t) ? 'Low' : 'Medium';
}
/** the shared equipment a complaint is about, if any */
export function assetOf(text: string): (typeof COMMON_ASSETS)[number] | null {
  const t = text.toLowerCase();
  const hit: [RegExp, (typeof COMMON_ASSETS)[number]][] = [
    [/\b(lift|elevator)s?\b/, 'Lift'], [/\b(stp|sewage)\b/, 'STP'], [/\b(generator|dg)\b/, 'Generator'], [/\b(cctv|camera)s?\b/, 'CCTV'],
    [/\b(club ?house|gym|pool)\b/, 'Clubhouse'], [/\b(garden|lawn|park)\b/, 'Garden'], [/\b(corridor|lobby|staircase)\b/, 'Corridor lights'],
    [/\b(sump|overhead tank|water tank)\b/, 'Sump / tank'], [/\b(parking|basement)\b/, 'Parking area'], [/\b(gate|security cabin)\b/, 'Gate / security cabin'],
    [/\b(water motor|pump)\b/, 'Water motor'], [/\bdrain\w*\b/, 'Drainage'],
  ];
  return hit.find(([re]) => re.test(t))?.[1] ?? null;
}

const Shape = z.object({ category: z.enum(CATEGORIES), priority: z.enum(['Low', 'Medium', 'High', 'Emergency']), title: z.string(), reason: z.string() });
const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['category', 'priority', 'title', 'reason'],
  properties: {
    category: { type: 'string', enum: [...CATEGORIES] }, priority: { type: 'string', enum: ['Low', 'Medium', 'High', 'Emergency'] },
    title: { type: 'string', description: 'The job in at most eight words, as a work order title.' }, reason: { type: 'string', description: 'One short sentence: why this category and priority.' },
  },
} as const;
const SYSTEM = `You triage maintenance complaints for a residential society in India. Residents write in English, Hindi, Kannada or a mix.
Pick the trade the repair needs and how urgent it is:
- Emergency: danger to people or the building right now (fire, sparks, gas, flooding, someone stuck in a lift).
- High: a home or shared service is unusable (no water, no power, sewage, an active leak, a lift out of service).
- Medium: it works badly but people can manage.
- Low: cosmetic, or can wait.
Judge only from what is written. Do not invent details.`;

/** the active vendor of that trade with the fewest open jobs — "recommend vendor" and "balance the workload" in one */
export async function vendorFor(db: Pick<DB, 'select'>, associationId: string, category: string) {
  const rows = await db.select({
    id: vendors.id, name: vendors.name, category: vendors.category,
    openJobs: sql<number>`(select count(*)::int from issues i where i.vendor_id = ${vendors.id} and i.status not in ('Resolved','Closed'))`,
  }).from(vendors).where(and(eq(vendors.associationId, associationId), eq(vendors.active, true)));
  const fit = rows.filter(v => v.category.toLowerCase() === category.toLowerCase()).sort((a, b) => a.openJobs - b.openJobs)[0];
  return fit ? { id: fit.id, name: fit.name, openJobs: fit.openJobs } : null;
}

export type Triage = { title: string; category: Category; priority: Priority; asset: string | null; slaHours: number; vendor: { id: string; name: string; openJobs: number } | null; reason: string; by: 'ai' | 'rules' };

export async function triage(db: Pick<DB, 'select'>, ai: Ai, associationId: string, text: string): Promise<Triage> {
  const clean = text.trim().replace(/\s+/g, ' ');
  const byAi = ai.enabled ? await ai.extract({ name: 'triage', schema: SCHEMA, check: Shape, system: SYSTEM, user: clean }) : null;
  const category = byAi?.category ?? categoryOf(clean), priority = byAi?.priority ?? priorityOf(clean);
  const title = (byAi?.title || clean).replace(/[.!]+$/, '').slice(0, 110);
  return {
    title: title.charAt(0).toUpperCase() + title.slice(1), category, priority, asset: assetOf(clean), slaHours: SLA_HOURS[priority],
    vendor: await vendorFor(db, associationId, category),
    reason: byAi?.reason ?? `Matched the words in the complaint to ${category}; ${priority.toLowerCase()} priority by the built-in rules.`, by: byAi ? 'ai' : 'rules',
  };
}
