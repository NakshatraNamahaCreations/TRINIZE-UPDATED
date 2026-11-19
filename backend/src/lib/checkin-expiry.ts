import { and, eq, isNotNull, lt } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { visits } from '../db/schema.js';
import { visitChanged } from './gate-live.js';

/**
 * A self check-in (the visitor scanned the gate QR) waits ten minutes for the flat. After that the
 * request is over: nobody can approve it, and the visitor asks again or speaks to the guard. An old
 * request must not sit there to be approved long after the person has gone — or by a tap on a stale
 * notification the next day.
 *
 * Only the wait for an answer runs out. Once the flat has approved, the entry is the guard's to let in.
 */
export const SELF_CHECKIN_TTL_MS = 10 * 60_000;

export const selfCheckinExpiresAt = (v: { createdAt: Date }) => new Date(v.createdAt.getTime() + SELF_CHECKIN_TTL_MS);
/** still marked Pending, but its ten minutes are up — treat it as expired even before the sweep reaches it */
export const selfCheckinLapsed = (v: { status: string; selfToken: string | null; createdAt: Date }) =>
  v.status === 'Pending' && !!v.selfToken && selfCheckinExpiresAt(v).getTime() <= Date.now();

/** close every self check-in whose ten minutes are up, and tell the screens that were watching */
export async function expireSelfCheckins(db: DB) {
  const gone = await db.update(visits).set({ status: 'Expired', note: 'No answer from the flat in 10 minutes' })
    .where(and(eq(visits.status, 'Pending'), isNotNull(visits.selfToken), lt(visits.createdAt, new Date(Date.now() - SELF_CHECKIN_TTL_MS))))
    .returning({ associationId: visits.associationId, selfToken: visits.selfToken });
  gone.forEach(visitChanged);
  return gone.length;
}
