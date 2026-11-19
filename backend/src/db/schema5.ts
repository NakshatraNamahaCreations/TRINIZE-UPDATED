import { boolean, index, integer, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { associations, units, users } from './schema.js';

/* Visitor & delivery management: everything that happens at the gate. */

const id = () => uuid('id').primaryKey().defaultRandom();
const at = (name = 'created_at') => timestamp(name, { withTimezone: true }).defaultNow().notNull();
const assoc = () => uuid('association_id').notNull().references(() => associations.id, { onDelete: 'cascade' });
const when = (name: string) => timestamp(name, { withTimezone: true });

export const VISITOR_TYPES = ['Guest', 'Delivery', 'Cab', 'Vendor', 'Staff', 'Emergency'] as const;
export type VisitorType = (typeof VISITOR_TYPES)[number];
export const DELIVERY_TYPES = ['Food', 'Courier', 'Grocery', 'Parcel', 'Medicine'] as const;
export type DeliveryType = (typeof DELIVERY_TYPES)[number];

/**
 * Expected  — a resident pre-approved the visit and holds a pass code; nobody has arrived yet
 * Pending   — at the gate, waiting for the flat to answer
 * Approved  — may come in; the guard has not let them through yet
 * Rejected  — turned away
 * AtGate    — a delivery the resident asked to be left with security; ends as Collected
 * Inside    — let in; ends as Left
 * Expired   — a self check-in the flat did not answer within ten minutes (a pass past its time is shown as Expired too, without being stored so)
 */
export type VisitStatus = 'Expected' | 'Pending' | 'Approved' | 'Rejected' | 'AtGate' | 'Inside' | 'Left' | 'Collected' | 'Cancelled' | 'Expired';
/** who settled it: the flat, the office, the guard after phoning the flat, a pass, a standing permission, a rule */
export type DecidedVia = 'resident' | 'admin' | 'guard' | 'pass' | 'frequent' | 'emergency' | 'watchlist';

export const visits = pgTable('visits', {
  id: id(),
  associationId: assoc(),
  /** the flat being visited; empty only for society-level entries (staff, emergency services) */
  unitId: uuid('unit_id').references(() => units.id, { onDelete: 'set null' }),
  kind: text('kind').$type<'visitor' | 'delivery'>().notNull().default('visitor'),
  visitorType: text('visitor_type').$type<VisitorType>().notNull(),
  name: text('name').notNull(),
  phone: text('phone'),
  photoUrl: text('photo_url'),
  purpose: text('purpose').notNull().default(''),
  vehicle: text('vehicle'),
  people: integer('people').notNull().default(1),
  deliveryType: text('delivery_type').$type<DeliveryType>(),
  /** Swiggy, Zomato, Amazon, Flipkart, a courier's name… */
  partner: text('partner'),

  status: text('status').$type<VisitStatus>().notNull(),
  /** set when the visitor matched a "watch" entry: the guard and the flat are warned, entry is not blocked */
  flagged: text('flagged'),
  /** pre-approved visits: the 6-digit pass the visitor shows (also what the QR carries), and when it works */
  passCode: text('pass_code'),
  validFrom: when('valid_from'),
  validUntil: when('valid_until'),

  decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
  decidedByName: text('decided_by_name'),
  decidedVia: text('decided_via').$type<DecidedVia>(),
  decidedAt: when('decided_at'),

  enteredAt: when('entered_at'),
  exitedAt: when('exited_at'),
  gate: text('gate'),
  guardId: uuid('guard_id').references(() => users.id, { onDelete: 'set null' }),
  guardName: text('guard_name'),
  exitGuardName: text('exit_guard_name'),

  /** delivery proof: a photo of the parcel or the handover */
  proofUrl: text('proof_url'),
  /** leave-at-gate: when security took the parcel, the code the resident shows to collect it, and the handover */
  keptAt: when('kept_at'),
  collectCode: text('collect_code'),
  collectedAt: when('collected_at'),
  collectedBy: text('collected_by'),

  /** self check-in: the visitor scanned the gate's QR sticker and typed this entry themselves; the secret their phone keeps to follow the answer */
  selfToken: text('self_token').unique(),

  note: text('note').notNull().default(''),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: at(),
}, t => [index().on(t.associationId, t.createdAt), index().on(t.unitId, t.createdAt), index().on(t.associationId, t.status), index().on(t.associationId, t.passCode)]);

/** the QR sticker at a gate: scanning it opens the visitor's own check-in form for this society. Removing the row makes a printed sticker stop working. */
export const gateStickers = pgTable('gate_stickers', {
  id: id(),
  associationId: assoc(),
  gate: text('gate').notNull(),
  token: text('token').notNull().unique(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: at(),
}, t => [index().on(t.associationId)]);

/** people a flat sees often: the guard finds them by phone; with autoApprove they come in without a request each time */
export const frequentVisitors = pgTable('frequent_visitors', {
  id: id(),
  associationId: assoc(),
  unitId: uuid('unit_id').notNull().references(() => units.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  phone: text('phone').notNull(),
  visitorType: text('visitor_type').$type<VisitorType>().notNull().default('Guest'),
  vehicle: text('vehicle'),
  autoApprove: boolean('auto_approve').notNull().default(false),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: at(),
}, t => [unique().on(t.unitId, t.phone), index().on(t.associationId, t.phone)]);

/** "block": refused at the gate. "watch": let the guard and the flat know, but don't refuse. */
export const watchlist = pgTable('watchlist', {
  id: id(),
  associationId: assoc(),
  name: text('name').notNull(),
  phone: text('phone'),
  vehicle: text('vehicle'),
  reason: text('reason').notNull(),
  level: text('level').$type<'block' | 'watch'>().notNull().default('block'),
  addedBy: uuid('added_by').references(() => users.id, { onDelete: 'set null' }),
  addedByName: text('added_by_name').notNull().default(''),
  createdAt: at(),
}, t => [index().on(t.associationId)]);
