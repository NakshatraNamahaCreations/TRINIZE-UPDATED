import type { DB } from '../db/client.js';
import { auditLog } from '../db/schema.js';

type Writer = Pick<DB, 'insert'>;

/** Append-only record of who did what — shown in the Society Admin audit log. */
export async function audit(db: Writer, associationId: string | null, actorId: string | null, actor: string, action: string) {
  await db.insert(auditLog).values({ associationId, actorId, actor, action });
}
