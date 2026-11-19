import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { associations, units, users } from './schema.js';
import { journalEntries } from './schema7.js';

/* Leasing: from "someone wants this flat" to "they live here". An application (the form, its
   documents, the fee, consent), the screening done on it, the lease made from it and signed
   electronically, and the conversion of the applicant into a tenant. */

const id = () => uuid('id').primaryKey().defaultRandom();
const at = (name = 'created_at') => timestamp(name, { withTimezone: true }).defaultNow().notNull();
const assoc = () => uuid('association_id').notNull().references(() => associations.id, { onDelete: 'cascade' });
const when = (name: string) => timestamp(name, { withTimezone: true });

/** what a society charges and asks for; kept on the association */
export type LeasingSettings = {
  applicationFee: number; feeRefundable: boolean;
  screeningFee: number; screeningPaidBy: 'applicant' | 'society';
  /** kinds of document an application cannot be submitted without */
  requiredDocs: DocKind[];
  /** deposit suggested on a new lease, in months of rent */
  depositMonths: number;
  /** how long a signing link works */
  signDays: number;
};
export const DOC_KINDS = ['ID proof', 'Address proof', 'Photo', 'Salary slip', 'Bank statement', 'Employment proof', 'ITR / Form 16', 'Police verification', 'Society NOC', 'Stamp paper', 'Other'] as const;
export type DocKind = (typeof DOC_KINDS)[number];
export const DEFAULT_LEASING: LeasingSettings = { applicationFee: 0, feeRefundable: false, screeningFee: 0, screeningPaidBy: 'applicant', requiredDocs: ['ID proof', 'Address proof'], depositMonths: 2, signDays: 14 };

export const APPLICATION_STATUSES = ['Draft', 'Fee Pending', 'Submitted', 'Under Review', 'Screening Pending', 'More Info Required', 'Approved', 'Rejected', 'Lease Sent', 'Lease Signed', 'Converted to Tenant', 'Withdrawn'] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
export const SOURCES = ['Walk-in', 'Broker', 'Referral', 'WhatsApp', 'Website', 'Other'] as const;
export type Source = (typeof SOURCES)[number];

/** what the applicant fills in; every part is optional until they submit */
export type ApplicationForm = {
  dob?: string; idType?: 'Aadhaar' | 'PAN' | 'Passport' | 'Voter ID' | 'Driving licence'; idNumber?: string;
  employment?: { kind?: 'Salaried' | 'Self-employed' | 'Student' | 'Retired' | 'Other'; company?: string; designation?: string; monthlyIncome?: number };
  residence?: { address?: string; months?: number; landlordName?: string; landlordPhone?: string; landlordEmail?: string; reason?: string };
  permanentAddress?: string;
  coApplicants?: { name: string; relation: string; phone?: string }[];
  vehicles?: string; pets?: string; occupants?: number; moveIn?: string;
  /** self-declarations */
  noCriminalCase?: boolean; noRentalDispute?: boolean;
};

export type CheckStatus = 'Pending' | 'Verified' | 'Flagged' | 'Unable to verify';
/** one line of the screening checklist: what was found, who said so, and when */
export type Check = { status: CheckStatus; note?: string; by?: string; at?: string };
export type Screening = {
  identity?: Check;
  income?: Check & { monthlyIncome?: number; employer?: string };
  financial?: Check & { creditScore?: number; defaults?: number; overdueLoans?: number };
  rental?: Check & { verdict?: 'Positive' | 'Neutral' | 'Negative' };
  police?: Check;
};
/** what a previous landlord said through their link */
export type Reference = { name: string; paidOnTime: 'Yes' | 'Mostly' | 'No'; damage: boolean; disputes: boolean; noticeGiven: boolean; wouldRentAgain: boolean; comments: string; at: string };

