import { boolean, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { associations, issues, users } from './schema.js';

/*
 * The property manager's on-site visits (the hybrid VPM model: virtual all week, on site once a week).
 * Not to be confused with `visits` (schema5), which are visitors at the gate.
 *
 *   site_visit_plans  the regular slot, e.g. every Friday 09:00–12:00 (IST)
 *   site_visits       one day on site; a row exists only once something is planned for it or it was changed
 *                     (cancelled, marked done) — the days in between are worked out from the plan
 *   site_visit_items  what happens on that day: an inspection, a meeting, a follow-up, or a resident's request
 */

export type SiteVisitStatus = 'Planned' | 'Done' | 'Cancelled';
export type SiteItemKind = 'Inspection' | 'Meeting' | 'Follow-up' | 'Request';
/** Requested = a resident asked and the manager hasn't answered yet */
export type SiteItemStatus = 'Requested' | 'Scheduled' | 'Done' | 'Declined';

export const sitePlans = pgTable('site_visit_plans', {
  associationId: uuid('association_id').primaryKey().references(() => associations.id, { onDelete: 'cascade' }),
  /** 0 = Sunday … 6 = Saturday, on the society's own (IST) calendar */
  weekday: integer('weekday').notNull(),
  /** 'HH:MM', 24-hour, IST */
  start: text('start').notNull(),
  end: text('end').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const siteVisits = pgTable('site_visits', {
  id: uuid('id').primaryKey().defaultRandom(),
  associationId: uuid('association_id').notNull().references(() => associations.id, { onDelete: 'cascade' }),
  /** the IST day, YYYY-MM-DD */
  date: text('date').notNull(),
  start: text('start').notNull(),
  end: text('end').notNull(),
  status: text('status').$type<SiteVisitStatus>().notNull().default('Planned'),
  /** shown to residents, e.g. why a visit was cancelled */
  note: text('note').notNull().default(''),
  /** the manager arrived and left (the visit cycle); the hours between count towards their weekly time on site */
  checkedInAt: timestamp('checked_in_at', { withTimezone: true }),
  checkedOutAt: timestamp('checked_out_at', { withTimezone: true }),
  /** what was done on the visit, written when the manager leaves; residents and the office see it */
  report: text('report').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, t => [unique().on(t.associationId, t.date)]);

export const siteItems = pgTable('site_visit_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  associationId: uuid('association_id').notNull().references(() => associations.id, { onDelete: 'cascade' }),
  /** the day it is planned for; null for a resident's request for a visit outside the regular slot, until it is given a day */
  visitId: uuid('visit_id').references(() => siteVisits.id, { onDelete: 'set null' }),
  /** 'HH:MM' within the visit, when the manager has fixed one */
  time: text('time'),
  title: text('title').notNull(),
  location: text('location').notNull().default(''),
  kind: text('kind').$type<SiteItemKind>().notNull(),
  status: text('status').$type<SiteItemStatus>().notNull(),
  issueId: uuid('issue_id').references(() => issues.id, { onDelete: 'set null' }),
  requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
  /** the resident asked for a visit outside the regular slot */
  extra: boolean('extra').notNull().default(false),
  /** the resident's words, or the manager's note */
  note: text('note').notNull().default(''),
  /** the manager's answer to a request, shown to the resident */
  reply: text('reply').notNull().default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, t => [index().on(t.associationId, t.status), index().on(t.visitId), index().on(t.requestedBy)]);
