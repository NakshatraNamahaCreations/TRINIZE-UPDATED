import { boolean, date, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { associations, units, users } from './schema.js';
import { journalEntries } from './schema7.js';

/* Owner portal: a read-only window for the people who own flats — what their flat earned and cost,
   the repairs on it, the documents shared with them. The office decides how much of it they see. */

const id = () => uuid('id').primaryKey().defaultRandom();
const at = (name = 'created_at') => timestamp(name, { withTimezone: true }).defaultNow().notNull();
const assoc = () => uuid('association_id').notNull().references(() => associations.id, { onDelete: 'cascade' });

export const OCCUPANCY = ['Owner-occupied', 'Rented', 'Vacant'] as const;
export type Occupancy = (typeof OCCUPANCY)[number];

/** what owners of this society may see and do — set by the office */
export type OwnerPortalSettings = {
  enabled: boolean;
  reports: { statement: boolean; transactions: boolean; expenses: boolean; societyAccounts: boolean };
  /** repairs on their flat, the conversation on them, and what they cost */
  showRequests: boolean; showMessages: boolean; showCosts: boolean;
  /** a repair on their flat estimated at or above this needs the owner's yes; 0 = owners are not asked */
  approveAbove: number;
};
export const DEFAULT_OWNER_PORTAL: OwnerPortalSettings = {
  enabled: true, reports: { statement: true, transactions: true, expenses: true, societyAccounts: false }, showRequests: true, showMessages: false, showCosts: true, approveAbove: 0,
};

export const DOCUMENT_KINDS = ['Lease', 'Insurance', 'Tax', 'Statement', 'Invoice', 'Notice', 'Other'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** files the office keeps: for one flat (its owners see it when shared) or for the whole society */
export const documents = pgTable('documents', {
  id: id(),
  associationId: assoc(),
  unitId: uuid('unit_id').references(() => units.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  kind: text('kind').$type<DocumentKind>().notNull().default('Other'),
  fileUrl: text('file_url').notNull(),
  /** shown in the owner portal */
  shared: boolean('shared').notNull().default(true),
  byName: text('by_name').notNull().default(''),
  createdAt: at(),
}, t => [index().on(t.associationId), index().on(t.unitId)]);

/** money paid out to a flat's owner from the rent collected for them */
export const ownerPayouts = pgTable('owner_payouts', {
  id: id(),
  associationId: assoc(),
  unitId: uuid('unit_id').notNull().references(() => units.id, { onDelete: 'cascade' }),
  amount: integer('amount').notNull(),
  paidOn: date('paid_on').notNull(),
  mode: text('mode').notNull().default('Bank transfer'),
  reference: text('reference').notNull().default(''),
  note: text('note').notNull().default(''),
  entryId: uuid('entry_id').references(() => journalEntries.id, { onDelete: 'set null' }),
  byName: text('by_name').notNull().default(''),
  createdAt: at(),
}, t => [index().on(t.unitId, t.paidOn)]);

/** what owners looked at — so the office can see the portal is being used, and by whom */
export const ownerActivity = pgTable('owner_activity', {
  id: id(),
  associationId: assoc(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  action: text('action').notNull(), // "Opened the dashboard", "Viewed the owner statement"
  createdAt: at(),
}, t => [index().on(t.associationId, t.createdAt)]);