export const applications = pgTable('applications', {
  id: id(),
  associationId: assoc(),
  number: integer('number').notNull(), // shown as APP-101
  unitId: uuid('unit_id').notNull().references(() => units.id, { onDelete: 'cascade' }),
  /** the applicant's link carries this; whoever holds it can read and fill in this one application */
  token: text('token').notNull().unique(),
  status: text('status').$type<ApplicationStatus>().notNull().default('Draft'),
  name: text('name').notNull(),
  phone: text('phone').notNull(),
  email: text('email'),
  source: text('source').$type<Source>().notNull().default('Walk-in'),
  brokerName: text('broker_name').notNull().default(''),
  form: jsonb('form').$type<ApplicationForm>().notNull(),
  /** rent the flat is offered at */
  rent: integer('rent').notNull().default(0),

  /* the fee: application + screening (when the applicant pays for it) */
  feeAmount: integer('fee_amount').notNull().default(0),
  feeRefundable: boolean('fee_refundable').notNull().default(false),
  feeStatus: text('fee_status').$type<'Not required' | 'Pending' | 'Paid' | 'Refunded'>().notNull().default('Not required'),
  feeMode: text('fee_mode'),
  feeReference: text('fee_reference').notNull().default(''),
  feePaidAt: when('fee_paid_at'),
  feeEntryId: uuid('fee_entry_id').references(() => journalEntries.id, { onDelete: 'set null' }),

  /* consent to verification — nothing is checked without it */
  consentAt: when('consent_at'),
  consentIp: text('consent_ip'),
  consentAgent: text('consent_agent'),

  /* screening */
  screening: jsonb('screening').$type<Screening>().notNull(),
  referenceToken: text('reference_token').unique(),
  reference: jsonb('reference').$type<Reference>(),
  /** what the office asked the applicant to fix, when status is More Info Required */
  infoRequest: text('info_request').notNull().default(''),

  decidedByName: text('decided_by_name'),
  decidedAt: when('decided_at'),
  decisionReason: text('decision_reason').notNull().default(''),
  /** the tenant this became */
  tenantUserId: uuid('tenant_user_id').references(() => users.id, { onDelete: 'set null' }),
  submittedAt: when('submitted_at'),
  createdByName: text('created_by_name').notNull().default(''),
  createdAt: at(),
}, t => [unique().on(t.associationId, t.number), index().on(t.associationId, t.status), index().on(t.associationId, t.phone)]);

export const applicationDocuments = pgTable('application_documents', {
  id: id(),
  applicationId: uuid('application_id').notNull().references(() => applications.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<DocKind>().notNull(),
  fileUrl: text('file_url').notNull(),
  uploadedBy: text('uploaded_by').$type<'applicant' | 'office'>().notNull(),
  /** the office's check of this one file */
  verdict: text('verdict').$type<'Verified' | 'Rejected'>(),
  verdictNote: text('verdict_note').notNull().default(''),
  verdictByName: text('verdict_by_name'),
  createdAt: at(),
}, t => [index().on(t.applicationId)]);

/** everything that happened to one application, in order — its own audit trail */
export const applicationEvents = pgTable('application_events', {
  id: id(),
  applicationId: uuid('application_id').notNull().references(() => applications.id, { onDelete: 'cascade' }),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  createdAt: at(),
}, t => [index().on(t.applicationId, t.createdAt)]);

/** a society's own lease wording; {{tenant_name}}, {{rent}}… are filled in from the application */
export const leaseTemplates = pgTable('lease_templates', {
  id: id(),
  associationId: assoc(),
  name: text('name').notNull(),
  body: text('body').notNull(),
  /** the original Word or PDF, kept for reference when one was uploaded */
  fileUrl: text('file_url'),
  byName: text('by_name').notNull().default(''),
  createdAt: at(),
}, t => [index().on(t.associationId)]);

export type SignerRole = 'Tenant' | 'Owner' | 'Witness';
export type Signer = {
  role: SignerRole; name: string; phone?: string; email?: string; token: string;
  signedAt?: string; signedName?: string; /** the drawn signature, a small PNG data URL */ signature?: string; ip?: string; agent?: string;
};
export type LeaseStatus = 'Draft' | 'Sent' | 'Partly signed' | 'Signed' | 'Cancelled';

export const leases = pgTable('leases', {
  id: id(),
  associationId: assoc(),
  number: integer('number').notNull(), // shown as LSE-101
  applicationId: uuid('application_id').notNull().references(() => applications.id, { onDelete: 'cascade' }),
  unitId: uuid('unit_id').notNull().references(() => units.id, { onDelete: 'cascade' }),
  templateName: text('template_name').notNull(),
  /** the wording with every field filled in — what the signers read and sign */
  body: text('body').notNull(),
  rent: integer('rent').notNull(),
  deposit: integer('deposit').notNull().default(0),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  signingOrder: text('signing_order').$type<'tenant_first' | 'owner_first' | 'parallel'>().notNull().default('tenant_first'),
  signers: jsonb('signers').$type<Signer[]>().notNull(),
  status: text('status').$type<LeaseStatus>().notNull().default('Draft'),
  sentAt: when('sent_at'),
  expiresAt: when('expires_at'),
  lastReminderAt: when('last_reminder_at'),
  signedAt: when('signed_at'),
  /** the stored record of the signed lease (or a scan, when it was signed on paper) */
  signedFileUrl: text('signed_file_url'),
  signedOnPaper: boolean('signed_on_paper').notNull().default(false),
  editedByName: text('edited_by_name'),
  byName: text('by_name').notNull().default(''),
  createdAt: at(),
}, t => [unique().on(t.associationId, t.number), index().on(t.associationId, t.status), index().on(t.applicationId)]);
