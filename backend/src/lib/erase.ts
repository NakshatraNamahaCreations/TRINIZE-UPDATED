import { eq } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import {
  activeDays, announcementAcks, blocks, chatMessages, devices, gratitudes, notifications, posts, reactions, refreshTokens, replies, rsvps, standings, unitMembers, users, userSettings, votes,
} from '../db/schema.js';

type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];

/**
 * Erase a resident's account for good — whether they asked (DPDP right to erasure) or the society
 * office removed them. Personal details and private content go, and every session ends. Issues stay
 * with the society as anonymous records, since the office still has to fix them: the user row is kept
 * for them and the audit log to point at, but nothing in it identifies anyone. There is no undo.
 */
export async function eraseAccount(tx: Tx, userId: string) {
  await tx.delete(posts).where(eq(posts.authorId, userId)); // replies on them cascade
  await tx.delete(replies).where(eq(replies.authorId, userId));
  await tx.delete(gratitudes).where(eq(gratitudes.fromId, userId));
  for (const t of [reactions, rsvps, votes, announcementAcks, notifications, devices, refreshTokens, activeDays, chatMessages, standings] as const) await tx.delete(t).where(eq(t.userId, userId));
  await tx.delete(userSettings).where(eq(userSettings.userId, userId));
  await tx.delete(blocks).where(eq(blocks.userId, userId));
  await tx.delete(unitMembers).where(eq(unitMembers.userId, userId));
  await tx.update(users).set({ name: 'Former resident', phone: null, email: null, passwordHash: null, deletedAt: new Date() }).where(eq(users.id, userId));
}
