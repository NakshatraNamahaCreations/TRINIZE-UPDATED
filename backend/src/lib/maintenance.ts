import { and, eq, inArray, isNull, lt, notInArray, or, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { associations, issues, staffRoles, unitMembers, vendors, type StaffRole } from '../db/schema.js';
import { audit } from './audit.js';
import { notify } from './community.js';
import { ref } from './issues.js';

type Writer = Pick<DB, 'insert' | 'select' | 'selectDistinct' | 'update'>;

/** the staff of a society who should hear about something — admins by default, committee for approvals */
export async function staffOfSociety(db: Pick<DB, 'select'>, associationId: string, roles: StaffRole[] = ['admin']) {
  const rows = await db.select({ userId: staffRoles.userId }).from(staffRoles)
    // a society's VPM hears whatever its admin hears
    .where(and(eq(staffRoles.associationId, associationId), inArray(staffRoles.role, roles.includes('admin') ? [...roles, 'vpm'] : roles)));
  return [...new Set(rows.map(r => r.userId))];
}

/**
 * Put a cost estimate on a work order. Over the society's limit it waits for the committee; a repair on
 * someone's flat at or above the owner limit also waits for the flat's owner.
 */
export async function applyEstimate(db: DB, aid: string, i: typeof issues.$inferSelect, amount: number, s: { userId: string; name: string }) {
  const [a] = await db.select({ limit: associations.approvalLimit }).from(associations).where(eq(associations.id, aid));
  const needs = amount > (a?.limit ?? 0);
  // a repair on someone's flat, at or above the society's owner limit, also goes to the flat's owner
  const ownerLimit = (await db.select({ o: associations.ownerPortal }).from(associations).where(eq(associations.id, aid)))[0]?.o?.approveAbove ?? 0;
  const owners = i.scope === 'unit' && i.unitId && ownerLimit > 0 && amount >= ownerLimit
    ? (await db.select({ userId: unitMembers.userId }).from(unitMembers).where(and(eq(unitMembers.unitId, i.unitId), eq(unitMembers.role, 'Owner'), eq(unitMembers.status, 'active')))).map(m => m.userId) : [];
  await db.update(issues).set({ costEstimate: amount, approval: needs ? 'pending' : 'none', approvalBy: null, ownerApproval: owners.length ? 'pending' : 'none', lastActivityAt: new Date() }).where(eq(issues.id, i.id));
  if (owners.length) await notify(db, owners, { kind: 'issues', title: `Your approval is needed: ${ref(i.number)}`, body: `Estimate ₹${amount.toLocaleString('en-IN')} · ${i.title}`, href: '/owner/requests/' + ref(i.number) });
  await audit(db, aid, s.userId, s.name, `estimate ₹${amount} on ${ref(i.number)}${needs ? ' · needs committee approval' : ''}`);
  if (needs) await notify(db, await staffOfSociety(db, aid, ['committee', 'admin']), { kind: 'issues', title: `Approval needed: ${ref(i.number)}`, body: `Estimate ₹${amount.toLocaleString('en-IN')} · ${i.title}`, href: '/issues/' + ref(i.number) });
}

const HOUR = 3600e3;

/**
 * The automatic follow-ups from the Maintenance brief. Safe to run as often as you like — each ticket
 * is reminded at most once a day and escalated once.
 *  - vendor assigned, nothing recorded for 24 hours → remind the manager to chase the vendor
 *  - past its response time and still open → escalate to the society's admins (and the committee)
 */
export async function sweep(db: Writer, now = new Date()) {
  const open = notInArray(issues.status, ['Resolved', 'Closed', 'On Hold']);
  let reminded = 0, escalated = 0;

  const quiet = await db.select({ id: issues.id, number: issues.number, title: issues.title, vendor: vendors.name, associationId: issues.associationId })
    .from(issues).innerJoin(vendors, eq(vendors.id, issues.vendorId))
    .where(and(open, inArray(issues.status, ['Assigned', 'In Progress']), lt(issues.lastActivityAt, new Date(now.getTime() - 24 * HOUR)),
      or(isNull(issues.lastReminderAt), lt(issues.lastReminderAt, new Date(now.getTime() - 24 * HOUR)))));
  for (const i of quiet) {
    await notify(db, await staffOfSociety(db, i.associationId), { kind: 'issues', title: `Chase ${i.vendor}: ${ref(i.number)}`, body: `No update for 24 hours · ${i.title}`, href: '/issues/' + ref(i.number) });
    await db.update(issues).set({ lastReminderAt: now }).where(eq(issues.id, i.id));
    await audit(db, i.associationId, null, 'System (follow-up)', `reminder to chase ${i.vendor} on ${ref(i.number)} — no update for 24 hours`);
    reminded++;
  }

  const late = await db.select({ id: issues.id, number: issues.number, title: issues.title, priority: issues.priority, associationId: issues.associationId })
    .from(issues).where(and(open, lt(issues.slaDueAt, now), isNull(issues.escalatedAt)));
  for (const i of late) {
    await notify(db, await staffOfSociety(db, i.associationId, ['admin', 'committee']), { kind: 'issues', title: `Overdue: ${ref(i.number)}`, body: `${i.priority} priority · ${i.title}`, href: '/issues/' + ref(i.number) });
    await db.update(issues).set({ escalatedAt: now }).where(eq(issues.id, i.id));
    await audit(db, i.associationId, null, 'System (SLA)', `escalated ${ref(i.number)} — past its response time`);
    escalated++;
  }
  return { reminded, escalated };
}

/** The reports the Maintenance brief lists, computed from the tickets themselves. */
export async function maintenanceReport(db: Pick<DB, 'select' | 'execute'>, associationId: string, from: Date, to: Date) {
  const rows = async <T>(q: ReturnType<typeof sql>) => ((await db.execute(q)) as unknown as { rows: T[] }).rows;
  const range = sql`i.association_id = ${associationId} and i.created_at >= ${from.toISOString()} and i.created_at < ${to.toISOString()}`;
  const resolvedAt = sql`(select min(e.created_at) from issue_events e where e.issue_id = i.id and e.status = 'Resolved')`;

  const [totals] = await rows<{ total: number; open: number; completed: number; emergency: number; on_hold: number; sla_met: number; sla_missed: number }>(sql`
    select count(*)::int total,
      count(*) filter (where i.status not in ('Resolved','Closed'))::int open,
      count(*) filter (where i.status in ('Resolved','Closed'))::int completed,
      count(*) filter (where i.priority = 'Emergency')::int emergency,
      count(*) filter (where i.status = 'On Hold')::int on_hold,
      count(*) filter (where i.status in ('Resolved','Closed') and ${resolvedAt} <= i.sla_due_at)::int sla_met,
      count(*) filter (where (i.status in ('Resolved','Closed') and ${resolvedAt} > i.sla_due_at) or (i.status not in ('Resolved','Closed') and i.sla_due_at < now()))::int sla_missed
    from issues i where ${range}`);
  const byCategory = await rows<{ category: string; total: number; open: number }>(sql`
    select i.category, count(*)::int total, count(*) filter (where i.status not in ('Resolved','Closed'))::int open
    from issues i where ${range} group by i.category order by total desc`);
  const byPlace = await rows<{ place: string; total: number }>(sql`
    select coalesce(case when i.scope = 'common' then 'Common · ' || coalesce(i.asset, 'area') end, u.tower, 'Unspecified') place, count(*)::int total
    from issues i left join units u on u.id = i.unit_id where ${range} group by 1 order by total desc`);
  const byVendor = await rows<{ vendor: string; jobs: number; completed: number; avg_hours: number | null; rating: number | null; spent: number }>(sql`
    select v.name vendor, count(*)::int jobs,
      count(*) filter (where i.status in ('Resolved','Closed'))::int completed,
      round(avg(extract(epoch from (${resolvedAt} - i.created_at)) / 3600) filter (where i.status in ('Resolved','Closed')))::int avg_hours,
      round(avg(i.rating), 1)::float rating,
      coalesce((select sum(n.amount) from issue_invoices n join issues j on j.id = n.issue_id where n.vendor_id = v.id and n.status in ('Approved','Paid') and j.created_at >= ${from.toISOString()} and j.created_at < ${to.toISOString()}), 0)::int spent
    from issues i join vendors v on v.id = i.vendor_id where ${range} group by v.id, v.name order by jobs desc`);
  const expenseByCategory = await rows<{ category: string; amount: number }>(sql`
    select i.category, sum(n.amount)::int amount from issue_invoices n join issues i on i.id = n.issue_id
    where ${range} and n.status in ('Approved','Paid') group by i.category order by amount desc`);
  return { from, to, totals, byCategory, byPlace, byVendor, expenseByCategory };
}

