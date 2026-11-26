import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { staffPresence } from '../db/schema.js';

/* When a property manager last used the app, so residents can see they are online. Written at most once a
   minute per person; any failure (a migration not yet run) just leaves presence unknown. */

const ONLINE_MS = 5 * 60_000;
const THROTTLE_MS = 60_000;
const lastWrite = new WeakMap<object, Map<string, number>>();

/** note that this person is using the app now */
export async function seen(db: Pick<DB, 'insert'>, userId: string, now = Date.now()) {
  const mine = lastWrite.get(db) ?? lastWrite.set(db, new Map()).get(db)!;
  if (now - (mine.get(userId) ?? 0) < THROTTLE_MS) return;
  mine.set(userId, now);
  try {
    const at = new Date(now);
    await db.insert(staffPresence).values({ userId, seenAt: at }).onConflictDoUpdate({ target: staffPresence.userId, set: { seenAt: at } });
  } catch { /* presence is a nicety: never fail a request over it */ }
}

/** were they in the app in the last few minutes? false when unknown */
export async function isOnline(db: Pick<DB, 'select'>, userId: string, now = Date.now()): Promise<boolean> {
  try {
    const [p] = await db.select({ at: staffPresence.seenAt }).from(staffPresence).where(eq(staffPresence.userId, userId));
    return !!p && now - p.at.getTime() < ONLINE_MS;
  } catch {
    return false;
  }
}
