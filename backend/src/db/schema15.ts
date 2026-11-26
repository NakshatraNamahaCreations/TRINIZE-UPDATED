import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { associations, users } from './schema.js';

/** A staff member's own to-do notes for one society ("follow up with the lift AMC vendor") — the property manager's dashboard. Private to their writer. */
export const staffNotes = pgTable('staff_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  associationId: uuid('association_id').notNull().references(() => associations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  done: boolean('done').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, t => [index().on(t.associationId, t.userId)]);
