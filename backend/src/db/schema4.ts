import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { issues, users, vendors } from './schema.js';

/* Maintenance, completed: the conversation inside a work order, and vendor invoices. */

const id = () => uuid('id').primaryKey().defaultRandom();
const at = (name = 'created_at') => timestamp(name, { withTimezone: true }).defaultNow().notNull();

/**
 * Messages inside one work order. `thread` keeps the two conversations apart: the resident talks with
 * the office, the vendor talks with the office — a resident never sees vendor pricing talk.
 */
export const issueMessages = pgTable('issue_messages', {
  id: id(),
  issueId: uuid('issue_id').notNull().references(() => issues.id, { onDelete: 'cascade' }),
  thread: text('thread').$type<'resident' | 'vendor'>().notNull(),
  fromUserId: uuid('from_user_id').references(() => users.id, { onDelete: 'set null' }),
  fromRole: text('from_role').$type<'resident' | 'staff' | 'vendor'>().notNull(),
  text: text('text').notNull().default(''),
  attachmentUrl: text('attachment_url'),
  createdAt: at(),
}, t => [index().on(t.issueId, t.createdAt)]);

/** a vendor's bill for a work order: Pending → Approved → Paid (or Rejected) */
export const issueInvoices = pgTable('issue_invoices', {
  id: id(),
  issueId: uuid('issue_id').notNull().references(() => issues.id, { onDelete: 'cascade' }),
  vendorId: uuid('vendor_id').notNull().references(() => vendors.id, { onDelete: 'cascade' }),
  /** rupees */
  amount: integer('amount').notNull(),
  fileUrl: text('file_url'),
  note: text('note').notNull().default(''),
  status: text('status').$type<'Pending' | 'Approved' | 'Paid' | 'Rejected'>().notNull().default('Pending'),
  decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: at(),
}, t => [index().on(t.issueId), index().on(t.vendorId)]);
