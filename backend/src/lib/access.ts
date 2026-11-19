import { and, eq, isNull, or } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { DB } from '../db/client.js';
import { staffRoles } from '../db/schema.js';
import { userIdFrom } from './auth.js';

/* Who may use which part of the society console.
   A society's admin has all of it. Anyone else on the team is given a list of sections (staff_roles.permissions);
   inside those they work as the office does, and every other section's routes answer "you don't have access".
   Like the plan guard, this only ever takes access away — sign-in and roles are still checked by each route. */

export const SECTIONS = [
  { key: 'assistant', name: 'Assistant', group: 'Overview' },
  { key: 'issues', name: 'Issues', group: 'Operations' },
  { key: 'maintenance', name: 'Maintenance', group: 'Operations' },
  { key: 'inspections', name: 'Inspections', group: 'Operations' },
  { key: 'gate', name: 'Gate', group: 'Operations' },
  { key: 'accounts', name: 'Accounts', group: 'Operations' },
  { key: 'owners', name: 'Owners', group: 'Operations' },
  { key: 'moderation', name: 'Moderation', group: 'Operations' },
  { key: 'communication', name: 'Communication', group: 'Engage' },
  { key: 'announcements', name: 'Announcements', group: 'Engage' },
  { key: 'events', name: 'Events & Polls', group: 'Engage' },
  { key: 'gallery', name: 'Gallery', group: 'Engage' },
  { key: 'users', name: 'Residents & flats', group: 'Manage' },
  { key: 'directory', name: 'Directory', group: 'Manage' },
  { key: 'ai', name: 'AI controls', group: 'Manage' },
  { key: 'audit', name: 'Audit log', group: 'Manage' },
] as const;
export type Section = (typeof SECTIONS)[number]['key'];
export const SECTION_KEYS = SECTIONS.map(s => s.key) as [Section, ...Section[]];

/** the routes under /v1/admin/:aid/ and the section each belongs to — holding any one of the listed sections opens it. First match wins. */
const ROUTES: [RegExp, Section[]][] = [
  [/^issues\/[^/]+\/suggestion$/, ['issues']],
  [/^(issues|approval-limit|vendors)\b/, ['issues', 'maintenance']],
  [/^(vendor-list|invoices|reports\/maintenance|follow-ups)\b/, ['maintenance']],
  [/^inspections\b/, ['inspections']],
  [/^(visits|guards|watchlist|gate-codes)\b/, ['gate']],
  [/^incidents\b/, ['gate']],
  [/^finance\b/, ['accounts']],
  [/^(owners|documents)\b/, ['owners']],
  [/^moderation-threshold\b/, ['moderation', 'ai']],
  [/^moderation\b/, ['moderation']],
  [/^(comms|conversations)\b/, ['communication']],
  [/^announcements\b/, ['announcements']],
  [/^(events|polls|event-suggestions)\b/, ['events']],
  [/^gallery\b/, ['gallery']],
  [/^(units|towers|users|members|search)\b/, ['users']],
  [/^ai-audit\b/, ['ai', 'assistant']],
  [/^(ai-settings|knowledge|facts)\b/, ['ai']],
  [/^directory\b/, ['directory']],
  [/^audit\b/, ['audit']],
  [/^assistant\b/, ['assistant']],
];
/** open to everyone on the team: the plan, writing to Trinize, and "what may I use?" */
const OPEN = /^(plan|support|setup|stats|staff\/me)\b/;

type Reader = Pick<DB, 'select'>;
const memory = new WeakMap<object, Map<string, { at: number; sections: Section[] | null }>>();
const mem = (db: object) => memory.get(db) ?? memory.set(db, new Map()).get(db)!;
/** call after changing anyone's access, so their next request sees it */
export const forgetAccess = (db: object) => mem(db).clear();

/** The sections this person is limited to in this society — or null when nothing limits them (an admin, an operator, a VPM, or someone who is not on the team at all, whom the route itself turns away). */
export async function sectionsOf(db: Reader, userId: string, associationId: string): Promise<Section[] | null> {
  const key = userId + ':' + associationId, hit = mem(db).get(key);
  if (hit && Date.now() - hit.at < 10_000) return hit.sections;
  const rows = await db.select({ role: staffRoles.role, permissions: staffRoles.permissions }).from(staffRoles)
    .where(and(eq(staffRoles.userId, userId), or(eq(staffRoles.associationId, associationId), isNull(staffRoles.associationId))));
  const sections = !rows.length || rows.some(r => r.role === 'operator' || r.role === 'vpm' || r.permissions === null)
    ? null
    : [...new Set(rows.flatMap(r => r.permissions ?? []))].filter((k): k is Section => (SECTION_KEYS as string[]).includes(k));
  mem(db).set(key, { at: Date.now(), sections });
  return sections;
}

const ADMIN = /^\/v1\/admin\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([^?]*)/i;
/** Runs before every society-console route. */
export const accessGuard = (db: Reader, secret: string) => async (req: FastifyRequest, reply: FastifyReply) => {
  const m = ADMIN.exec(req.url);
  if (!m || !req.headers.authorization) return;
  const [, aid, rest] = m as unknown as [string, string, string];
  if (OPEN.test(rest)) return;
  let userId: string;
  try { userId = await userIdFrom(req, secret); } catch { return; } // the route answers 401
  const mine = await sectionsOf(db, userId, aid);
  if (mine === null) return;
  // a route that belongs to no section (team management, anything added later) is for full admins only
  const needs = ROUTES.find(([re]) => re.test(rest))?.[1];
  if (!needs?.some(k => mine.includes(k))) {
    const name = needs ? SECTIONS.find(s => s.key === needs[0])!.name : 'This part of the console';
    return reply.status(403).send({ error: { code: 'no_access', message: `${name} isn’t part of your access. Ask your society admin to add it.`, section: needs?.[0] ?? null } });
  }
};
