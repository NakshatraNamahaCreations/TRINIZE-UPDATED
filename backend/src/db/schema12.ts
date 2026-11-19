import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/* Settings that belong to the platform, not to any one society — today, what each plan includes. */

/** one row per setting; the value's shape is owned by the code that reads it (see lib/plans.ts) */
export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  updatedBy: text('updated_by').notNull().default(''),
});
