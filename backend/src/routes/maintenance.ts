import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../app.js';
import type { DB } from '../db/client.js';
import { associations, expenses, issueEvents, issueInvoices, issueMessages, issues, unitMembers, units, users, vendors, type StaffRole } from '../db/schema.js';
import { audit } from '../lib/audit.js';
import { residentOf, staffOf, userIdFrom } from '../lib/auth.js';
import { notify } from '../lib/community.js';
import { changes, badRequest, conflict, forbidden, notFound, parse } from '../lib/http.js';
import { addExpense, payExpense } from '../lib/finance.js';
import { byCode, byRole, chartOf } from '../lib/ledger.js';
import { CATEGORIES, COMMON_ASSETS, createIssue, loadIssue, parseRef, ref } from '../lib/issues.js';
import { applyEstimate, maintenanceReport, staffOfSociety, sweep } from '../lib/maintenance.js';

const Aid = z.object({ aid: z.uuid() });
const AidRef = Aid.extend({ ref: z.string() });
const Ref = z.object({ ref: z.string() });
const Message = z.object({ text: z.string().trim().max(2000).default(''), attachmentUrl: z.string().optional() }).refine(m => m.text || m.attachmentUrl, 'Write a message or attach a file');

/**
 * Maintenance, completed: in-ticket messaging, estimates and approvals, vendors, invoices, reports.
 * Vendors don't use the app — the manager (society admin or VPM) records what the vendor did.
 */
