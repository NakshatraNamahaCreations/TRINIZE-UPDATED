import { doublePrecision, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { associations, users } from './schema.js';

/*
 * Kept in tables of their own on purpose: every read of `users` and `associations` names all their columns,
 * so a new column there breaks sign-in until the migration runs. A missing table here only turns its feature off.
 *
 *   staff_presence  when a property manager last used the app — residents see "Online" while they are
 *   ai_budgets      a society's monthly AI spending cap, set by the operator; past it, AI features fall back to rules
 *   primary_vpms    the property manager residents see when a society has several (lib/vpm.ts)
 */

export const staffPresence = pgTable('staff_presence', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  seenAt: timestamp('seen_at', { withTimezone: true }).notNull(),
});

export const aiBudgets = pgTable('ai_budgets', {
  associationId: uuid('association_id').primaryKey().references(() => associations.id, { onDelete: 'cascade' }),
  /** US dollars per India-time calendar month */
  monthlyUsd: doublePrecision('monthly_usd').notNull(),
  updatedBy: text('updated_by').notNull().default(''),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const primaryVpms = pgTable('primary_vpms', {
  associationId: uuid('association_id').primaryKey().references(() => associations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});
