import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { associations, units, users } from './schema.js';

/* Workflows: something happens → wait → do something → repeat or move on, with every step on record.
   Plus the things workflows produce or react to: tasks for staff, and emergency incidents. */

const id = () => uuid('id').primaryKey().defaultRandom();
const at = (name = 'created_at') => timestamp(name, { withTimezone: true }).defaultNow().notNull();
const assoc = () => uuid('association_id').notNull().references(() => associations.id, { onDelete: 'cascade' });
const when = (name: string) => timestamp(name, { withTimezone: true });

/** what starts a workflow, and the kind of record each one is about */
export const TRIGGERS = {
  bill_generated: 'bill', payment_overdue: 'bill', payment_received: 'payment',
  maintenance_created: 'issue', work_order_overdue: 'issue',
  lease_expiring: 'unit', lease_document_missing: 'unit', month_end: 'month',
} as const;
export type Trigger = keyof typeof TRIGGERS;
export type SubjectType = (typeof TRIGGERS)[Trigger];

export const ACTIONS = ['send_message', 'create_task', 'add_late_fee', 'assign_vendor', 'escalate', 'share_owner_statement'] as const;
export type Action = (typeof ACTIONS)[number];

export type Step = {
  action: Action;
  /** wait this long after the previous step (or after the trigger, for the first) */
  delayDays: number;
  /** send_message: who, how, and the words — {flat}, {amount}, {due}, {ref}, {title}, {month} are filled in */
  to?: 'flat' | 'owner' | 'staff' | 'committee';
  channels?: ('push' | 'whatsapp' | 'sms' | 'email' | 'portal')[];
  title?: string; body?: string;
  /** create_task: who it is for and when it is due */
  assignee?: 'admin' | 'committee'; dueInDays?: number;
  /** the office must say yes before this step runs */
  needsApproval?: boolean;
  /** do this step again every N days, up to `maxRepeats` more times, while the reason for it still holds */
  repeatEveryDays?: number; maxRepeats?: number;
};
/** narrow what a workflow applies to */
export type Conditions = { minAmount?: number; chargeTypes?: string[]; categories?: string[]; priorities?: string[]; daysBefore?: number; daysAfter?: number };

export const workflows = pgTable('workflows', {
  id: id(),
  associationId: assoc(),
  name: text('name').notNull(),
  /** the built-in template it was made from, if any */
  templateKey: text('template_key'),
  trigger: text('trigger').$type<Trigger>().notNull(),
  conditions: jsonb('conditions').$type<Conditions>().notNull(),
  steps: jsonb('steps').$type<Step[]>().notNull(),
  enabled: boolean('enabled').notNull().default(true),
  byName: text('by_name').notNull().default(''),
  createdAt: at(),
}, t => [index().on(t.associationId, t.trigger)]);

/**
 * One workflow working on one record.
 *   Scheduled — waiting for its next step's time · Needs approval — the next step waits for a yes
 *   Completed — every step done · Stopped — the reason went away (bill paid, request closed)
 *   Failed — a step could not run (see `failure`; can be retried) · Paused — held by the office
 */
export type RunStatus = 'Scheduled' | 'Needs approval' | 'Completed' | 'Stopped' | 'Failed' | 'Paused';
export const workflowRuns = pgTable('workflow_runs', {
  id: id(),
  workflowId: uuid('workflow_id').notNull().references(() => workflows.id, { onDelete: 'cascade' }),
  associationId: assoc(),
  subjectType: text('subject_type').$type<SubjectType>().notNull(),
  /** the bill, issue, unit or payment id — or "2026-11" for a month */
  subjectId: text('subject_id').notNull(),
  subjectLabel: text('subject_label').notNull(),
  status: text('status').$type<RunStatus>().notNull().default('Scheduled'),
  stepIndex: integer('step_index').notNull().default(0),
  repeatsDone: integer('repeats_done').notNull().default(0),
  nextAt: when('next_at'),
  failure: text('failure'),
  startedAt: at('started_at'),
  finishedAt: when('finished_at'),
}, t => [unique().on(t.workflowId, t.subjectId), index().on(t.status, t.nextAt), index().on(t.associationId, t.startedAt)]);

export const workflowLog = pgTable('workflow_log', {
  id: id(),
  runId: uuid('run_id').notNull().references(() => workflowRuns.id, { onDelete: 'cascade' }),
  step: integer('step').notNull(),
  action: text('action').notNull(),
  result: text('result').$type<'done' | 'failed' | 'skipped' | 'waiting' | 'note'>().notNull(),
  detail: text('detail').notNull().default(''),
  createdAt: at(),
}, t => [index().on(t.runId, t.createdAt)]);

/** something a person in the office has to do — raised by a workflow or by hand */
export const tasks = pgTable('tasks', {
  id: id(),
  associationId: assoc(),
  title: text('title').notNull(),
  detail: text('detail').notNull().default(''),
  assignee: text('assignee').$type<'admin' | 'committee'>().notNull().default('admin'),
  dueDate: date('due_date'),
  status: text('status').$type<'Open' | 'Done'>().notNull().default('Open'),
  /** where it came from: a workflow run, or null when added by hand */
  runId: uuid('run_id').references(() => workflowRuns.id, { onDelete: 'set null' }),
  /** the screen that deals with it, e.g. /issues or /accounts */
  link: text('link'),
  doneByName: text('done_by_name'),
  doneAt: when('done_at'),
  byName: text('by_name').notNull().default('Workflow'),
  createdAt: at(),
}, t => [index().on(t.associationId, t.status)]);

export const INCIDENT_KINDS = ['Medical', 'Fire', 'Security', 'Lift', 'Other'] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];

/** an SOS raised by a resident or a guard, and what was done about it */
export const incidents = pgTable('incidents', {
  id: id(),
  associationId: assoc(),
  kind: text('kind').$type<IncidentKind>().notNull(),
  raisedBy: uuid('raised_by').references(() => users.id, { onDelete: 'set null' }),
  raisedByName: text('raised_by_name').notNull(),
  raisedByRole: text('raised_by_role').$type<'resident' | 'guard'>().notNull().default('resident'),
  unitId: uuid('unit_id').references(() => units.id, { onDelete: 'set null' }),
  place: text('place').notNull().default(''),
  note: text('note').notNull().default(''),
  status: text('status').$type<'Open' | 'Acknowledged' | 'Resolved'>().notNull().default('Open'),
  ackByName: text('ack_by_name'),
  ackAt: when('ack_at'),
  resolvedByName: text('resolved_by_name'),
  resolvedAt: when('resolved_at'),
  resolution: text('resolution').notNull().default(''),
  createdAt: at(),
}, t => [index().on(t.associationId, t.createdAt), index().on(t.associationId, t.status)]);
