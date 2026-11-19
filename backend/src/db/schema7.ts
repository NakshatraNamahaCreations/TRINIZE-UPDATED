import { date, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { associations, units, users, vendors } from './schema.js';

/* Accounting. A double-entry ledger is the single source of truth: every bill, payment, expense and
   adjustment posts one balanced journal entry, and every report is read back from those lines.
   Amounts are whole rupees. */

const id = () => uuid('id').primaryKey().defaultRandom();
const at = (name = 'created_at') => timestamp(name, { withTimezone: true }).defaultNow().notNull();
const assoc = () => uuid('association_id').notNull().references(() => associations.id, { onDelete: 'cascade' });
const when = (name: string) => timestamp(name, { withTimezone: true });

export type AccountKind = 'asset' | 'liability' | 'equity' | 'income' | 'expense';
/** what the system needs to find: the bank, cash, what flats owe, what vendors are owed */
export type AccountRole = 'bank' | 'cash' | 'receivable' | 'payable' | 'deposit' | 'fund' | 'waiver' | 'opening' | 'owner_funds' | null;

export const accounts = pgTable('accounts', {
  id: id(),
  associationId: assoc(),
  code: text('code').notNull(), // "4000"
  name: text('name').notNull(),
  kind: text('kind').$type<AccountKind>().notNull(),
  role: text('role').$type<AccountRole>(),
  /** part of the starting chart: can be renamed, not removed */
  system: integer('system').notNull().default(0),
  active: integer('active').notNull().default(1),
}, t => [unique().on(t.associationId, t.code), index().on(t.associationId)]);

export type EntrySource = 'bill' | 'payment' | 'expense' | 'expense_payment' | 'journal' | 'waiver' | 'opening' | 'bank' | 'reversal' | 'application_fee';
export const journalEntries = pgTable('journal_entries', {
  id: id(),
  associationId: assoc(),
  number: integer('number').notNull(), // JV-1001
  /** the accounting date (not when it was typed) */
  date: date('date').notNull(),
  memo: text('memo').notNull().default(''),
  source: text('source').$type<EntrySource>().notNull(),
  sourceId: uuid('source_id'),
  /** set on the entry that undoes another, and on the one undone */
  reverses: uuid('reverses'),
  reversedBy: uuid('reversed_by'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  byName: text('by_name').notNull().default('System'),
  createdAt: at(),
}, t => [unique().on(t.associationId, t.number), index().on(t.associationId, t.date)]);

export const journalLines = pgTable('journal_lines', {
  id: id(),
  entryId: uuid('entry_id').notNull().references(() => journalEntries.id, { onDelete: 'cascade' }),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  debit: integer('debit').notNull().default(0),
  credit: integer('credit').notNull().default(0),
  /** the flat, on lines against "dues receivable" — this is the flat ledger */
  unitId: uuid('unit_id').references(() => units.id, { onDelete: 'set null' }),
  /** the vendor, on lines against "vendor payables" */
  vendorId: uuid('vendor_id').references(() => vendors.id, { onDelete: 'set null' }),
}, t => [index().on(t.entryId), index().on(t.accountId), index().on(t.unitId)]);

export const CHARGE_TYPES = ['Monthly maintenance', 'Rent', 'Parking', 'Water', 'Electricity', 'Sinking fund', 'Repair contribution', 'Penalty', 'Security deposit', 'Custom charge'] as const;
export type ChargeType = (typeof CHARGE_TYPES)[number];
export type BillMethod = 'flat' | 'sqft' | 'type' | 'custom';

/** one "generate bills" action: the month, the charge and how each flat's amount was worked out */
export const billRuns = pgTable('bill_runs', {
  id: id(),
  associationId: assoc(),
  period: text('period').notNull(), // "2026-11"
  chargeType: text('charge_type').$type<ChargeType>().notNull(),
  method: text('method').$type<BillMethod>().notNull(),
  /** flat: {amount} · sqft: {rate} · type: {byType: {"2BHK": 3500}} · custom: {byUnit: {unitId: amount}} */
  rate: jsonb('rate').$type<Record<string, unknown>>().notNull(),
  dueDate: date('due_date').notNull(),
  bills: integer('bills').notNull().default(0),
  total: integer('total').notNull().default(0),
  byName: text('by_name').notNull(),
  createdAt: at(),
}, t => [index().on(t.associationId, t.period)]);

export const bills = pgTable('bills', {
  id: id(),
  associationId: assoc(),
  unitId: uuid('unit_id').notNull().references(() => units.id, { onDelete: 'cascade' }),
  number: text('number').notNull(), // "BILL-2611-0042"
  period: text('period').notNull(),
  chargeType: text('charge_type').$type<ChargeType>().notNull(),
  description: text('description').notNull().default(''),
  amount: integer('amount').notNull(),
  paid: integer('paid').notNull().default(0),
  waived: integer('waived').notNull().default(0),
  dueDate: date('due_date').notNull(),
  cancelledAt: when('cancelled_at'),
  runId: uuid('run_id').references(() => billRuns.id, { onDelete: 'set null' }),
  entryId: uuid('entry_id').references(() => journalEntries.id, { onDelete: 'set null' }),
  /** a late fee is itself a bill; this points at the bill it was charged on, so it is charged once */
  lateFeeFor: uuid('late_fee_for'),
  createdAt: at(),
}, t => [unique().on(t.associationId, t.number), index().on(t.unitId), index().on(t.associationId, t.period)]);

export const PAYMENT_MODES = ['UPI', 'Payment gateway', 'Bank transfer', 'Cash', 'Cheque', 'Card'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export const payments = pgTable('payments', {
  id: id(),
  associationId: assoc(),
  unitId: uuid('unit_id').notNull().references(() => units.id, { onDelete: 'cascade' }),
  number: text('number').notNull(), // receipt number "RCP-000123"
  amount: integer('amount').notNull(),
  mode: text('mode').$type<PaymentMode>().notNull(),
  /** UPI / bank reference, or the gateway's payment id */
  reference: text('reference').notNull().default(''),
  chequeNo: text('cheque_no'),
  chequeDate: date('cheque_date'),
  chequeStatus: text('cheque_status').$type<'Pending' | 'Cleared' | 'Bounced'>(),
  receivedOn: date('received_on').notNull(),
  payerName: text('payer_name').notNull().default(''),
  note: text('note').notNull().default(''),
  /** who entered it: the office, or the resident paying in the app */
  source: text('source').$type<'office' | 'resident'>().notNull().default('office'),
  /** the bank or cash account it went into */
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  entryId: uuid('entry_id').references(() => journalEntries.id, { onDelete: 'set null' }),
  reversedAt: when('reversed_at'),
  reverseReason: text('reverse_reason'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  byName: text('by_name').notNull().default(''),
  createdAt: at(),
}, t => [unique().on(t.associationId, t.number), index().on(t.unitId), index().on(t.associationId, t.receivedOn)]);

/** which bills a payment settled; anything left over stays on the flat's ledger as an advance */
export const paymentAllocations = pgTable('payment_allocations', {
  paymentId: uuid('payment_id').notNull().references(() => payments.id, { onDelete: 'cascade' }),
  billId: uuid('bill_id').notNull().references(() => bills.id, { onDelete: 'cascade' }),
  amount: integer('amount').notNull(),
}, t => [primaryKey({ columns: [t.paymentId, t.billId] })]);

export type ExpenseStatus = 'Pending approval' | 'Approved' | 'Paid' | 'Rejected';
export const expenses = pgTable('expenses', {
  id: id(),
  associationId: assoc(),
  number: text('number').notNull(), // "EXP-0042"
  vendorId: uuid('vendor_id').references(() => vendors.id, { onDelete: 'set null' }),
  payee: text('payee').notNull(),
  /** the expense head */
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  amount: integer('amount').notNull(),
  date: date('date').notNull(),
  description: text('description').notNull().default(''),
  billNo: text('bill_no').notNull().default(''),
  receiptUrl: text('receipt_url'),
  status: text('status').$type<ExpenseStatus>().notNull().default('Pending approval'),
  decidedByName: text('decided_by_name'),
  decidedAt: when('decided_at'),
  paidOn: date('paid_on'),
  paidFrom: uuid('paid_from').references(() => accounts.id),
  paymentMode: text('payment_mode').$type<PaymentMode>(),
  reference: text('reference').notNull().default(''),
  /** posted when approved (expense ↔ payable) and when paid (payable ↔ bank) */
  entryId: uuid('entry_id').references(() => journalEntries.id, { onDelete: 'set null' }),
  payEntryId: uuid('pay_entry_id').references(() => journalEntries.id, { onDelete: 'set null' }),
  /** the maintenance invoice this came from, so it is never entered twice */
  issueInvoiceId: uuid('issue_invoice_id'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  byName: text('by_name').notNull().default(''),
  createdAt: at(),
}, t => [unique().on(t.associationId, t.number), index().on(t.associationId, t.date), index().on(t.issueInvoiceId)]);

/** lines read from an uploaded bank statement, and what each was matched to */
export const bankLines = pgTable('bank_lines', {
  id: id(),
  associationId: assoc(),
  accountId: uuid('account_id').notNull().references(() => accounts.id),
  date: date('date').notNull(),
  description: text('description').notNull().default(''),
  reference: text('reference').notNull().default(''),
  /** money out / money in */
  debit: integer('debit').notNull().default(0),
  credit: integer('credit').notNull().default(0),
  balance: integer('balance'),
  status: text('status').$type<'Unmatched' | 'Matched' | 'Ignored'>().notNull().default('Unmatched'),
  matchedType: text('matched_type').$type<'payment' | 'expense' | 'entry'>(),
  matchedId: uuid('matched_id'),
  matchedHow: text('matched_how').$type<'auto' | 'manual'>(),
  batch: uuid('batch').notNull(),
  createdAt: at(),
}, t => [index().on(t.associationId, t.date), index().on(t.batch)]);

/** a month the books are closed for: nothing dated in it can be added, changed or reversed */
export const periodLocks = pgTable('period_locks', {
  associationId: assoc(),
  period: text('period').notNull(), // "2026-10"
  byName: text('by_name').notNull(),
  lockedAt: at('locked_at'),
}, t => [primaryKey({ columns: [t.associationId, t.period] })]);

/** the society's own rules for dues */
export type AccountingSettings = {
  allowPartial: boolean;
  /** charged once per overdue bill, `graceDays` after its due date */
  lateFee: { kind: 'none' | 'flat' | 'percent'; value: number; graceDays: number };
  /** expenses above this need approval before they post; 0 = every expense */
  approvalAbove: number;
  /** shown to residents who pay by transfer */
  upiId: string; bankDetails: string;
};
export const DEFAULT_ACCOUNTING: AccountingSettings = { allowPartial: true, lateFee: { kind: 'none', value: 0, graceDays: 5 }, approvalAbove: 0, upiId: '', bankDetails: '' };
