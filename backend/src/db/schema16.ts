import { boolean, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { associations, users } from './schema.js';

/*
 * What the AI costs, and answers it doesn't need to write twice.
 *
 *   ai_usage         one row per model call (or per answer served from the store): the tokens it used and who it
 *                    was for. Counts only — never the prompt or the reply. Priced at read time from AI_PRICES.
 *   ai_answer_cache  the Community Assistant's answers to questions about the society's shared information,
 *                    keyed by a hash of everything the model was shown. No question text, nothing about who asked.
 */

export const aiUsage = pgTable('ai_usage', {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  /** whose request it was; null when it ran outside a signed-in request */
  associationId: uuid('association_id').references(() => associations.id, { onDelete: 'set null' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  /** answer · moderate · rewrite · compose · extract:<name> */
  feature: text('feature').notNull(),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull().default(0),
  /** the part of the input the provider billed at its cached-input rate */
  cachedInputTokens: integer('cached_input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  /** served from ai_answer_cache: no model call, no tokens */
  fromCache: boolean('from_cache').notNull().default(false),
}, t => [index().on(t.createdAt), index().on(t.associationId, t.createdAt)]);

export const aiAnswerCache = pgTable('ai_answer_cache', {
  /** sha-256 of the society, the hour, the question and the exact shared documents the model was given */
  key: text('key').primaryKey(),
  associationId: uuid('association_id').notNull().references(() => associations.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  sources: jsonb('sources').$type<string[]>().notNull(),
  hits: integer('hits').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, t => [index().on(t.associationId), index().on(t.expiresAt)]);
