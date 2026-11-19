import { readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { and, asc, desc, eq, lt } from 'drizzle-orm';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { DB } from '../db/client.js';
import {
  CONDITIONS, inspectionItems, inspections, RECOMMENDATIONS, SEVERITIES,
  type Condition, type Priority, type Recommendation, type Severity, type TemplateSection,
} from '../db/schema.js';
import type { Ai } from './ai.js';
import { CATEGORIES } from './issues.js';
import { categoryOf } from './triage.js';

/* Inspections: the checklists every society starts with, what counts as complete, turning a rating and
   photos into a finding, and the summary at the top of the report. */

export type Item = typeof inspectionItems.$inferSelect;
export type Inspection = typeof inspections.$inferSelect;
export const insRef = (n: number) => 'INS-' + n;

const P = (name: string) => ({ name, photo: true });
const N = (name: string) => ({ name, photo: false });
const room = (name: string, extra: { name: string; photo: boolean }[] = []) => ({ name, items: [P('Walls'), P('Floor'), N('Door'), N('Windows'), N('Electrical points'), ...extra] });

/** the built-in checklists; a society adds its own on top */
export const BUILT_IN: { key: string; name: string; about: string; scope: 'unit' | 'common'; sections: TemplateSection[] }[] = [
  {
    key: 'flat', name: 'Flat walkthrough', about: 'Room by room: for move-in, move-out and routine checks of a flat.', scope: 'unit',
    sections: [
      room('Living room', [N('Fixtures')]),
      { name: 'Kitchen', items: [P('Walls'), P('Floor'), P('Sink & taps'), N('Cabinets'), N('Electrical points'), N('Windows')] },
      room('Bedroom', [N('Wardrobe')]),
      { name: 'Bathroom', items: [P('Walls & tiles'), P('Floor'), P('Sink & taps'), P('Toilet & flush'), N('Geyser'), N('Door')] },
      { name: 'Balcony', items: [P('Floor & drain'), N('Railing'), N('Door')] },
      { name: 'Parking', items: [P('Parking slot'), N('Lighting')] },
    ],
  },
  {
    key: 'common', name: 'Common areas', about: 'The shared equipment and spaces of the society.', scope: 'common',
    sections: [
      { name: 'Lift', items: [P('Car interior'), N('Doors & sensors'), N('Emergency button'), N('Lighting')] },
      { name: 'STP', items: [P('Plant & tanks'), N('Pumps'), N('Odour & leaks')] },
      { name: 'Generator', items: [P('Generator set'), N('Fuel level'), N('Battery')] },
      { name: 'Water tank', items: [P('Tank & lids'), N('Cleanliness'), N('Motor & pump')] },
      { name: 'Corridor', items: [P('Walls & floor'), N('Lighting')] },
      { name: 'Gate', items: [P('Gate & barrier'), N('Security cabin'), N('CCTV')] },
      { name: 'Clubhouse', items: [P('Hall & furniture'), N('Gym equipment'), N('Washrooms')] },
      { name: 'Garden', items: [P('Lawn & plants'), N('Play equipment')] },
      { name: 'Parking', items: [P('Floor & markings'), N('Lighting'), N('Drainage')] },
    ],
  },
  {
    key: 'fire', name: 'Fire & safety', about: 'Extinguishers, hydrants, alarms and exits.', scope: 'common',
    sections: [
      { name: 'Fire equipment', items: [P('Extinguishers'), P('Hydrants & hose reels'), N('Fire pump'), N('Sprinklers')] },
      { name: 'Alarms', items: [N('Smoke detectors'), N('Alarm panel'), N('Public address')] },
      { name: 'Exits', items: [P('Staircases clear'), N('Exit signs'), N('Emergency lighting')] },
      { name: 'Electrical', items: [P('Main panel'), N('Earthing'), N('Meter room')] },
    ],
  },
];

/* ---------- what is still missing before it can be submitted ---------- */
export function coverage(items: Pick<Item, 'section' | 'item' | 'photoRequired' | 'condition' | 'photos'>[]) {
  const missing: string[] = [];
  for (const i of items) {
    const what = `${i.section} · ${i.item}`;
    if (!i.condition) missing.push(`${what}: not rated`);
    // something that is missing altogether cannot be photographed
    else if (i.photoRequired && !i.photos.length && i.condition !== 'Missing') missing.push(`${what}: photo missing`);
    else if ((i.condition === 'Poor' || i.condition === 'Damaged') && !i.photos.length) missing.push(`${what}: rated ${i.condition} — add a photo as evidence`);
  }
  return missing;
}

/* ---------- a rating → a finding, by rule ---------- */
const WORSE: Record<Condition, number> = { Good: 0, Fair: 1, Poor: 2, Damaged: 3, Missing: 3 };
const SAFETY = /\b(electric\w*|wiring|panel|earthing|extinguisher\w*|hydrant\w*|alarm\w*|detector\w*|lift|railing|gas|exit\w*|staircase\w*|emergency|sprinkler\w*|fire)\b/i;

export function ruleFinding(i: Pick<Item, 'section' | 'item' | 'condition' | 'note'>): { finding: string; severity: Severity; recommendation: Recommendation; category: string } | null {
  if (!i.condition || i.condition === 'Good') return null;
  const about = `${i.section} ${i.item} ${i.note}`;
  const safety = SAFETY.test(about);
  const severity: Severity = i.condition === 'Fair' ? (safety ? 'Medium' : 'Low') : i.condition === 'Poor' ? (safety ? 'High' : 'Medium') : safety ? 'Critical' : 'High';
  const recommendation: Recommendation = i.condition === 'Fair' ? 'Monitor' : i.condition === 'Missing' ? 'Replace' : i.condition === 'Damaged' && /\b(broken|shattered|beyond repair|burnt|missing)\b/i.test(i.note) ? 'Replace' : 'Repair';
  const base = i.condition === 'Missing' ? `${i.item} is missing in the ${i.section.toLowerCase()}.` : `${i.item} in the ${i.section.toLowerCase()} is in ${i.condition.toLowerCase()} condition.`;
  return { finding: i.note ? `${base} ${i.note.trim().replace(/[.]*$/, '.')}` : base, severity, recommendation, category: categoryOf(about) };
}

/* ---------- photos → a finding, by a model ---------- */
const Seen = z.object({ finding: z.string(), condition: z.enum(CONDITIONS), severity: z.enum(SEVERITIES), recommendation: z.enum(RECOMMENDATIONS), category: z.enum(CATEGORIES), damage: z.boolean() });
const SEEN_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['finding', 'condition', 'severity', 'recommendation', 'category', 'damage'],
  properties: {
    finding: { type: 'string', description: 'One or two plain sentences on what is visibly wrong: cracks, stains, seepage, leaks, rust, broken or missing parts. If nothing is wrong, say so in a few words.' },
    condition: { type: 'string', enum: [...CONDITIONS] }, severity: { type: 'string', enum: [...SEVERITIES] },
    recommendation: { type: 'string', enum: [...RECOMMENDATIONS] }, category: { type: 'string', enum: [...CATEGORIES], description: 'The trade a repair would need.' },
    damage: { type: 'boolean', description: 'True only if damage or a defect is actually visible in the photos or stated in the note.' },
  },
} as const;
const LOOK = `You help a property manager in India write up an inspection of a flat or a housing society's common areas.
You are given one checklist item, the inspector's rating and note, and their photos of it.
Describe only what the photos and the note show. Never invent damage, and never guess at what is out of frame.
Severity: Low = cosmetic; Medium = should be fixed soon; High = affects use or will get worse quickly; Critical = a safety risk.
Recommendation: Repair, Replace, Monitor (keep an eye on it) or Ignore (nothing to do).`;

