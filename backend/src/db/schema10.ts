import { boolean, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { associations, issues, units, users } from './schema.js';

/* The AI layer's own records: what the assistant was asked and what it did (the AI audit log),
   and inspections — a checklist walked through on a phone, with photos, findings and a report. */

const id = () => uuid('id').primaryKey().defaultRandom();
const at = (name = 'created_at') => timestamp(name, { withTimezone: true }).defaultNow().notNull();
const assoc = () => uuid('association_id').notNull().references(() => associations.id, { onDelete: 'cascade' });
const when = (name: string) => timestamp(name, { withTimezone: true });

/** something the assistant offered to do; it happens only when the person says yes */
export type AiAction =
  | { kind: 'send_reminders'; flats: number; amount: number }
  | { kind: 'create_work_order'; title: string; category: string; priority: 'Low' | 'Medium' | 'High' | 'Emergency'; asset: string | null; vendorId: string | null; vendor: string | null }
  | { kind: 'create_task'; title: string; dueInDays: number }
  | { kind: 'ask_office'; question: string };

/**
 * One row per thing asked of the assistant.
 *   answered — a question, answered from `dataAccessed` · refused — outside what this person may see
 *   proposed — an action is waiting for a yes · done / cancelled / failed — what became of it
 */
export type AiAuditStatus = 'answered' | 'refused' | 'proposed' | 'done' | 'cancelled' | 'failed';
export const aiAudit = pgTable('ai_audit', {
  id: id(),
  associationId: assoc(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  userName: text('user_name').notNull(),
  role: text('role').notNull(),
  surface: text('surface').$type<'console' | 'app'>().notNull(),
  prompt: text('prompt').notNull(),
  response: text('response').notNull().default(''),
  /** the kinds of record that were read to answer: "dues", "work orders", "gate log" */
  dataAccessed: jsonb('data_accessed').$type<string[]>().notNull(),
  action: jsonb('action').$type<AiAction>(),
  approvalRequired: boolean('approval_required').notNull().default(false),
  status: text('status').$type<AiAuditStatus>().notNull().default('answered'),
  /** what happened when the action ran: "MSG-104 sent to 12 residents" */
  outcome: text('outcome').notNull().default(''),
  /** whether a model wrote the reply, or the built-in rules did */
  by: text('by').$type<'ai' | 'rules'>().notNull().default('rules'),
  createdAt: at(),
}, t => [index().on(t.associationId, t.createdAt)]);

/* ---------- inspections ---------- */
export const INSPECTION_TYPES = ['Move-in', 'Move-out', 'Monthly', 'Quarterly', 'Annual', 'Safety', 'Fire', 'Electrical', 'STP', 'Lift', 'Clubhouse', 'Common area'] as const;
export type InspectionType = (typeof INSPECTION_TYPES)[number];
export const CONDITIONS = ['Good', 'Fair', 'Poor', 'Damaged', 'Missing'] as const;
export type Condition = (typeof CONDITIONS)[number];
export const SEVERITIES = ['Low', 'Medium', 'High', 'Critical'] as const;
export type Severity = (typeof SEVERITIES)[number];
export const RECOMMENDATIONS = ['Repair', 'Replace', 'Monitor', 'Ignore'] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];

/** a room or an area, and what to look at in it; `photo` = a photo is required before submitting */
export type TemplateSection = { name: string; items: { name: string; photo: boolean }[] };

/** a society's own checklists; the built-in ones live in code */
export const inspectionTemplates = pgTable('inspection_templates', {
  id: id(),
  associationId: assoc(),
  name: text('name').notNull(),
  scope: text('scope').$type<'unit' | 'common'>().notNull(),
  sections: jsonb('sections').$type<TemplateSection[]>().notNull(),
  byName: text('by_name').notNull().default(''),
  createdAt: at(),
}, t => [index().on(t.associationId)]);

export const inspections = pgTable('inspections', {
  id: id(),
  associationId: assoc(),
  number: integer('number').notNull(), // shown as INS-101
  type: text('type').$type<InspectionType>().notNull(),
  templateName: text('template_name').notNull(),
  scope: text('scope').$type<'unit' | 'common'>().notNull(),
  unitId: uuid('unit_id').references(() => units.id, { onDelete: 'set null' }),
  /** for a common-area inspection: "Tower 2 lifts", "Clubhouse" */
  place: text('place').notNull().default(''),
  status: text('status').$type<'In progress' | 'Submitted'>().notNull().default('In progress'),
  inspectorId: uuid('inspector_id').references(() => users.id, { onDelete: 'set null' }),
  inspectorName: text('inspector_name').notNull(),
  startedAt: at('started_at'),
  submittedAt: when('submitted_at'),
  summary: text('summary').notNull().default(''),
  summaryBy: text('summary_by').$type<'ai' | 'rules'>(),
  /** who may read the report in the app */
  shareOwner: boolean('share_owner').notNull().default(false),
  shareTenant: boolean('share_tenant').notNull().default(false),
  /** the resident's or owner's "I have read and accept this report" */
  ackName: text('ack_name'),
  ackRole: text('ack_role'),
  ackNote: text('ack_note').notNull().default(''),
  ackAt: when('ack_at'),
}, t => [unique().on(t.associationId, t.number), index().on(t.associationId, t.startedAt), index().on(t.unitId)]);

export const inspectionItems = pgTable('inspection_items', {
  id: id(),
  inspectionId: uuid('inspection_id').notNull().references(() => inspections.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  section: text('section').notNull(),
  item: text('item').notNull(),
  photoRequired: boolean('photo_required').notNull().default(false),
  condition: text('condition').$type<Condition>(),
  note: text('note').notNull().default(''),
  /** originals, kept as uploaded */
  photos: jsonb('photos').$type<string[]>().notNull(),
  /** set when the item was last rated or photographed — the timestamp on the report */
  checkedAt: when('checked_at'),
  /* the finding, for anything not Good: written by a model from the photos, or by the rules from the rating */
  finding: text('finding').notNull().default(''),
  severity: text('severity').$type<Severity>(),
  recommendation: text('recommendation').$type<Recommendation>(),
  /** the trade a repair needs — a maintenance category */
  category: text('category'),
  findingBy: text('finding_by').$type<'ai' | 'rules'>(),
  /** the work order raised from this finding */
  issueId: uuid('issue_id').references(() => issues.id, { onDelete: 'set null' }),
}, t => [index().on(t.inspectionId, t.position)]);
