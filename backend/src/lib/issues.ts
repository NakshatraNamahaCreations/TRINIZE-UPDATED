import { and, asc, eq, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { issueEvents, issueNotes, issues, issueUpdates, units, users, vendors, type IssueStatus, type Priority } from '../db/schema.js';
import { audit } from './audit.js';
import { notify } from './community.js';
import { badRequest, conflict, notFound } from './http.js';

export const CATEGORIES = ['Electrical', 'Plumbing', 'Lifts', 'Sanitation', 'HVAC', 'Pest control', 'Appliance', 'Security', 'General maintenance'] as const;
/** shared equipment and spaces a request can be about without belonging to any flat */
export const COMMON_ASSETS = ['Lift', 'STP', 'Water motor', 'Generator', 'CCTV', 'Gate / security cabin', 'Parking area', 'Clubhouse', 'Garden', 'Corridor lights', 'Sump / tank', 'Drainage'] as const;
export const STATUSES: IssueStatus[] = ['Submitted', 'Acknowledged', 'Assigned', 'In Progress', 'On Hold', 'Resolved', 'Closed'];
/** how long the society office has to respond, by urgency */
export const SLA_HOURS: Record<Priority, number> = { Emergency: 4, High: 24, Medium: 72, Low: 168 };

/** the moves the admin console may make; anything else is refused */
export const NEXT: Record<IssueStatus, IssueStatus[]> = {
  Submitted: ['Acknowledged'],
  Acknowledged: ['Assigned', 'On Hold', 'Resolved'],
  Assigned: ['In Progress', 'On Hold', 'Resolved'],
  'In Progress': ['On Hold', 'Resolved'],
  // on hold = waiting for a part, an approval or access; it goes back to where the work was
  'On Hold': ['Assigned', 'In Progress', 'Resolved'],
  Resolved: ['Closed', 'Acknowledged'],
  Closed: [],
};

export const ref = (n: number) => 'ISS-' + n;
export function parseRef(r: string) {
  const m = /^ISS-(\d{1,9})$/i.exec(r);
  if (!m) throw badRequest('invalid_ref', 'Issue numbers look like ISS-1043.');
  return Number(m[1]);
}

type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];

export async function createIssue(db: DB, o: {
  associationId: string; reporterId: string; reporterName: string; unitId: string | null;
  title: string; category: string; location: string; priority: Priority; via: 'chat' | 'form' | 'admin'; details?: string; photoUrl?: string;
  scope?: 'unit' | 'common'; asset?: string;
}) {
  const made = await db.transaction(async tx => {
    // per-society running number; the unique (association, number) index settles any race
    const [{ next }] = (await tx.select({ next: sql<number>`coalesce(max(${issues.number}), 1042) + 1` }).from(issues)
      .where(eq(issues.associationId, o.associationId))) as [{ next: number }];
    const [row] = await tx.insert(issues).values({
      associationId: o.associationId, number: next, title: o.title, category: o.category, location: o.location, priority: o.priority,
      unitId: o.scope === 'common' ? null : o.unitId, reporterId: o.reporterId, via: o.via, slaDueAt: new Date(Date.now() + SLA_HOURS[o.priority] * 3600e3),
      scope: o.scope ?? 'unit', asset: o.scope === 'common' ? o.asset ?? null : null,
    }).returning();
    if (!row) throw new Error('insert failed');
    await tx.insert(issueEvents).values({ issueId: row.id, status: 'Submitted', note: o.via === 'chat' ? 'Reported via the assistant' : o.via === 'form' ? 'Reported with the form' : 'Logged by the society office', byUserId: o.reporterId });
    if ((o.details && o.details.trim() !== o.title.trim()) || o.photoUrl) {
      await tx.insert(issueUpdates).values({ issueId: row.id, userId: o.reporterId, text: o.details?.trim() ?? '', photoUrl: o.photoUrl ?? null });
    }
    await audit(tx, o.associationId, o.reporterId, 'System', `issue ${ref(next)} created by ${o.reporterName} (via ${o.via}) · category ${o.category}`);
    return row;
  });
  // any workflow that listens for new requests starts here
  return made;
}