const MIME: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
/** a photo this API stored, as a data URL a model can read; null for anything else */
async function dataUrl(config: Config, url: string): Promise<string | null> {
  if (!url.startsWith(config.PUBLIC_URL + '/files/')) return null;
  const name = basename(url), mime = MIME[name.split('.').pop() ?? ''];
  if (!mime) return null;
  try { return `data:${mime};base64,${(await readFile(join(resolve(config.UPLOAD_DIR), name))).toString('base64')}`; } catch { return null; }
}

/**
 * Write the findings. Every item rated worse than Good gets one from the rules; with an AI key, items
 * that have photos are looked at by the model instead — including ones rated Good, where it may spot
 * something the inspector walked past (kept as a "possible" finding, the rating is never overwritten).
 */
export async function analyse(db: DB, ai: Ai, config: Config, inspectionId: string) {
  const items = await db.select().from(inspectionItems).where(eq(inspectionItems.inspectionId, inspectionId)).orderBy(asc(inspectionItems.position));
  let byAi = 0;
  const one = async (i: Item) => {
    if (i.issueId) return; // already a work order — leave what it was raised from alone
    let out: { finding: string; severity: Severity | null; recommendation: Recommendation | null; category: string | null; findingBy: 'ai' | 'rules' | null } =
      { finding: '', severity: null, recommendation: null, category: null, findingBy: null };
    const rule = ruleFinding(i);
    if (rule) out = { ...rule, findingBy: 'rules' };
    if (ai.enabled && i.photos.length && i.condition) {
      const images = (await Promise.all(i.photos.slice(0, 3).map(u => dataUrl(config, u)))).filter((u): u is string => !!u);
      const seen = images.length ? await ai.extract({ name: 'finding', schema: SEEN_SCHEMA, check: Seen, system: LOOK, images,
        user: `Checklist item: ${i.item}\nWhere: ${i.section}\nInspector's rating: ${i.condition}\nInspector's note: ${i.note || '(none)'}` }) : null;
      if (seen) {
        byAi++;
        if (i.condition !== 'Good') out = { finding: seen.finding, severity: seen.severity, recommendation: seen.recommendation, category: seen.category, findingBy: 'ai' };
        else if (seen.damage && WORSE[seen.condition] >= WORSE.Poor) out = { finding: 'Possible issue, rated Good by the inspector: ' + seen.finding, severity: seen.severity, recommendation: 'Monitor', category: seen.category, findingBy: 'ai' };
      }
    }
    await db.update(inspectionItems).set(out).where(eq(inspectionItems.id, i.id));
  };
  // a few at a time: a walkthrough can have forty items, and each look at photos takes seconds
  for (let n = 0; n < items.length; n += 4) await Promise.all(items.slice(n, n + 4).map(one));
  return { items: items.length, byAi };
}

