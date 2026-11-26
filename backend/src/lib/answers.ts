import { createHash } from 'node:crypto';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { aiAnswerCache } from '../db/schema.js';
import type { Doc } from './ai.js';
import { usageSink } from './usage.js';

/*
 * The Community Assistant's stored answers — so "what are the pool timings?" asked by twenty residents is
 * written by the model once.
 *
 * Only questions about the society's shared information are stored, and whether a question qualifies is
 * decided here, in code, before any model call — never from what the model says it used. A qualifying
 * question is answered from the shared documents alone, with no chat history and none of the resident's own
 * records, so nothing personal can be in what is stored. The key is a hash of the society, the hour, the
 * question and the exact documents the model was shown: when the office edits a document, posts a notice or
 * an event changes, the key changes and the old answer is simply never found again. Answers last until the
 * end of the hour (the model is told the time of day), and nothing about who asked is kept.
 */

/** the resident is asking about themselves — their dues, their flat, their visitors */
export const FIRST_PERSON = /\b(my|mine|i|me|our|we|mera|meri|mere|nanna)\b|मेरा|मेरी|ನನ್ನ/i;
/** a follow-up that only makes sense after the previous message ("and on Sunday?", "is it open?") */
const FOLLOW_UP = /^\s*(and|also|what about|how about|then|so|but|ok|okay|same)\b|\b(it|that|this|those|these|they|them|he|she|his|her)\b/i;

/** can this question's answer be shared with other residents of the society? */
export function shareable(question: string, personalTopic: boolean): boolean {
  const words = question.trim().split(/\s+/).filter(Boolean);
  return words.length >= 3 && !personalTopic && !FIRST_PERSON.test(question) && !FOLLOW_UP.test(question);
}

const IST = 330 * 60_000;
/** trim, lower-case and collapse spaces only — punctuation is kept, so questions in Hindi or Kannada never collide */
const normal = (q: string) => q.trim().toLowerCase().replace(/\s+/g, ' ');

export function answerKey(associationId: string, question: string, docs: Doc[], now = Date.now()) {
  const hour = new Date(now + IST).toISOString().slice(0, 13); // e.g. 2026-11-25T10, India time
  return createHash('sha256').update(JSON.stringify([associationId, hour, normal(question), docs.map(d => [d.title, d.section, d.body])])).digest('hex');
}
/** the end of the current India-time hour */
const endOfHour = (now = Date.now()) => new Date(Math.floor((now + IST) / 3_600_000 + 1) * 3_600_000 - IST);

type Db = Pick<DB, 'select' | 'insert' | 'update' | 'delete'>;

/** a stored answer for this key, if there is one that hasn't expired; any failure is a miss */
export async function storedAnswer(db: Db, key: string): Promise<{ text: string; sources: string[] } | null> {
  try {
    const [row] = await db.select({ text: aiAnswerCache.text, sources: aiAnswerCache.sources }).from(aiAnswerCache)
      .where(and(eq(aiAnswerCache.key, key), gt(aiAnswerCache.expiresAt, new Date())));
    if (!row) return null;
    await db.update(aiAnswerCache).set({ hits: sql`${aiAnswerCache.hits} + 1` }).where(eq(aiAnswerCache.key, key));
    await usageSink(db)({ feature: 'answer', model: '(stored answer)', inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, fromCache: true });
    return row;
  } catch (e) {
    console.warn(`[ai] answer store unavailable: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/** keep an answer for the rest of the hour, and clear out the expired ones; a failure just means it isn't kept */
export async function storeAnswer(db: Db, associationId: string, key: string, answer: { text: string; sources: string[] }) {
  try {
    await db.delete(aiAnswerCache).where(lt(aiAnswerCache.expiresAt, new Date()));
    await db.insert(aiAnswerCache).values({ key, associationId, text: answer.text, sources: answer.sources, expiresAt: endOfHour() }).onConflictDoNothing();
  } catch (e) {
    console.warn(`[ai] answer not stored: ${e instanceof Error ? e.message : e}`);
  }
}
