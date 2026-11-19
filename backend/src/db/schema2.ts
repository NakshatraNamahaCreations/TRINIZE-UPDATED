import { boolean, date, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { associations, users } from './schema.js';

/* Phase 2 schema — community, safety, notifications. */

const id = () => uuid('id').primaryKey().defaultRandom();
const at = (name = 'created_at') => timestamp(name, { withTimezone: true }).defaultNow().notNull();
const assoc = () => uuid('association_id').notNull().references(() => associations.id, { onDelete: 'cascade' });

export type ContentState = 'published' | 'held' | 'hidden';
export type ModAction = 'Allowed' | 'Warned author' | 'Rewrite suggested' | 'Hidden';
/** Restricted: cannot post. Suspended: cannot post, comment, vote or RSVP. Blocked: cannot use the app at all until the office unblocks them. */
export type Standing = 'Active' | 'Warned' | 'Restricted' | 'Suspended' | 'Blocked';
export type NotifKind = 'announcements' | 'events' | 'polls' | 'discussions' | 'gratitude' | 'issues' | 'visitors' | 'messages' | 'payments';

/* ---------- discussions ---------- */
export const posts = pgTable('posts', {
  id: id(),
  associationId: assoc(),
  /** per-society running number — shown as D-231 */
  number: integer('number').notNull(),
  authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  body: text('body').notNull(),
  /** held = waiting for a moderator, visible to its author only; hidden = removed by a moderator */
  state: text('state').$type<ContentState>().notNull().default('published'),
  pinned: boolean('pinned').notNull().default(false),
  createdAt: at(),
}, t => [unique().on(t.associationId, t.number), index().on(t.associationId, t.createdAt)]);

export const replies = pgTable('replies', {
  id: id(),
  postId: uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
  text: text('text').notNull(),
  state: text('state').$type<ContentState>().notNull().default('published'),
  createdAt: at(),
}, t => [index().on(t.postId, t.createdAt)]);

/** one reaction per resident per post */
export const reactions = pgTable('reactions', {
  postId: uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  createdAt: at(),
}, t => [primaryKey({ columns: [t.postId, t.userId] })]);

/* ---------- gratitude ---------- */
export const gratitudes = pgTable('gratitudes', {
  id: id(),
  associationId: assoc(),
  fromId: uuid('from_id').references(() => users.id, { onDelete: 'set null' }),
  /** a resident, or null with a label such as "The whole community" or "Security team" */
  toUserId: uuid('to_user_id').references(() => users.id, { onDelete: 'set null' }),
  toLabel: text('to_label').notNull(),
  category: text('category').notNull(),
  text: text('text').notNull(),
  state: text('state').$type<'sent' | 'held'>().notNull().default('sent'),
  createdAt: at(),
}, t => [index().on(t.associationId, t.createdAt)]);

/* ---------- safety ---------- */
/** one report per resident per item; the reporter is never shown to the author */
export const reports = pgTable('reports', {
  id: id(),
  associationId: assoc(),
  reporterId: uuid('reporter_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  targetType: text('target_type').$type<'post' | 'reply'>().notNull(),
  targetId: uuid('target_id').notNull(),
  createdAt: at(),
}, t => [unique().on(t.reporterId, t.targetType, t.targetId)]);

export const blocks = pgTable('blocks', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  blockedUserId: uuid('blocked_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  createdAt: at(),
}, t => [primaryKey({ columns: [t.userId, t.blockedUserId] })]);

export const moderationItems = pgTable('moderation_items', {
  id: id(),
  associationId: assoc(),
  /** per-society running number — shown as MOD-89 */
  number: integer('number').notNull(),
  kind: text('kind').notNull(), // "Discussion post", "Reported reply", "Gratitude note"
  authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
  text: text('text').notNull(),
  category: text('category').notNull(), // "Aggressive", "Abusive", "Reported by a resident"
  severity: text('severity').$type<'Low' | 'Medium' | 'High'>().notNull(),
  reason: text('reason').notNull(),
  context: text('context').notNull(),
  targetType: text('target_type').$type<'post' | 'reply' | 'gratitude'>(),
  targetId: uuid('target_id'),
  state: text('state').$type<'open' | 'done'>().notNull().default('open'),
  action: text('action').$type<ModAction>(),
  resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  createdAt: at(),
}, t => [unique().on(t.associationId, t.number), index().on(t.associationId, t.state)]);

/** a resident's standing in one society — warnings add up; restricted residents cannot post */
export const standings = pgTable('standings', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  associationId: assoc(),
  status: text('status').$type<Standing>().notNull().default('Active'),
  warnings: integer('warnings').notNull().default(0),
}, t => [primaryKey({ columns: [t.userId, t.associationId] })]);

/* ---------- notifications ---------- */
export const notifications = pgTable('notifications', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<NotifKind>().notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  /** the screen to open, e.g. /issues/ISS-1043 */
  href: text('href'),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: at(),
}, t => [index().on(t.userId, t.createdAt)]);

/** push tokens (FCM). Delivery is switched on once a Firebase project exists. */
export const devices = pgTable('devices', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  platform: text('platform').$type<'android' | 'ios' | 'web'>().notNull(),
  createdAt: at(),
});

export const userSettings = pgTable('user_settings', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  notif: jsonb('notif').$type<Record<string, boolean>>().notNull(),
  privacy: jsonb('privacy').$type<Record<string, boolean>>().notNull(),
});

/** one row for each day a resident opened the app (India time) — behind "days active" and the streak on their impact screen */
export const activeDays = pgTable('active_days', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  day: date('day').notNull(),
}, t => [primaryKey({ columns: [t.userId, t.day] })]);

/* ---------- event ideas ---------- */
export const eventSuggestions = pgTable('event_suggestions', {
  id: id(),
  associationId: assoc(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  whenText: text('when_text').notNull(),
  location: text('location').notNull(),
  note: text('note').notNull().default(''),
  status: text('status').$type<'pending' | 'approved' | 'declined'>().notNull().default('pending'),
  createdAt: at(),
});