/* ---------- the paragraph at the top of the report ---------- */
export function countsOf(items: Pick<Item, 'condition' | 'severity' | 'finding' | 'issueId'>[]) {
  const by = Object.fromEntries(CONDITIONS.map(c => [c, items.filter(i => i.condition === c).length])) as Record<Condition, number>;
  const findings = items.filter(i => i.finding && i.severity);
  return { total: items.length, rated: items.filter(i => i.condition).length, ...by, findings: findings.length,
    critical: findings.filter(i => i.severity === 'Critical').length, high: findings.filter(i => i.severity === 'High').length, workOrders: items.filter(i => i.issueId).length };
}

export async function summarise(ai: Ai, ins: Pick<Inspection, 'type' | 'templateName'>, where: string, items: Item[]): Promise<{ text: string; by: 'ai' | 'rules' }> {
  const c = countsOf(items);
  const findings = items.filter(i => i.finding && i.severity).sort((a, b) => SEVERITIES.indexOf(b.severity!) - SEVERITIES.indexOf(a.severity!));
  const worst = findings.slice(0, 3).map(i => `${i.section} · ${i.item} (${i.severity}, ${i.recommendation?.toLowerCase()})`);
  const rule = `${ins.type} inspection of ${where}: ${c.total} items checked — ${c.Good} good, ${c.Fair} fair, ${c.Poor} poor, ${c.Damaged} damaged, ${c.Missing} missing. `
    + (findings.length ? `${findings.length} finding${findings.length === 1 ? '' : 's'}${c.critical + c.high ? `, ${c.critical + c.high} of them high or critical` : ''}. Most serious: ${worst.join('; ')}.` : 'Nothing needs attention.');
  if (!ai.enabled || !findings.length) return { text: rule, by: 'rules' };
  const text = await ai.compose(
    'You write the summary paragraph of a property inspection report for a housing society in India. Three to five plain sentences, no markdown, no greeting. Start with the overall state, then what needs attention first and why, then what can wait. Use only the facts given; do not add findings, costs or dates.',
    `${rule}\n\nFindings:\n${findings.map(i => `- ${i.section} · ${i.item}: ${i.finding} [${i.severity}; ${i.recommendation}; ${i.category}]`).join('\n')}`);
  return text ? { text, by: 'ai' } : { text: rule, by: 'rules' };
}

/* ---------- move-in against move-out ---------- */
/** the most recent submitted move-in for the same flat, item by item against this one */
export async function compareWithMoveIn(db: Pick<DB, 'select'>, ins: Inspection, items: Item[]) {
  if (ins.type !== 'Move-out' || !ins.unitId) return null;
  const [before] = await db.select().from(inspections)
    .where(and(eq(inspections.unitId, ins.unitId), eq(inspections.type, 'Move-in'), eq(inspections.status, 'Submitted'), lt(inspections.startedAt, ins.startedAt)))
    .orderBy(desc(inspections.startedAt)).limit(1);
  if (!before) return null;
  const then = await db.select().from(inspectionItems).where(eq(inspectionItems.inspectionId, before.id));
  const key = (i: Pick<Item, 'section' | 'item'>) => i.section + '|' + i.item;
  const was = new Map(then.map(i => [key(i), i]));
  const changes = items.flatMap(i => {
    const b = was.get(key(i));
    if (!b?.condition || !i.condition || b.condition === i.condition) return [];
    return [{ section: i.section, item: i.item, before: b.condition, after: i.condition, worse: WORSE[i.condition] > WORSE[b.condition], beforePhoto: b.photos[0] ?? null, afterPhoto: i.photos[0] ?? null }];
  });
  return { ref: insRef(before.number), id: before.id, date: before.submittedAt ?? before.startedAt, worse: changes.filter(c => c.worse).length, better: changes.filter(c => !c.worse).length, changes };
}

export const priorityFor = (s: Severity | null): Priority => (s === 'Critical' ? 'Emergency' : s === 'High' ? 'High' : s === 'Low' ? 'Low' : 'Medium');