export const maintenanceRoutes = ({ config, db }: Deps): FastifyPluginAsync => async app => {
  const uid = (req: FastifyRequest) => userIdFrom(req, config.JWT_SECRET);
  const staff = async (req: FastifyRequest, roles: StaffRole[] = ['admin', 'committee', 'operator']) => {
    const { aid } = parse(Aid, req.params);
    return { aid, s: await staffOf(db, await uid(req), aid, roles) };
  };
  const ownFile = (u?: string) => { if (u && !u.startsWith(config.PUBLIC_URL + '/files/')) throw badRequest('invalid_file', 'Attachments must come from /v1/uploads.'); return u ?? null; };
  const touch = (issueId: string) => db.update(issues).set({ lastActivityAt: new Date() }).where(eq(issues.id, issueId));
  const thread = (issueId: string, which: 'resident' | 'vendor') =>
    db.select({ id: issueMessages.id, from: issueMessages.fromRole, by: users.name, text: issueMessages.text, attachmentUrl: issueMessages.attachmentUrl, at: issueMessages.createdAt })
      .from(issueMessages).leftJoin(users, eq(users.id, issueMessages.fromUserId))
      .where(and(eq(issueMessages.issueId, issueId), eq(issueMessages.thread, which))).orderBy(asc(issueMessages.createdAt));
  const find = async (aid: string, r: string) => {
    const [i] = await db.select().from(issues).where(and(eq(issues.associationId, aid), eq(issues.number, parseRef(r))));
    if (!i) throw notFound('Issue');
    return i;
  };

  /* =============== resident =============== */
  app.get('/maintenance/options', async req => {
    await residentOf(db, await uid(req));
    return { categories: CATEGORIES, commonAssets: COMMON_ASSETS, priorities: ['Low', 'Medium', 'High', 'Emergency'] };
  });

  /** a request about shared equipment or space — it belongs to no flat, so anyone can raise it */
  app.post('/issues/common', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const r = await residentOf(db, await uid(req));
    const b = parse(z.object({
      title: z.string().trim().min(4).max(120), details: z.string().trim().max(2000).optional(), category: z.enum(CATEGORIES), asset: z.enum(COMMON_ASSETS),
      location: z.string().trim().max(80).optional(), priority: z.enum(['Low', 'Medium', 'High', 'Emergency']), photoUrl: z.string().optional(),
    }), req.body);
    const row = await createIssue(db, { ...b, photoUrl: ownFile(b.photoUrl) ?? undefined, location: b.location || b.asset, scope: 'common', via: 'form', associationId: r.associationId, reporterId: r.userId, reporterName: r.name, unitId: null });
    await announceNew(db, row.associationId, row.number, row.title, row.priority);
    return reply.status(201).send(await loadIssue(db, r.associationId, row.number, { viewerId: r.userId }));
  });

  /** the resident ↔ office conversation inside a ticket */
  app.get('/issues/:ref/messages', async req => {
    const r = await residentOf(db, await uid(req));
    const i = await find(r.associationId, parse(Ref, req.params).ref);
    if (i.reporterId !== r.userId) throw forbidden('You can only open issues you reported.');
    return thread(i.id, 'resident');
  });
  app.post('/issues/:ref/messages', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req, reply) => {
    const r = await residentOf(db, await uid(req));
    const i = await find(r.associationId, parse(Ref, req.params).ref);
    if (i.reporterId !== r.userId) throw forbidden('You can only message on issues you reported.');
    const b = parse(Message, req.body);
    await db.insert(issueMessages).values({ issueId: i.id, thread: 'resident', fromUserId: r.userId, fromRole: 'resident', text: b.text, attachmentUrl: ownFile(b.attachmentUrl) });
    await touch(i.id);
    await notify(db, await staffOfSociety(db, r.associationId), { kind: 'issues', title: `Message on ${ref(i.number)}`, body: `${r.name}: ${b.text.slice(0, 120)}`, href: '/issues/' + ref(i.number) });
    return reply.status(201).send(await thread(i.id, 'resident'));
  });

  /** the resident confirms the fix (or it auto-closes later): Resolved → Closed */
  app.post('/issues/:ref/confirm', async req => {
    const r = await residentOf(db, await uid(req));
    const i = await find(r.associationId, parse(Ref, req.params).ref);
    if (i.reporterId !== r.userId) throw forbidden('You can only confirm issues you reported.');
    if (i.status !== 'Resolved') throw conflict('not_resolved', 'Only a resolved issue can be confirmed.');
    await db.update(issues).set({ status: 'Closed', lastActivityAt: new Date() }).where(eq(issues.id, i.id));
    await db.insert(issueEvents).values({ issueId: i.id, status: 'Closed', note: 'Confirmed fixed by the resident', byUserId: r.userId });
    return loadIssue(db, r.associationId, i.number, { viewerId: r.userId });
  });

  /* =============== society admin =============== */
  /** log a request for someone who called or walked in, or a common-area job the office spotted itself */
  app.post('/admin/:aid/issues', async (req, reply) => {
    const { aid, s } = await staff(req, ['admin', 'operator']);
    const b = parse(z.object({
      title: z.string().trim().min(4).max(120), details: z.string().trim().max(2000).optional(), category: z.enum(CATEGORIES),
      location: z.string().trim().min(2).max(80), priority: z.enum(['Low', 'Medium', 'High', 'Emergency']),
      scope: z.enum(['unit', 'common']).default('common'), asset: z.enum(COMMON_ASSETS).optional(), unitId: z.uuid().optional(), reporterId: z.uuid().optional(),
    }), req.body);
    const row = await createIssue(db, { ...b, via: 'admin', associationId: aid, reporterId: b.reporterId ?? s.userId, reporterName: s.name, unitId: b.unitId ?? null });
    return reply.status(201).send(await loadIssue(db, aid, row.number, { internal: true }));
  });

  /** Estimate the cost. Over the society's limit, it waits for the committee before work can start. */
  app.put('/admin/:aid/issues/:ref/estimate', async req => {
    const { aid, s } = await staff(req, ['admin', 'operator']);
    const i = await find(aid, parse(AidRef, req.params).ref);
    const { amount } = parse(z.object({ amount: z.number().int().min(0).max(100_000_000) }), req.body);
    await applyEstimate(db, aid, i, amount, s);
    return loadIssue(db, aid, i.number, { internal: true });
  });

  app.post('/admin/:aid/issues/:ref/approval', async req => {
    const { aid, s } = await staff(req, ['committee', 'admin', 'operator']);
    const i = await find(aid, parse(AidRef, req.params).ref);
    const { decision, note } = parse(z.object({ decision: z.enum(['approved', 'rejected']), note: z.string().trim().max(500).optional() }), req.body);
    if (i.approval !== 'pending') throw conflict('nothing_to_approve', 'This issue has no estimate waiting for approval.');
    await db.update(issues).set({ approval: decision, approvalBy: s.userId, lastActivityAt: new Date() }).where(eq(issues.id, i.id));
    await audit(db, aid, s.userId, s.name, `estimate ${decision} on ${ref(i.number)} (₹${i.costEstimate})${note ? ' · “' + note.slice(0, 60) + '”' : ''}`);
    return loadIssue(db, aid, i.number, { internal: true });
  });

  app.put('/admin/:aid/approval-limit', async req => {
    const { aid, s } = await staff(req, ['admin', 'operator']);
    const { limit } = parse(z.object({ limit: z.number().int().min(0).max(100_000_000) }), req.body);
    await db.update(associations).set({ approvalLimit: limit }).where(eq(associations.id, aid));
    await audit(db, aid, s.userId, s.name, `repair approval limit set to ₹${limit}`);
    return { limit };
  });

  /** the conversation with the resident */
  app.get('/admin/:aid/issues/:ref/messages', async req => {
    const { aid } = await staff(req);
    const i = await find(aid, parse(AidRef, req.params).ref);
    return thread(i.id, 'resident');
  });
  app.post('/admin/:aid/issues/:ref/messages', async (req, reply) => {
    const { aid, s } = await staff(req, ['admin', 'operator']);
    const i = await find(aid, parse(AidRef, req.params).ref);
    const b = parse(Message, req.body);
    await db.insert(issueMessages).values({ issueId: i.id, thread: 'resident', fromUserId: s.userId, fromRole: 'staff', text: b.text, attachmentUrl: ownFile(b.attachmentUrl) });
    await touch(i.id);
    if (i.reporterId) await notify(db, [i.reporterId], { kind: 'issues', title: `Message on ${ref(i.number)}`, body: b.text.slice(0, 120), href: '/issues/' + ref(i.number) });
    return reply.status(201).send(await thread(i.id, 'resident'));
  });

  /* ----- vendors ----- */
  app.get('/admin/:aid/vendor-list', async req => {
    const { aid } = await staff(req);
    return db.select({
      id: vendors.id, name: vendors.name, category: vendors.category, contact: vendors.contact, phone: vendors.phone, email: vendors.email, serviceArea: vendors.serviceArea,
      active: vendors.active,
      openJobs: sql<number>`(select count(*)::int from issues i where i.vendor_id = ${vendors.id} and i.status not in ('Resolved','Closed'))`,
      rating: sql<number | null>`(select round(avg(i.rating), 1)::float from issues i where i.vendor_id = ${vendors.id})`,
    }).from(vendors).where(eq(vendors.associationId, aid)).orderBy(vendors.name);
  });

  /** Add a vendor the society uses. A record to assign jobs to and call — vendors don't sign in. */
  app.post('/admin/:aid/vendor-list', async (req, reply) => {
    const { aid, s } = await staff(req, ['admin', 'operator']);
    const b = parse(z.object({
      name: z.string().trim().min(2).max(80), category: z.string().trim().min(2).max(40), contact: z.string().trim().max(80).default(''),
      phone: z.string().trim().max(20).default(''), email: z.email().optional(), serviceArea: z.string().trim().max(80).default(''),
    }), req.body);
    const [row] = await db.insert(vendors).values({ associationId: aid, name: b.name, category: b.category, contact: b.contact, phone: b.phone, email: b.email ?? '', serviceArea: b.serviceArea }).returning();
    await audit(db, aid, s.userId, s.name, `vendor added · ${b.name} (${b.category})`);
    return reply.status(201).send(row);
  });

  app.put('/admin/:aid/vendor-list/:id', async req => {
    const { aid, s } = await staff(req, ['admin', 'operator']);
    const { id } = parse(Aid.extend({ id: z.uuid() }), req.params);
    const b = parse(z.object({ name: z.string().trim().min(2).max(80), category: z.string().trim().min(2).max(40), contact: z.string().trim().max(80), phone: z.string().trim().max(20), email: z.email(), serviceArea: z.string().trim().max(80), active: z.boolean() }).partial(), req.body);
    const [v] = await db.update(vendors).set(changes(b)).where(and(eq(vendors.id, id), eq(vendors.associationId, aid))).returning();
    if (!v) throw notFound('Vendor');
    await audit(db, aid, s.userId, s.name, `vendor updated · ${v.name}${b.active === false ? ' · deactivated' : ''}`);
    return v;
  });

  /**
   * Where the vendor is with the job, recorded by the manager after speaking to them:
   * Accepted → Scheduled → Visited → Completed. Accepting starts work on the ticket; completing resolves it
   * and asks the resident to confirm and rate.
   */
  app.post('/admin/:aid/issues/:ref/vendor-progress', async req => {
    const { aid, s } = await staff(req, ['admin', 'operator']);
    const i = await find(aid, parse(AidRef, req.params).ref);
    const b = parse(z.object({ state: z.enum(['Accepted', 'Scheduled', 'Visited', 'Completed']), note: z.string().trim().max(500).optional(), scheduledAt: z.iso.datetime({ offset: true }).optional() }), req.body);
    if (!i.vendorId) throw conflict('no_vendor', 'Assign a vendor first.');
    if (['Resolved', 'Closed'].includes(i.status)) throw conflict('job_done', 'This work order is already complete.');
    if (b.state === 'Scheduled' && !b.scheduledAt) throw badRequest('time_required', 'Say when the visit is scheduled.');
    if (i.approval === 'pending' && b.state !== 'Accepted') throw conflict('approval_pending', 'The estimate is waiting for approval.');
    if (i.ownerApproval === 'pending' && b.state !== 'Accepted') throw conflict('owner_approval_pending', 'The estimate is waiting for the flat owner’s approval.');
    if (i.approval === 'rejected') throw conflict('approval_rejected', 'The estimate for this repair was rejected. Revise it first.');
    const [v] = await db.select({ name: vendors.name }).from(vendors).where(eq(vendors.id, i.vendorId));
    const done = b.state === 'Completed';
    const status = done ? 'Resolved' as const : i.status === 'Assigned' || i.status === 'On Hold' ? 'In Progress' as const : i.status;
    await db.transaction(async tx => {
      await tx.update(issues).set({ vendorState: b.state, status, lastActivityAt: new Date(), ...(b.scheduledAt ? { scheduledAt: new Date(b.scheduledAt) } : {}) }).where(eq(issues.id, i.id));
      const when = b.scheduledAt ? ' for ' + new Date(b.scheduledAt).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '';
      const line = { Accepted: `${v?.name ?? 'Vendor'} confirmed the job`, Scheduled: `Visit scheduled${when}`, Visited: `${v?.name ?? 'Vendor'} visited`, Completed: 'Work completed' }[b.state] + (b.note ? ' · ' + b.note : '');
      await tx.insert(issueEvents).values({ issueId: i.id, status, note: line, byUserId: s.userId });
      if (i.reporterId) await notify(tx, [i.reporterId], { kind: 'issues', title: done ? `${ref(i.number)} resolved — please confirm` : `Update on ${ref(i.number)}`, body: done ? 'Tell us if it’s fixed, and rate the work.' : line, href: '/issues/' + ref(i.number) });
      await audit(tx, aid, s.userId, s.name, `${ref(i.number)} · vendor ${b.state.toLowerCase()}`);
    });
    return loadIssue(db, aid, i.number, { internal: true });
  });

  /** the vendor's bill, entered by the manager (photo of the bill optional) */
  app.post('/admin/:aid/issues/:ref/invoices', async (req, reply) => {
    const { aid, s } = await staff(req, ['admin', 'operator']);
    const i = await find(aid, parse(AidRef, req.params).ref);
    const b = parse(z.object({ amount: z.number().int().min(1).max(100_000_000), fileUrl: z.string().optional(), note: z.string().trim().max(500).default('') }), req.body);
    if (!i.vendorId) throw conflict('no_vendor', 'Assign a vendor first.');
    const [inv] = await db.insert(issueInvoices).values({ issueId: i.id, vendorId: i.vendorId, amount: b.amount, fileUrl: ownFile(b.fileUrl), note: b.note }).returning();
    await touch(i.id);
    await audit(db, aid, s.userId, s.name, `invoice ₹${b.amount} recorded on ${ref(i.number)}`);
    return reply.status(201).send(inv);
  });

  /* ----- invoices ----- */
  app.get('/admin/:aid/invoices', async req => {
    const { aid } = await staff(req);
    const rows = await db.select({ id: issueInvoices.id, number: issues.number, title: issues.title, vendor: vendors.name, amount: issueInvoices.amount, fileUrl: issueInvoices.fileUrl, note: issueInvoices.note, status: issueInvoices.status, createdAt: issueInvoices.createdAt })
      .from(issueInvoices).innerJoin(issues, eq(issues.id, issueInvoices.issueId)).innerJoin(vendors, eq(vendors.id, issueInvoices.vendorId))
      .where(eq(issues.associationId, aid)).orderBy(desc(issueInvoices.createdAt));
    return rows.map(({ number, ...r }) => ({ ...r, issue: ref(number) }));
  });

  /** Pending → Approved → Paid (or Rejected). An approved invoice becomes the job's actual cost. */
  /** keep the books in step with a vendor invoice: approved = an expense owed to the vendor, paid = settled from the bank */
  const booksFor = async (aid: string, inv: typeof issueInvoices.$inferSelect, issue: typeof issues.$inferSelect, status: 'Approved' | 'Paid' | 'Rejected', by: { userId: string; name: string }) => {
    try {
      const [had] = await db.select().from(expenses).where(eq(expenses.issueInvoiceId, inv.id));
      if (status === 'Approved' && !had) {
        const [v] = await db.select({ name: vendors.name }).from(vendors).where(eq(vendors.id, inv.vendorId));
        const chart = await chartOf(db, aid);
        // a let flat's repair is charged to its owner (taken from the rent held for them); anything else is the society's expense
        const let_ = issue.scope === 'unit' && issue.unitId ? (await db.select({ o: units.occupancy }).from(units).where(eq(units.id, issue.unitId)))[0]?.o === 'Rented' : false;
        await addExpense(db, aid, { payee: v?.name ?? 'Vendor', vendorId: inv.vendorId, accountId: let_ ? byRole(chart, 'owner_funds').id : byCode(chart, '5000').id, amount: inv.amount, description: `${ref(issue.number)} · ${issue.title}`.slice(0, 200),
          receiptUrl: inv.fileUrl, issueInvoiceId: inv.id }, by, { approved: true, chargeToOwner: let_ });
      } else if (status === 'Paid' && had?.status === 'Approved') {
        await payExpense(db, had, { mode: 'Bank transfer' }, by);
      }
    } catch (e) { app.log.warn(e, 'vendor invoice not posted to the books'); } // a closed month must not stop the maintenance desk; the expense can be booked by hand
  };

  app.post('/admin/:aid/invoices/:id/status', async req => {
    const { aid, s } = await staff(req, ['admin', 'operator']);
    const { id } = parse(Aid.extend({ id: z.uuid() }), req.params);
    const { status } = parse(z.object({ status: z.enum(['Approved', 'Paid', 'Rejected']) }), req.body);
    const [inv] = await db.select({ inv: issueInvoices, issue: issues }).from(issueInvoices).innerJoin(issues, eq(issues.id, issueInvoices.issueId)).where(and(eq(issueInvoices.id, id), eq(issues.associationId, aid)));
    if (!inv) throw notFound('Invoice');
    const ok = { Pending: ['Approved', 'Rejected'], Approved: ['Paid', 'Rejected'], Paid: [], Rejected: [] }[inv.inv.status] as string[];
    if (!ok.includes(status)) throw conflict('bad_transition', `An invoice that is ${inv.inv.status} can’t become ${status}.`);
    await db.update(issueInvoices).set({ status, decidedBy: s.userId }).where(eq(issueInvoices.id, id));
    if (status === 'Approved') {
      await db.update(issues).set({ costActual: sql`coalesce(${issues.costActual}, 0) + ${inv.inv.amount}` }).where(eq(issues.id, inv.issue.id));
    }
    await booksFor(aid, inv.inv, inv.issue, status, { userId: s.userId, name: s.name });
    await audit(db, aid, s.userId, s.name, `invoice ₹${inv.inv.amount} on ${ref(inv.issue.number)} · ${status}`);
    return { status };
  });

  /* ----- reports and follow-ups ----- */
  app.get('/admin/:aid/reports/maintenance', async req => {
    const { aid } = await staff(req);
    const q = parse(z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() }), req.query);
    const to = q.to ? new Date(q.to + 'T23:59:59') : new Date();
    const from = q.from ? new Date(q.from) : new Date(to.getTime() - 30 * 864e5);
    return maintenanceReport(db, aid, from, to);
  });

  /** run the automatic follow-ups now (the server also runs them every 10 minutes) */
  app.post('/admin/:aid/follow-ups/run', async req => {
    await staff(req, ['admin', 'operator']);
    return sweep(db);
  });

};

/** every new request reaches the office; an emergency reaches the committee too, at once */
export async function announceNew(db: DB, associationId: string, number: number, title: string, priority: string) {
  const emergency = priority === 'Emergency';
  await notify(db, await staffOfSociety(db, associationId, emergency ? ['admin', 'committee'] : ['admin']), {
    kind: 'issues', title: emergency ? `EMERGENCY: ${ref(number)}` : `New request ${ref(number)}`, body: title, href: '/issues/' + ref(number),
  });
  if (emergency) await audit(db, associationId, null, 'System', `emergency request ${ref(number)} escalated to the office and committee`);
}
