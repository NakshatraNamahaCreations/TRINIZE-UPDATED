import { boolean, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { associations, users } from './schema.js';

/* Phase 3 (assistant) and Phase 4 (operator portal) schema. */

const id = () => uuid('id').primaryKey().defaultRandom();
const at = (name = 'created_at') => timestamp(name, { withTimezone: true }).defaultNow().notNull();
const assoc = () => uuid('association_id').notNull().references(() => associations.id, { onDelete: 'cascade' });

/* ================= Phase 3 — assistant ================= */

/** approved community documents the assistant may answer from — nothing else */
export const knowledgeDocs = pgTable('knowledge_docs', {
  id: id(),
  associationId: assoc(),
  title: text('title').notNull(), // "Pool, Gym & Clubhouse Rules 2026"
  section: text('section').notNull().default(''), // "page 2", "§7 Parking"
  body: text('body').notNull(),
  createdAt: at(),
}, t => [index().on(t.associationId)]);

/** the resident's private chat with the assistant; kept only while "assistant history" is on */
export const chatMessages = pgTable('chat_messages', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text('role').$type<'user' | 'assistant'>().notNull(),
  text: text('text').notNull(),
  source: text('source'),
  /** a turn of the app's guided issue-report conversation: part of the history, but not a question asked */
  flow: boolean('flow').notNull().default(false),
  createdAt: at(),
}, t => [index().on(t.userId, t.createdAt)]);

/** society-admin switches for the AI features */
export const aiSettings = pgTable('ai_settings', {
  associationId: uuid('association_id').primaryKey().references(() => associations.id, { onDelete: 'cascade' }),
  qna: boolean('qna').notNull().default(true),
  issueCreate: boolean('issue_create').notNull().default(true),
  toneRewrite: boolean('tone_rewrite').notNull().default(true),
  summaries: boolean('summaries').notNull().default(true),
  tones: jsonb('tones').$type<Record<string, boolean>>().notNull().default({ Polite: true, Friendly: true, Funny: true, 'Short & Clear': true }),
  /**
   * What is kept out of view until a moderator has looked. "Medium & above": anything the safety check warns about.
   * "High severity": borderline text is published straight away (and still put in the queue); only abusive text is stopped.
   */
  autoHold: text('auto_hold').$type<AutoHold>().notNull().default('Medium & above'),
});
export const AUTO_HOLD = ['Medium & above', 'High severity'] as const;
export type AutoHold = (typeof AUTO_HOLD)[number];

/* ================= Phase 4 — operator portal ================= */

export type Plan = 'Starter' | 'Professional' | 'Enterprise';
export type SubState = 'Active' | 'Trial' | 'Pending' | 'Suspended';
export type TicketStatus = 'Open' | 'In progress' | 'Resolved';

/** one per association: what they bought and who to talk to */
export const subscriptions = pgTable('subscriptions', {
  associationId: uuid('association_id').primaryKey().references(() => associations.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull().default('Apartment'), // Apartment, Villa, Plotted layout
  plan: text('plan').$type<Plan>().notNull(),
  billing: text('billing').$type<'monthly' | 'yearly'>().notNull().default('yearly'),
  state: text('state').$type<SubState>().notNull().default('Active'),
  /** contract value per year, in rupees */
  annualAmount: integer('annual_amount').notNull(),
  renewsAt: timestamp('renews_at', { withTimezone: true }).notNull(),
  plots: integer('plots').notNull().default(0),
  owners: integer('owners').notNull().default(0),
  adminName: text('admin_name').notNull().default(''),
  adminRole: text('admin_role').notNull().default(''),
  adminPhone: text('admin_phone').notNull().default(''),
  adminEmail: text('admin_email').notNull().default(''),
  registration: text('registration').notNull().default(''),
  address: text('address').notNull().default(''),
  since: timestamp('since', { withTimezone: true }).defaultNow().notNull(),
});

/** monthly adoption readings — the health score's strongest signal */
export const usageSnapshots = pgTable('usage_snapshots', {
  id: id(),
  associationId: assoc(),
  month: text('month').notNull(), // "2026-11"
  /** % of owners active in the month */
  adoption: integer('adoption').notNull(),
  logins: integer('logins').notNull().default(0),
}, t => [unique().on(t.associationId, t.month)]);

export const invoices = pgTable('invoices', {
  id: id(),
  associationId: assoc(),
  number: text('number').notNull().unique(), // "TRZ-INV-2026-0117"
  amount: integer('amount').notNull(),
  paid: integer('paid').notNull().default(0),
  issuedAt: at('issued_at'),
  dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
  lastChasedAt: timestamp('last_chased_at', { withTimezone: true }),
  chases: integer('chases').notNull().default(0),
}, t => [index().on(t.associationId)]);

/** support tickets raised with Trinize by societies, vendors and residents */
export const supportTickets = pgTable('support_tickets', {
  id: id(),
  number: integer('number').notNull().unique(), // shown as ISS-2043 in the operator portal
  associationId: assoc(),
  category: text('category').notNull(), // Billing, Bug, Data, Access, Feature
  title: text('title').notNull(),
  raisedBy: text('raised_by').notNull(),
  source: text('source').notNull(), // "End user · Treasurer"
  priority: text('priority').$type<'Low' | 'Medium' | 'High'>().notNull(),
  status: text('status').$type<TicketStatus>().notNull().default('Open'),
  /** the Trinize property manager handling it */
  assignee: text('assignee'),
  slaDueAt: timestamp('sla_due_at', { withTimezone: true }).notNull(),
  createdAt: at(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
}, t => [index().on(t.status)]);

export const ticketReplies = pgTable('ticket_replies', {
  id: id(),
  ticketId: uuid('ticket_id').notNull().references(() => supportTickets.id, { onDelete: 'cascade' }),
  byUserId: uuid('by_user_id').references(() => users.id, { onDelete: 'set null' }),
  byName: text('by_name').notNull(),
  text: text('text').notNull(),
  createdAt: at(),
});

/** the operator portal's activity feed */
export const opsActivity = pgTable('ops_activity', {
  id: id(),
  who: text('who').notNull(),
  what: text('what').notNull(),
  createdAt: at(),
}, t => [index().on(t.createdAt)]);
