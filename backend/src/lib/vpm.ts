import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { primaryVpms as chosenVpms, staffRoles, users } from '../db/schema.js';

type Reader = Pick<DB, 'select'>;

/**
 * The property manager residents see for each society: the one the operator marked primary, while they are
 * still assigned there; otherwise the longest-standing manager (first account created). Societies with no
 * manager are left out.
 */
export async function primaryVpms(db: Reader, associationIds?: string[]): Promise<Map<string, string>> {
  const links = await db.select({ aid: staffRoles.associationId, userId: users.id }).from(staffRoles)
    .innerJoin(users, eq(users.id, staffRoles.userId))
    .where(and(eq(staffRoles.role, 'vpm'), isNull(users.deletedAt), associationIds ? inArray(staffRoles.associationId, associationIds) : undefined))
    .orderBy(asc(users.createdAt), asc(users.id));
  const aids = [...new Set(links.map(l => l.aid).filter((x): x is string => !!x))];
  // who the operator picked; before the migration has run there is no such table, and nobody has been picked
  let chosen: { id: string; primary: string }[] = [];
  try { chosen = aids.length ? await db.select({ id: chosenVpms.associationId, primary: chosenVpms.userId }).from(chosenVpms).where(inArray(chosenVpms.associationId, aids)) : []; } catch { chosen = []; }
  const out = new Map<string, string>();
  for (const aid of aids) {
    const here = links.filter(l => l.aid === aid).map(l => l.userId);
    const pick = chosen.find(c => c.id === aid)?.primary;
    out.set(aid, pick && here.includes(pick) ? pick : here[0]!);
  }
  return out;
}