/** One ticket as an app shows it. Staff also get the internal notes; residents never do. */
export async function loadIssue(db: DB | Tx, associationId: string, number: number, opts: { internal?: boolean; viewerId?: string } = {}) {
  const [i] = await db.select({
    id: issues.id, number: issues.number, title: issues.title, category: issues.category, location: issues.location, priority: issues.priority,
    status: issues.status, via: issues.via, slaDueAt: issues.slaDueAt, rating: issues.rating, createdAt: issues.createdAt, reporterId: issues.reporterId,
    reporter: users.name, unit: units.code, vendor: vendors.name, vendorId: issues.vendorId,
    scope: issues.scope, asset: issues.asset, vendorState: issues.vendorState, scheduledAt: issues.scheduledAt, dueAt: issues.dueAt,
    costEstimate: issues.costEstimate, costActual: issues.costActual, approval: issues.approval, ownerApproval: issues.ownerApproval, accessNote: issues.accessNote, escalatedAt: issues.escalatedAt,
  }).from(issues)
    .leftJoin(users, eq(users.id, issues.reporterId)).leftJoin(units, eq(units.id, issues.unitId)).leftJoin(vendors, eq(vendors.id, issues.vendorId))
    .where(and(eq(issues.associationId, associationId), eq(issues.number, number)));
  if (!i) throw notFound('Issue');
  const timeline = await db.select({ status: issueEvents.status, note: issueEvents.note, at: issueEvents.createdAt }).from(issueEvents)
    .where(eq(issueEvents.issueId, i.id)).orderBy(asc(issueEvents.createdAt));
  const updates = await db.select({ text: issueUpdates.text, photoUrl: issueUpdates.photoUrl, at: issueUpdates.createdAt }).from(issueUpdates)
    .where(eq(issueUpdates.issueId, i.id)).orderBy(asc(issueUpdates.createdAt));
  const notes = opts.internal
    ? await db.select({ text: issueNotes.text, at: issueNotes.createdAt, by: users.name }).from(issueNotes).leftJoin(users, eq(users.id, issueNotes.userId))
      .where(eq(issueNotes.issueId, i.id)).orderBy(asc(issueNotes.createdAt))
    : undefined;
  // money and entry instructions are the office's and the vendor's business — residents get the rest
  const { id: _id, reporterId, costEstimate, costActual, accessNote, escalatedAt, ...shared } = i;
  const rest = opts.internal ? { ...shared, costEstimate, costActual, accessNote, escalated: !!escalatedAt } : shared;
  return {
    id: i.id, ref: ref(i.number), ...rest,
    mine: opts.viewerId ? reporterId === opts.viewerId : undefined,
    slaState: ['Resolved', 'Closed'].includes(i.status) ? 'met' : i.slaDueAt.getTime() < Date.now() ? 'over' : 'ok',
    timeline, updates, ...(notes ? { internalNotes: notes } : {}),
  };
}

/** Status changes from the admin console, with the rules in NEXT. */
export async function moveIssue(db: DB, o: { associationId: string; number: number; to: IssueStatus; note?: string; vendorId?: string; byUserId: string; byName: string; dueAt?: Date; accessNote?: string }) {
  return db.transaction(async tx => {
    const [i] = await tx.select().from(issues).where(and(eq(issues.associationId, o.associationId), eq(issues.number, o.number))).for('update');
    if (!i) throw notFound('Issue');
    if (!NEXT[i.status].includes(o.to)) throw conflict('bad_transition', `An issue that is ${i.status} can’t move to ${o.to}.`);
    // a repair over the society's limit waits for the committee before anyone starts on it
    if (o.to === 'In Progress' && i.approval === 'pending') throw conflict('approval_pending', 'This repair is waiting for approval of its estimate.');
    if (o.to === 'In Progress' && i.ownerApproval === 'pending') throw conflict('owner_approval_pending', 'This repair is waiting for the flat owner to approve the estimate.');
    if (o.to === 'In Progress' && i.approval === 'rejected') throw conflict('approval_rejected', 'The estimate for this repair was rejected. Revise it first.');
    if (o.to === 'Assigned' && !o.vendorId && i.status === 'On Hold' && i.vendorId) o = { ...o, vendorId: i.vendorId }; // back from hold: same vendor
    let vendorName: string | null = null;
    if (o.to === 'Assigned') {
      if (!o.vendorId) throw badRequest('vendor_required', 'Pick a vendor to assign.');
      const [v] = await tx.select().from(vendors).where(and(eq(vendors.id, o.vendorId), eq(vendors.associationId, o.associationId)));
      if (!v) throw notFound('Vendor');
      vendorName = v.name;
    }
    await tx.update(issues).set({
      status: o.to, lastActivityAt: new Date(),
      ...(o.to === 'Assigned' ? { vendorId: o.vendorId, vendorState: 'Assigned' as const, ...(o.dueAt ? { dueAt: o.dueAt } : {}), ...(o.accessNote ? { accessNote: o.accessNote } : {}) } : {}),
    }).where(eq(issues.id, i.id));

    await tx.insert(issueEvents).values({ issueId: i.id, status: o.to, note: o.note ?? (vendorName ? vendorName : null), byUserId: o.byUserId });
    await audit(tx, o.associationId, o.byUserId, o.byName, `${ref(i.number)} moved ${i.status} → ${o.to}${vendorName ? ' · ' + vendorName : ''}`);
    if (i.reporterId) {
      await notify(tx, [i.reporterId], {
        kind: 'issues', title: o.to === 'Resolved' ? `${ref(i.number)} resolved` : `Update on ${ref(i.number)}`,
        body: o.note ?? (vendorName ? `Assigned to ${vendorName}` : `Now ${o.to}`), href: '/issues/' + ref(i.number),
      });
    }
  });
}
