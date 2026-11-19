import { boolean, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { announcements, associations, users } from './schema.js';

/* Communication hub: every message the office sends, who it went to on which channel and what became
   of it, reusable templates, and two-way conversations between a resident and the office. */

const id = () => uuid('id').primaryKey().defaultRandom();
const at = (name = 'created_at') => timestamp(name, { withTimezone: true }).defaultNow().notNull();
const assoc = () => uuid('association_id').notNull().references(() => associations.id, { onDelete: 'cascade' });
const when = (name: string) => timestamp(name, { withTimezone: true });

export const MESSAGE_TYPES = ['Announcement', 'Reminder', 'Notice', 'Emergency', 'Offer', 'Event'] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];
/** portal = the notice board in the app; push = the app's alert; the rest leave the app */
/** how a message from the office reaches a resident: the app's notice board, an app alert, or email. (Sign-in codes go by SMS; that is separate.) */
export const CHANNELS = ['portal', 'push', 'email'] as const;
export type Channel = (typeof CHANNELS)[number];
export type MessagePriority = 'Normal' | 'Important' | 'Emergency';
export type MessageStatus = 'Draft' | 'Scheduled' | 'Sent' | 'Cancelled';
/**
 * Who gets it. Everything is resolved to people at the moment of sending.
 *   all — every verified resident · towers — whole blocks · units — chosen flats
 *   role — owners only / tenants only · residents — chosen people
 */
export type Audience =
  | { kind: 'all' }
  | { kind: 'towers'; towers: string[] }
  | { kind: 'units'; unitIds: string[] }
  | { kind: 'role'; role: 'Owner' | 'Tenant' | 'Family' }
  | { kind: 'residents'; userIds: string[] };

export const messages = pgTable('messages', {
  id: id(),
  associationId: assoc(),
  number: integer('number').notNull(), // shown as MSG-101
  type: text('type').$type<MessageType>().notNull().default('Announcement'),
  title: text('title').notNull(),
  body: text('body').notNull(),
  priority: text('priority').$type<MessagePriority>().notNull().default('Normal'),
  channels: jsonb('channels').$type<Channel[]>().notNull(),
  audience: jsonb('audience').$type<Audience>().notNull(),
  /** the audience in words, kept as it read when the message was written: "Tower 4 and Tower 5" */
  audienceLabel: text('audience_label').notNull().default('All residents'),
  attachmentUrl: text('attachment_url'),
  attachmentName: text('attachment_name'),
  /** offers and similar: residents who switched promotions off are skipped */
  promotional: boolean('promotional').notNull().default(false),
  requiresAck: boolean('requires_ack').notNull().default(false),
  /** notice-board timing: shown from, hidden after, kept at the top */
  startsAt: when('starts_at'),
  expiresAt: when('expires_at'),
  pinned: boolean('pinned').notNull().default(false),
  status: text('status').$type<MessageStatus>().notNull().default('Draft'),
  scheduledAt: when('scheduled_at'),
  sentAt: when('sent_at'),
  /** 'manual', or the rule that produced it ("payment_overdue") */
  source: text('source').notNull().default('manual'),
  /** the notice-board entry this message published, when the portal channel was used */
  announcementId: uuid('announcement_id').references(() => announcements.id, { onDelete: 'set null' }),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  byName: text('by_name').notNull(),
  createdAt: at(),
}, t => [unique().on(t.associationId, t.number), index().on(t.associationId, t.createdAt), index().on(t.status, t.scheduledAt)]);

/**
 * One row per person per channel. Delivered = it reached them (always true for the app's own channels);
 * Sent = handed to the provider; Logged = written to the server log because no provider is connected;
 * Skipped = not attempted (no email on file, promotions switched off); Failed = the provider refused it.
 */
export type DeliveryStatus = 'Delivered' | 'Sent' | 'Logged' | 'Skipped' | 'Failed';
export const messageDeliveries = pgTable('message_deliveries', {
  id: id(),
  messageId: uuid('message_id').notNull().references(() => messages.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  channel: text('channel').$type<Channel>().notNull(),
  status: text('status').$type<DeliveryStatus>().notNull(),
  detail: text('detail').notNull().default(''),
  sentAt: at('sent_at'),
  /** when the resident opened it in the app (portal channel) */
  readAt: when('read_at'),
}, t => [unique().on(t.messageId, t.userId, t.channel), index().on(t.userId, t.sentAt)]);

/** the office's own templates; the built-in ones live in code */
export const messageTemplates = pgTable('message_templates', {
  id: id(),
  associationId: assoc(),
  name: text('name').notNull(),
  type: text('type').$type<MessageType>().notNull().default('Notice'),
  title: text('title').notNull(),
  body: text('body').notNull(),
  createdAt: at(),
}, t => [index().on(t.associationId)]);

/* ---------- direct messages: one resident ↔ the society office ---------- */
export const CONVERSATION_TOPICS = ['General', 'Rent & dues', 'Maintenance', 'Documents', 'Complaint'] as const;
export type ConversationTopic = (typeof CONVERSATION_TOPICS)[number];

export const conversations = pgTable('conversations', {
  id: id(),
  associationId: assoc(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  subject: text('subject').notNull(),
  topic: text('topic').$type<ConversationTopic>().notNull().default('General'),
  status: text('status').$type<'Open' | 'Closed'>().notNull().default('Open'),
  lastMessageAt: at('last_message_at'),
  createdAt: at(),
}, t => [index().on(t.associationId, t.lastMessageAt), index().on(t.userId)]);

export const conversationMessages = pgTable('conversation_messages', {
  id: id(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  fromUserId: uuid('from_user_id').references(() => users.id, { onDelete: 'set null' }),
  fromRole: text('from_role').$type<'resident' | 'staff'>().notNull(),
  fromName: text('from_name').notNull(),
  text: text('text').notNull(),
  attachmentUrl: text('attachment_url'),
  /** when the other side opened the conversation after this was sent */
  readAt: when('read_at'),
  createdAt: at(),
}, t => [index().on(t.conversationId, t.createdAt)]);
