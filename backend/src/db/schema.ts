import { boolean, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type { AccountingSettings } from './schema7.js';
import type { Occupancy, OwnerPortalSettings } from './schema8.js';
import type { LeasingSettings } from './schema11.js';

/* Phase 1 schema — tenancy, people, sign-in, notices, events, polls, directory, issues, audit.
   Every community record carries association_id; the API scopes every query by it. */

const id = () => uuid('id').primaryKey().defaultRandom();
const at = (name = 'created_at') => timestamp(name, { withTimezone: true }).defaultNow().notNull();
const assoc = () => uuid('association_id').notNull().references(() => associations.id, { onDelete: 'cascade' });

export type MemberRole = 'Owner' | 'Tenant' | 'Family';
/** vpm = Virtual Property Manager: created by the operator, assigned to one or more societies, manages them from the app */
export type StaffRole = 'operator' | 'admin' | 'committee' | 'moderator' | 'vpm' | 'guard' | 'auditor';
export type Priority = 'Low' | 'Medium' | 'High' | 'Emergency';
export type IssueStatus = 'Submitted' | 'Acknowledged' | 'Assigned' | 'In Progress' | 'On Hold' | 'Resolved' | 'Closed';
/** where the vendor is with the job — separate from the ticket's own status */
export type VendorState = 'Assigned' | 'Accepted' | 'Scheduled' | 'Visited' | 'Completed';
export type ApprovalState = 'none' | 'pending' | 'approved' | 'rejected';

/* ---------- tenancy ---------- */
export const associations = pgTable('associations', {
  id: id(),
  name: text('name').notNull(),
  short: text('short').notNull(),
  city: text('city').notNull(),
  /** how strict the abuse guard is for this society — set from the admin console */
  moderationThreshold: text('moderation_threshold').$type<'Lenient' | 'Standard' | 'Strict'>().notNull().default('Standard'),
  /** repairs estimated above this (rupees) need the committee's approval before work starts */
  approvalLimit: integer('approval_limit').notNull().default(5000),
  /** dues rules: part payments, late fee, expense approval, how residents pay by transfer */
  accounting: jsonb('accounting').$type<Partial<AccountingSettings>>(),
  /** what flat owners may see in the owner portal */
  ownerPortal: jsonb('owner_portal').$type<Partial<OwnerPortalSettings>>(),
  /** application and screening fees, the documents an applicant must give, lease defaults */
  leasing: jsonb('leasing').$type<Partial<LeasingSettings>>(),
  /** the order the office wants its towers and blocks shown in; one not listed yet follows, in name order */
  towerOrder: jsonb('tower_order').$type<string[]>(),
  createdAt: at(),
});

export * from './schema2.js';
export * from './schema3.js';
export * from './schema4.js';
export * from './schema5.js';
export * from './schema6.js';
export * from './schema7.js';
export * from './schema8.js';
export * from './schema9.js';
export * from './schema10.js';
export * from './schema11.js';
export * from './schema12.js';
export * from './schema13.js';
export * from './schema14.js';
export * from './schema15.js';
export * from './schema16.js';
export * from './schema17.js';

/* ---------- people ---------- */
export const units = pgTable('units', {
  id: id(),
  associationId: assoc(),
  code: text('code').notNull(), // "T4-1108"
  tower: text('tower').notNull(), // "Tower 4"
  label: text('label').notNull(), // "Tower 4, Flat 1108"
  /** for billing by area or by flat type */
  area: integer('area').notNull().default(0), // square feet
  flatType: text('flat_type').notNull().default(''), // "2BHK"
  /** for the owner portal: who lives there, the rent when let, and when the lease ends */
  occupancy: text('occupancy').$type<Occupancy>().notNull().default('Owner-occupied'),
  monthlyRent: integer('monthly_rent').notNull().default(0),
  leaseEnd: date('lease_end'),
}, t => [unique().on(t.associationId, t.code)]);

export const users = pgTable('users', {
  id: id(),
  name: text('name').notNull(),
  /** 10-digit Indian mobile; residents sign in with it */
  phone: text('phone').unique(),
  /** staff sign in with email + password */
  email: text('email').unique(),
  passwordHash: text('password_hash'),
  /** staff two-step sign-in: the authenticator secret, and whether it has been confirmed */
  totpSecret: text('totp_secret'),
  totpEnabled: boolean('totp_enabled').notNull().default(false),
  createdAt: at(),
  /** account deletion: personal fields are wiped and the row kept only so history stays consistent */
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const unitMembers = pgTable('unit_members', {
  id: id(),
  unitId: uuid('unit_id').notNull().references(() => units.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').$type<MemberRole>().notNull(),
  /** "pending" until the society office verifies a newly added member */
  status: text('status').$type<'active' | 'pending'>().notNull().default('active'),
  createdAt: at(),
}, t => [unique().on(t.unitId, t.userId), index().on(t.userId)]);

export const staffRoles = pgTable('staff_roles', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  /** null for Trinize operators, who see every association */
  associationId: uuid('association_id').references(() => associations.id, { onDelete: 'cascade' }),
  role: text('role').$type<StaffRole>().notNull(),
  title: text('title'), // "Secretary"
  /** the console sections this person may use (see lib/access.ts); null = everything their role allows */
  permissions: jsonb('permissions').$type<string[]>(),
}, t => [index().on(t.userId)]);

/* ---------- sign-in ---------- */
export const otpCodes = pgTable('otp_codes', {
  id: id(),
  phone: text('phone').notNull(),
  codeHash: text('code_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  attempts: integer('attempts').notNull().default(0),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: at(),
}, t => [index().on(t.phone, t.createdAt)]);

export const refreshTokens = pgTable('refresh_tokens', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: at(),
}, t => [index().on(t.userId)]);

/* ---------- notices ---------- */
export const announcements = pgTable('announcements', {
  id: id(),
  associationId: assoc(),
  ref: text('ref').notNull(), // "AN-118"
  title: text('title').notNull(),
  body: text('body').notNull(),
  priority: text('priority').$type<'High' | 'Normal'>().notNull().default('Normal'),
  audience: text('audience').notNull().default('All residents'),
  requiresAck: boolean('requires_ack').notNull().default(false),
  byName: text('by_name').notNull(),
  icon: text('icon').notNull().default('megaphone-outline'),
  publishedAt: at('published_at'),
  /* set when the notice came from the communication hub (schema6 `messages`) */
  type: text('type').notNull().default('Announcement'),
  /** shown from / hidden after; expired notices stay in the office's record */
  startsAt: timestamp('starts_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  pinned: boolean('pinned').notNull().default(false),
  attachmentUrl: text('attachment_url'),
  attachmentName: text('attachment_name'),
  /** the hub message behind it; only the residents that message was delivered to see the notice */
  messageId: uuid('message_id'),
}, t => [unique().on(t.associationId, t.ref)]);

export const announcementAcks = pgTable('announcement_acks', {
  announcementId: uuid('announcement_id').notNull().references(() => announcements.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: at(),
}, t => [primaryKey({ columns: [t.announcementId, t.userId] })]);

/* ---------- events ---------- */
export const events = pgTable('events', {
  id: id(),
  associationId: assoc(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  location: text('location').notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  minutes: integer('minutes').notNull(),
  capacity: integer('capacity').notNull(),
  /** people counted before the app (sign-up sheets) — real RSVPs are added on top */
  baseGoing: integer('base_going').notNull().default(0),
  icon: text('icon').notNull().default('calendar-outline'),
}, t => [index().on(t.associationId, t.startsAt)]);

export const rsvps = pgTable('rsvps', {
  eventId: uuid('event_id').notNull().references(() => events.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: text('status').$type<'Going' | 'Waitlist'>().notNull(),
  createdAt: at(),
}, t => [primaryKey({ columns: [t.eventId, t.userId] })]);

/* ---------- polls ---------- */
export const polls = pgTable('polls', {
  id: id(),
  associationId: assoc(),
  question: text('question').notNull(),
  eligibility: text('eligibility').$type<'all' | 'owners'>().notNull().default('all'),
  closesAt: timestamp('closes_at', { withTimezone: true }).notNull(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  createdAt: at(),
});

export const pollOptions = pgTable('poll_options', {
  id: id(),
  pollId: uuid('poll_id').notNull().references(() => polls.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  position: integer('position').notNull(),
  /** votes cast before the app — real votes are counted on top */
  baseVotes: integer('base_votes').notNull().default(0),
});

/** one vote per unit per poll, enforced by the primary key */
export const votes = pgTable('votes', {
  pollId: uuid('poll_id').notNull().references(() => polls.id, { onDelete: 'cascade' }),
  unitId: uuid('unit_id').notNull().references(() => units.id, { onDelete: 'cascade' }),
  optionId: uuid('option_id').notNull().references(() => pollOptions.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: at(),
}, t => [primaryKey({ columns: [t.pollId, t.unitId] })]);

/* ---------- directory ---------- */
export const contacts = pgTable('contacts', {
  id: id(),
  associationId: assoc(),
  group: text('group').$type<'committee' | 'emergency' | 'vendors'>().notNull(),
  name: text('name').notNull(),
  role: text('role').notNull(),
  phone: text('phone').notNull(),
  position: integer('position').notNull().default(0),
});

/* ---------- issues ---------- */
export const vendors = pgTable('vendors', {
  id: id(),
  associationId: assoc(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  /** the vendor's own login (phone + OTP) — they see only the work orders assigned to them */
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  contact: text('contact').notNull().default(''),
  phone: text('phone').notNull().default(''),
  email: text('email').notNull().default(''),
  serviceArea: text('service_area').notNull().default(''),
  active: boolean('active').notNull().default(true),
});

export const issues = pgTable('issues', {
  id: id(),
  associationId: assoc(),
  /** per-society running number — shown as ISS-1043 */
  number: integer('number').notNull(),
  title: text('title').notNull(),
  category: text('category').notNull(),
  location: text('location').notNull(),
  priority: text('priority').$type<Priority>().notNull(),
  status: text('status').$type<IssueStatus>().notNull().default('Submitted'),
  unitId: uuid('unit_id').references(() => units.id, { onDelete: 'set null' }),
  reporterId: uuid('reporter_id').references(() => users.id, { onDelete: 'set null' }),
  vendorId: uuid('vendor_id').references(() => vendors.id, { onDelete: 'set null' }),
  via: text('via').$type<'chat' | 'form' | 'admin'>().notNull(),
  slaDueAt: timestamp('sla_due_at', { withTimezone: true }).notNull(),
  rating: integer('rating'),
  /** unit = someone's flat; common = lift, STP, generator, corridor lights… (no unit needed) */
  scope: text('scope').$type<'unit' | 'common'>().notNull().default('unit'),
  /** the common-area asset, e.g. "Lift", "STP", "Generator" */
  asset: text('asset'),
  vendorState: text('vendor_state').$type<VendorState>(),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  /** when the work is expected to be finished — set at assignment */
  dueAt: timestamp('due_at', { withTimezone: true }),
  /** rupees */
  costEstimate: integer('cost_estimate'),
  costActual: integer('cost_actual'),
  approval: text('approval').$type<ApprovalState>().notNull().default('none'),
  approvalBy: uuid('approval_by').references(() => users.id, { onDelete: 'set null' }),
  /** a repair on a flat, above the society's owner limit, also waits for the flat's owner */
  ownerApproval: text('owner_approval').$type<ApprovalState>().notNull().default('none'),
  /** entry instructions for the vendor: "call before coming", "key with security" */
  accessNote: text('access_note'),
  /** last time anyone moved or wrote on the ticket — drives the 24-hour vendor reminder */
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).defaultNow().notNull(),
  lastReminderAt: timestamp('last_reminder_at', { withTimezone: true }),
  escalatedAt: timestamp('escalated_at', { withTimezone: true }),
  createdAt: at(),
}, t => [unique().on(t.associationId, t.number), index().on(t.associationId, t.status), index().on(t.reporterId)]);

/** the public timeline residents see */
export const issueEvents = pgTable('issue_events', {
  id: id(),
  issueId: uuid('issue_id').notNull().references(() => issues.id, { onDelete: 'cascade' }),
  status: text('status').$type<IssueStatus>().notNull(),
  note: text('note'),
  byUserId: uuid('by_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAt: at(),
}, t => [index().on(t.issueId)]);

/** resident comments and photos on their ticket */
export const issueUpdates = pgTable('issue_updates', {
  id: id(),
  issueId: uuid('issue_id').notNull().references(() => issues.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  text: text('text').notNull().default(''),
  photoUrl: text('photo_url'),
  createdAt: at(),
}, t => [index().on(t.issueId)]);

/** staff-only notes — never returned by resident endpoints */
export const issueNotes = pgTable('issue_notes', {
  id: id(),
  issueId: uuid('issue_id').notNull().references(() => issues.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  text: text('text').notNull(),
  createdAt: at(),
}, t => [index().on(t.issueId)]);

/* ---------- audit ---------- */
export const auditLog = pgTable('audit_log', {
  id: id(),
  associationId: uuid('association_id').references(() => associations.id, { onDelete: 'cascade' }),
  actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
  actor: text('actor').notNull(), // display name or "System"
  action: text('action').notNull(),
  createdAt: at(),
}, t => [index().on(t.associationId, t.createdAt)]);
