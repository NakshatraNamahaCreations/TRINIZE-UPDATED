import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../app.js';
import {
  accounts, associations, bills, DEFAULT_OWNER_PORTAL, DOCUMENT_KINDS, documents, expenses, issueInvoices, issueMessages, issueNotes, issues, OCCUPANCY, ownerActivity, ownerPayouts, paymentAllocations, payments,
  standings, unitMembers, units, users, vendors, visits, type OwnerPortalSettings,
} from '../db/schema.js';
import { audit } from '../lib/audit.js';
import { staffOf, userIdFrom } from '../lib/auth.js';
import { notify } from '../lib/community.js';
import { billStatus, dueOf, rupees, unitBalances } from '../lib/finance.js';
import { changes, badRequest, conflict, forbidden, notFound, parse } from '../lib/http.js';
import { balances, byRole, chartOf, isDate, monthName, post, today } from '../lib/ledger.js';
import { likeOf, offsetOf, paged, PageQuery } from '../lib/paging.js';

const Id = z.object({ id: z.uuid() });
const Ymd = z.string().refine(isDate, 'Use a date like 2026-11-17');
const Range = z.object({ unitId: z.uuid().optional(), from: Ymd.optional(), to: Ymd.optional(), format: z.enum(['json', 'csv']).default('json') });
const ref = (n: number) => 'ISS-' + n;

function csv(reply: FastifyReply, name: string, head: string[], rows: (string | number | null)[][]) {
  const cell = (v: string | number | null) => { const s = v === null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s; };
  return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${name}.csv"`)
    .send('﻿' + [head, ...rows].map(r => r.map(cell).join(',')).join('\r\n'));
}

/**
 * Owner portal — a read-only window over accounting, maintenance and documents.
 *   /v1/owner/*                       the owner, in the app: only the flats they own
 *   /v1/admin/:aid/owners/* · /documents   the office: what owners may see, documents, payouts, who looked at what
 */
export const ownerRoutes = ({ config, db }: Deps): FastifyPluginAsync => async app => {
  const uid = (req: FastifyRequest) => userIdFrom(req, config.JWT_SECRET);
  const rows = async <T>(q: ReturnType<typeof sql>) => ((await db.execute(q)) as unknown as { rows: T[] }).rows;
  const settingsOf = async (aid: string): Promise<OwnerPortalSettings> => {
    const [a] = await db.select({ s: associations.ownerPortal }).from(associations).where(eq(associations.id, aid));
    return { ...DEFAULT_OWNER_PORTAL, ...a?.s, reports: { ...DEFAULT_OWNER_PORTAL.reports, ...a?.s?.reports } };
  };

  /** the flats this person owns, in societies whose office has the portal switched on */
  const owned = async (req: FastifyRequest) => {
    const userId = await uid(req);
    const [me] = await db.select({ name: users.name }).from(users).where(and(eq(users.id, userId), isNull(users.deletedAt)));
    const mine = await db.select({ unitId: units.id, unit: units.code, label: units.label, associationId: units.associationId, society: associations.name, occupancy: units.occupancy,
      monthlyRent: units.monthlyRent, leaseEnd: units.leaseEnd, area: units.area, flatType: units.flatType })
      .from(unitMembers).innerJoin(units, eq(units.id, unitMembers.unitId)).innerJoin(associations, eq(associations.id, units.associationId))
      .where(and(eq(unitMembers.userId, userId), eq(unitMembers.role, 'Owner'), eq(unitMembers.status, 'active'))).orderBy(associations.name, units.code);
    if (!me || !mine.length) throw forbidden('The owner portal is for flat owners. This number isn’t recorded as the owner of any flat.');
    const access = new Map<string, OwnerPortalSettings>();
    for (const aid of new Set(mine.map(m => m.associationId))) access.set(aid, await settingsOf(aid));
    const open = mine.filter(m => access.get(m.associationId)!.enabled);
    if (!open.length) throw forbidden('The society office hasn’t opened the owner portal yet.');
    return { userId, name: me.name, units: open, access };
  };
  type Owned = Awaited<ReturnType<typeof owned>>;
  /** all my flats, or the one asked for — never anyone else's */
  const scope = (o: Owned, unitId?: string) => {
    if (!unitId) return o.units;
    const u = o.units.find(x => x.unitId === unitId);
    if (!u) throw notFound('That flat');
    return [u];
  };
  const seen = (o: Owned, list: Owned['units'], action: string) =>
    db.insert(ownerActivity).values([...new Set(list.map(u => u.associationId))].map(associationId => ({ associationId, userId: o.userId, action })));
  const period = (f: { from?: string; to?: string }) => {
    const to = f.to ?? today();
    return { from: f.from ?? `${Number(to.slice(0, 4)) - (to.slice(5, 7) < '04' ? 1 : 0)}-04-01`, to }; // the financial year so far
  };

  /* ---------- the numbers, for a set of flats ---------- */
  const rentRows = (ids: string[]) => db.select({ b: bills, unit: units.code }).from(bills).innerJoin(units, eq(units.id, bills.unitId))
    .where(and(inArray(bills.unitId, ids), isNull(bills.cancelledAt)));
  const collected = (ids: string[], from?: string, to?: string) => rows<{ unit_id: string; charge: string; amount: number; received_on: string; number: string }>(sql`
    select b.unit_id, b.charge_type as charge, a.amount, to_char(p.received_on, 'YYYY-MM-DD') as received_on, p.number
    from payment_allocations a join payments p on p.id = a.payment_id join bills b on b.id = a.bill_id
    where b.unit_id in (${sql.join(ids.map(i => sql`${i}::uuid`), sql`, `)}) and p.reversed_at is null
      and (${from ?? null}::date is null or p.received_on >= ${from ?? null}::date) and (${to ?? null}::date is null or p.received_on <= ${to ?? null}::date)`);
  const repairs = (ids: string[], from?: string, to?: string) => db.select({ unitId: issues.unitId, issue: issues.number, title: issues.title, category: issues.category, vendor: vendors.name, amount: issueInvoices.amount,
    status: issueInvoices.status, fileUrl: issueInvoices.fileUrl, at: issueInvoices.createdAt,
    /** taken from the rent held for the owner (the flat was let), rather than borne by the society */
    charged: sql<boolean>`coalesce(${accounts.role} = 'owner_funds', false)` })
    .from(issueInvoices).innerJoin(issues, eq(issues.id, issueInvoices.issueId)).innerJoin(vendors, eq(vendors.id, issueInvoices.vendorId))
    .leftJoin(expenses, eq(expenses.issueInvoiceId, issueInvoices.id)).leftJoin(accounts, eq(accounts.id, expenses.accountId))
    .where(and(inArray(issues.unitId, ids), eq(issues.scope, 'unit'), inArray(issueInvoices.status, ['Approved', 'Paid']),
      from ? gte(issueInvoices.createdAt, new Date(from + 'T00:00:00+05:30')) : undefined, to ? lte(issueInvoices.createdAt, new Date(to + 'T23:59:59+05:30')) : undefined)).orderBy(desc(issueInvoices.createdAt));
  const payouts = (ids: string[], from?: string, to?: string) => db.select().from(ownerPayouts)
    .where(and(inArray(ownerPayouts.unitId, ids), from ? gte(ownerPayouts.paidOn, from) : undefined, to ? lte(ownerPayouts.paidOn, to) : undefined)).orderBy(desc(ownerPayouts.paidOn));

  /** per flat: rent in, repairs out, what has been paid out, and what is still held for the owner */
  const figures = async (list: Owned['units'], from?: string, to?: string) => {
    const ids = list.map(u => u.unitId);
    const [allBills, got, gotEver, fixed, fixedEver, paid, paidEver] = await Promise.all([rentRows(ids), collected(ids, from, to), collected(ids), repairs(ids, from, to), repairs(ids), payouts(ids, from, to), payouts(ids)]);
    const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((n, x) => n + f(x), 0);
    return list.map(u => {
      const mine = allBills.filter(x => x.b.unitId === u.unitId).map(x => x.b);
      // a bill belongs to the month it was raised for, whenever it falls due
      const inRange = (b: typeof mine[number]) => (!from || b.period >= from.slice(0, 7)) && (!to || b.period <= to.slice(0, 7));
      const rent = mine.filter(b => b.chargeType === 'Rent'), other = mine.filter(b => b.chargeType !== 'Rent');
      const rentIn = sum(got.filter(g => g.unit_id === u.unitId && g.charge === 'Rent'), g => g.amount), spent = sum(fixed.filter(f => f.unitId === u.unitId), f => f.amount);
      const deducted = sum(fixed.filter(f => f.unitId === u.unitId && f.charged), f => f.amount);
      const held = sum(gotEver.filter(g => g.unit_id === u.unitId && g.charge === 'Rent'), g => g.amount) - sum(fixedEver.filter(f => f.unitId === u.unitId && f.charged), f => f.amount) - sum(paidEver.filter(p => p.unitId === u.unitId), p => p.amount);
      return {
        unitId: u.unitId, unit: u.unit, society: u.society, occupancy: u.occupancy, monthlyRent: u.monthlyRent,
        rentBilled: sum(rent.filter(inRange), b => b.amount), rentCollected: rentIn, rentPending: sum(rent, dueOf),
        chargesBilled: sum(other.filter(inRange), b => b.amount), chargesPaid: sum(got.filter(g => g.unit_id === u.unitId && g.charge !== 'Rent'), g => g.amount), chargesPending: sum(other, dueOf),
        repairs: spent, repairsDeducted: deducted, net: rentIn - deducted, paidOut: sum(paid.filter(p => p.unitId === u.unitId), p => p.amount), heldForOwner: held,
      };
    });
  };
  const total = <T extends Record<string, unknown>>(list: T[], keys: (keyof T)[]) => Object.fromEntries(keys.map(k => [k, list.reduce((n, x) => n + (x[k] as number), 0)])) as Record<keyof T, number>;

  /* ================= the owner ================= */
  app.get('/owner/me', async req => {
    const o = await owned(req);
    const tenants = await db.select({ unitId: unitMembers.unitId, name: users.name }).from(unitMembers).innerJoin(users, eq(users.id, unitMembers.userId))
      .where(and(inArray(unitMembers.unitId, o.units.map(u => u.unitId)), eq(unitMembers.role, 'Tenant'), eq(unitMembers.status, 'active')));
    return { name: o.name, properties: o.units.map(u => ({ ...u, tenant: tenants.find(t => t.unitId === u.unitId)?.name ?? null, access: o.access.get(u.associationId) })) };
  });

  app.get('/owner/dashboard', async req => {
    const o = await owned(req);
    const { unitId } = parse(z.object({ unitId: z.uuid().optional() }), req.query);
    const list = scope(o, unitId), ids = list.map(u => u.unitId);
    const month = today().slice(0, 8) + '01';
    const f = await figures(list, month, today());
    const t = total(f, ['rentCollected', 'rentPending', 'repairs', 'repairsDeducted', 'net', 'chargesPending', 'heldForOwner']);
    const visible = list.filter(u => o.access.get(u.associationId)!.showRequests).map(u => u.unitId);
    const openReq = visible.length ? await db.select({ id: issues.id, ownerApproval: issues.ownerApproval }).from(issues)
      .where(and(inArray(issues.unitId, visible), eq(issues.scope, 'unit'), sql`${issues.status} not in ('Resolved', 'Closed')`)) : [];
    const docs = await db.select({ id: documents.id, title: documents.title, kind: documents.kind, createdAt: documents.createdAt }).from(documents)
      .where(and(eq(documents.shared, true), or(inArray(documents.unitId, ids), and(isNull(documents.unitId), inArray(documents.associationId, [...new Set(list.map(u => u.associationId))]))))).orderBy(desc(documents.createdAt)).limit(3);
    const soon = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
    const expiring = list.filter(u => u.occupancy === 'Rented' && u.leaseEnd && u.leaseEnd <= soon).map(u => ({ unit: u.unit, leaseEnd: u.leaseEnd! }));
    const vacant = list.filter(u => u.occupancy === 'Vacant');
    const alerts = openReq.filter(r => r.ownerApproval === 'pending').length;
    // a plain-words summary, worked out from the same numbers shown on the cards
    const parts = [
      list.some(u => u.occupancy === 'Rented') ? (t.rentCollected ? `${rupees(t.rentCollected)} of rent has come in this month` : 'No rent has been received yet this month') + (t.rentPending ? `, with ${rupees(t.rentPending)} still pending` : '') + '.' : null,
      t.repairs ? `Repairs on your ${list.length === 1 ? 'flat' : 'flats'} cost ${rupees(t.repairs)} this month${t.repairsDeducted ? `; ${rupees(t.repairsDeducted)} was taken from the rent, leaving ${rupees(t.net)} net` : ''}.` : null,
      vacant.length ? `${vacant.map(u => u.unit).join(', ')} ${vacant.length === 1 ? 'is' : 'are'} vacant${vacant.some(u => u.monthlyRent) ? ` — about ${rupees(vacant.reduce((n, u) => n + u.monthlyRent, 0))} a month of rent not being earned` : ''}.` : null,
      alerts ? `${alerts} repair ${alerts === 1 ? 'estimate is' : 'estimates are'} waiting for your approval.` : null,
      expiring.length ? `The lease on ${expiring.map(e => e.unit).join(', ')} ends within 60 days.` : null,
      t.chargesPending ? `${rupees(t.chargesPending)} of society charges on your ${list.length === 1 ? 'flat is' : 'flats are'} unpaid.` : null,
    ].filter(Boolean);
    await seen(o, list, 'Opened the dashboard');
    return {
      month: monthName(today().slice(0, 7)), flats: list.length,
      income: t.rentCollected, expenses: t.repairsDeducted, repairs: t.repairs, net: t.net, pendingRent: t.rentPending, societyChargesPending: t.chargesPending, upcomingPayout: Math.max(0, t.heldForOwner),
      occupancy: { rented: list.filter(u => u.occupancy === 'Rented').length, ownerOccupied: list.filter(u => u.occupancy === 'Owner-occupied').length, vacant: vacant.length },
      openRequests: openReq.length, approvalsWaiting: alerts, leaseExpiring: expiring, latestDocuments: docs,
      summary: parts.length ? parts.join(' ') : 'Nothing needs your attention: no rent pending, no repairs this month and nothing waiting for approval.',
      byFlat: f,
    };
  });

  /** the owner statement: rent, repairs, payouts and what is still held — per flat, for a period */
  app.get('/owner/statement', async (req, reply) => {
    const o = await owned(req);
    const q = parse(Range, req.query), list = scope(o, q.unitId).filter(u => o.access.get(u.associationId)!.reports.statement);
    if (!list.length) throw forbidden('The society office hasn’t shared the owner statement.');
    const { from, to } = period(q);
    const f = await figures(list, from, to);
    await seen(o, list, 'Viewed the owner statement');
    if (q.format === 'csv') return csv(reply, `owner-statement-${to}`, ['Flat', 'Society', 'Rent billed', 'Rent collected', 'Rent pending', 'Repairs on the flat', 'Repairs taken from rent', 'Net income', 'Paid to owner', 'Held for owner', 'Society charges pending'],
      f.map(x => [x.unit, x.society, x.rentBilled, x.rentCollected, x.rentPending, x.repairs, x.repairsDeducted, x.net, x.paidOut, x.heldForOwner, x.chargesPending]));
    return { from, to, flats: f, totals: total(f, ['rentBilled', 'rentCollected', 'rentPending', 'repairs', 'repairsDeducted', 'net', 'paidOut', 'heldForOwner', 'chargesBilled', 'chargesPaid', 'chargesPending']) };
  });

  /** every money movement on my flats: bills, receipts, repairs, payouts */
  app.get('/owner/transactions', async (req, reply) => {
    const o = await owned(req);
    const q = parse(Range.extend({ kind: z.enum(['bill', 'payment', 'repair', 'payout']).optional() }), req.query), list = scope(o, q.unitId).filter(u => o.access.get(u.associationId)!.reports.transactions);
    if (!list.length) throw forbidden('The society office hasn’t shared the transaction log.');
    const { from, to } = period(q), ids = list.map(u => u.unitId), code = (id: string | null) => list.find(u => u.unitId === id)?.unit ?? '';
    const [bs, ps, rs, os] = await Promise.all([
      rentRows(ids),
      db.select().from(payments).where(and(inArray(payments.unitId, ids), isNull(payments.reversedAt), gte(payments.receivedOn, from), lte(payments.receivedOn, to))),
      repairs(ids, from, to), payouts(ids, from, to),
    ]);
    const all = [
      ...bs.filter(x => x.b.period >= from.slice(0, 7) && x.b.period <= to.slice(0, 7)).map(x => ({ date: x.b.dueDate, unit: x.unit, kind: 'bill' as const, what: `${x.b.chargeType} · ${monthName(x.b.period)}`, ref: x.b.number, moneyIn: 0, moneyOut: 0, billed: x.b.amount, status: billStatus(x.b) as string })),
      ...ps.map(p => ({ date: p.receivedOn, unit: code(p.unitId), kind: 'payment' as const, what: `Payment received · ${p.mode}`, ref: p.number, moneyIn: p.amount, moneyOut: 0, billed: 0, status: 'Received' })),
      ...rs.map(r => ({ date: r.at.toISOString().slice(0, 10), unit: code(r.unitId), kind: 'repair' as const, what: `${r.title} · ${r.vendor}`, ref: ref(r.issue), moneyIn: 0, moneyOut: r.amount, billed: 0, status: r.status as string })),
      ...os.map(p => ({ date: p.paidOn, unit: code(p.unitId), kind: 'payout' as const, what: `Paid to owner · ${p.mode}${p.reference ? ' ' + p.reference : ''}`, ref: '', moneyIn: 0, moneyOut: p.amount, billed: 0, status: 'Paid' })),
    ].filter(x => !q.kind || x.kind === q.kind).sort((a, b) => b.date.localeCompare(a.date));
    await seen(o, list, 'Viewed the transaction log');
    if (q.format === 'csv') return csv(reply, `transactions-${to}`, ['Date', 'Flat', 'Type', 'Particulars', 'Reference', 'Billed', 'Money in', 'Money out', 'Status'], all.map(x => [x.date, x.unit, x.kind, x.what, x.ref, x.billed || null, x.moneyIn || null, x.moneyOut || null, x.status]));
    return { from, to, rows: all };
  });

  /** what the repairs on my flats cost, by category and by vendor */
  app.get('/owner/expenses', async (req, reply) => {
    const o = await owned(req);
    const q = parse(Range, req.query), list = scope(o, q.unitId).filter(u => o.access.get(u.associationId)!.reports.expenses);
    if (!list.length) throw forbidden('The society office hasn’t shared the expense report.');
    const { from, to } = period(q), r = await repairs(list.map(u => u.unitId), from, to);
    const group = (key: (x: typeof r[number]) => string) => Object.entries(r.reduce<Record<string, { jobs: number; amount: number }>>((m, x) => { const k = key(x); (m[k] ??= { jobs: 0, amount: 0 }).jobs++; m[k]!.amount += x.amount; return m; }, {}))
      .map(([name, v]) => ({ name, ...v })).sort((a, b) => b.amount - a.amount);
    await seen(o, list, 'Viewed the expense report');
    const lines = r.map(x => ({ date: x.at.toISOString().slice(0, 10), unit: list.find(u => u.unitId === x.unitId)?.unit ?? '', ref: ref(x.issue), title: x.title, category: x.category, vendor: x.vendor, amount: x.amount, status: x.status, billUrl: x.fileUrl }));
    if (q.format === 'csv') return csv(reply, `repairs-${to}`, ['Date', 'Flat', 'Request', 'What', 'Category', 'Vendor', 'Amount', 'Status'], lines.map(l => [l.date, l.unit, l.ref, l.title, l.category, l.vendor, l.amount, l.status]));
    return { from, to, total: r.reduce((n, x) => n + x.amount, 0), byCategory: group(x => x.category), byVendor: group(x => x.vendor), lines };
  });

  /** the society's own income and expenditure and balance sheet — only where the office allows owners to see them */
  app.get('/owner/society-accounts', async req => {
    const o = await owned(req);
    const { associationId } = parse(z.object({ associationId: z.uuid() }), req.query);
    if (!o.units.some(u => u.associationId === associationId) || !o.access.get(associationId)!.reports.societyAccounts) throw forbidden('The society office hasn’t shared its accounts with owners.');
    const { from, to } = period({});
    const p = await balances(db, associationId, { from, to }), b = await balances(db, associationId, { to });
    const pick = (list: typeof p, kind: string) => list.filter(a => a.kind === kind && a.balance).map(a => ({ name: a.name, amount: a.balance }));
    const sum = (xs: { amount: number }[]) => xs.reduce((n, x) => n + x.amount, 0);
    const income = pick(p, 'income'), expenses = pick(p, 'expense');
    const surplusToDate = sum(pick(b, 'income')) - sum(pick(b, 'expense'));
    await db.insert(ownerActivity).values({ associationId, userId: o.userId, action: 'Viewed the society accounts' });
    return { from, to, income, expenses, surplus: sum(income) - sum(expenses),
      assets: pick(b, 'asset'), liabilities: pick(b, 'liability'), funds: [...pick(b, 'equity'), { name: 'Surplus to date', amount: surplusToDate }] };
  });

  /* ---- repairs on my flats ---- */
  const requestOut = (i: typeof issues.$inferSelect, unit: string, s: OwnerPortalSettings, vendor: string | null) => ({
    ref: ref(i.number), unit, title: i.title, category: i.category, priority: i.priority, status: i.status, vendor, createdAt: i.createdAt,
    ...(s.showCosts ? { costEstimate: i.costEstimate, costActual: i.costActual } : {}),
    ownerApproval: i.ownerApproval, canApprove: i.ownerApproval === 'pending',
  });
  app.get('/owner/requests', async req => {
    const o = await owned(req);
    const { unitId, open } = parse(z.object({ unitId: z.uuid().optional(), open: z.enum(['1', '0']).optional() }), req.query);
    const list = scope(o, unitId).filter(u => o.access.get(u.associationId)!.showRequests);
    if (!list.length) return [];
    const found = await db.select({ i: issues, vendor: vendors.name }).from(issues).leftJoin(vendors, eq(vendors.id, issues.vendorId))
      .where(and(inArray(issues.unitId, list.map(u => u.unitId)), eq(issues.scope, 'unit'), open === '1' ? sql`${issues.status} not in ('Resolved', 'Closed')` : undefined)).orderBy(desc(issues.createdAt)).limit(300);
    return found.map(x => { const u = list.find(l => l.unitId === x.i.unitId)!; return requestOut(x.i, u.unit, o.access.get(u.associationId)!, x.vendor); });
  });
  const myRequest = async (req: FastifyRequest) => {
    const o = await owned(req);
    const n = Number(String((req.params as { ref: string }).ref).replace(/^ISS-/i, ''));
    const visible = o.units.filter(u => o.access.get(u.associationId)!.showRequests);
    const [x] = Number.isInteger(n) && visible.length ? await db.select({ i: issues, vendor: vendors.name }).from(issues).leftJoin(vendors, eq(vendors.id, issues.vendorId))
      .where(and(eq(issues.number, n), inArray(issues.unitId, visible.map(u => u.unitId)), eq(issues.scope, 'unit'))) : [];
    if (!x) throw notFound('That request');
    const u = visible.find(l => l.unitId === x.i.unitId)!;
    return { o, i: x.i, vendor: x.vendor, u, s: o.access.get(u.associationId)! };
  };
  app.get('/owner/requests/:ref', async req => {
    const { o, i, vendor, u, s } = await myRequest(req);
    const invoices = s.showCosts ? await db.select({ amount: issueInvoices.amount, status: issueInvoices.status, note: issueInvoices.note, fileUrl: issueInvoices.fileUrl, at: issueInvoices.createdAt }).from(issueInvoices).where(eq(issueInvoices.issueId, i.id)) : [];
    const thread = s.showMessages ? await db.select({ from: issueMessages.fromRole, text: issueMessages.text, at: issueMessages.createdAt }).from(issueMessages)
      .where(and(eq(issueMessages.issueId, i.id), eq(issueMessages.thread, 'resident'))).orderBy(asc(issueMessages.createdAt)) : null;
    await db.insert(ownerActivity).values({ associationId: u.associationId, userId: o.userId, action: `Opened repair ${ref(i.number)}` });
    return { ...requestOut(i, u.unit, s, vendor), location: i.location, invoices, messages: thread };
  });
  /** a repair above the society's limit waits for the owner's yes or no */
  app.post('/owner/requests/:ref/approval', async req => {
    const { o, i, u, vendor, s } = await myRequest(req);
    const b = parse(z.object({ decision: z.enum(['approved', 'rejected']), note: z.string().trim().max(300).optional() }), req.body);
    if (i.ownerApproval !== 'pending') throw conflict('nothing_to_approve', 'This repair isn’t waiting for your approval.');
    const [next] = await db.update(issues).set({ ownerApproval: b.decision, lastActivityAt: new Date() }).where(and(eq(issues.id, i.id), eq(issues.ownerApproval, 'pending'))).returning();
    if (!next) throw conflict('nothing_to_approve', 'This repair isn’t waiting for your approval.');
    await db.insert(issueNotes).values({ issueId: i.id, userId: o.userId, text: `Owner ${b.decision} the estimate of ${rupees(i.costEstimate ?? 0)}${b.note ? ' — ' + b.note : ''}` });
    const staff = await rows<{ user_id: string }>(sql`select user_id from staff_roles where association_id = ${u.associationId} and role in ('admin', 'vpm')`);
    await notify(db, staff.map(x => x.user_id), { kind: 'issues', title: `Owner ${b.decision}: ${ref(i.number)}`, body: `${o.name} (${u.unit}) ${b.decision} the estimate of ${rupees(i.costEstimate ?? 0)}.`, href: '/issues/' + ref(i.number) });
    await audit(db, u.associationId, o.userId, o.name, `owner ${b.decision} the estimate on ${ref(i.number)} (${rupees(i.costEstimate ?? 0)})`);
    return requestOut(next, u.unit, s, vendor);
  });
  /** a note from the owner, for the office */
  app.post('/owner/requests/:ref/comment', async (req, reply) => {
    const { o, i, u } = await myRequest(req);
    const { text } = parse(z.object({ text: z.string().trim().min(2).max(1000) }), req.body);
    await db.insert(issueNotes).values({ issueId: i.id, userId: o.userId, text: `Owner: ${text}` });
    await db.update(issues).set({ lastActivityAt: new Date() }).where(eq(issues.id, i.id));
    const staff = await rows<{ user_id: string }>(sql`select user_id from staff_roles where association_id = ${u.associationId} and role in ('admin', 'vpm')`);
    await notify(db, staff.map(x => x.user_id), { kind: 'issues', title: `Owner comment on ${ref(i.number)}`, body: text.slice(0, 140), href: '/issues/' + ref(i.number) });
    return reply.status(201).send({ sent: true });
  });

  app.get('/owner/documents', async req => {
    const o = await owned(req);
    const ids = o.units.map(u => u.unitId), aids = [...new Set(o.units.map(u => u.associationId))];
    const list = await db.select({ id: documents.id, title: documents.title, kind: documents.kind, fileUrl: documents.fileUrl, unitId: documents.unitId, createdAt: documents.createdAt, associationId: documents.associationId }).from(documents)
      .where(and(eq(documents.shared, true), or(inArray(documents.unitId, ids), and(isNull(documents.unitId), inArray(documents.associationId, aids))))).orderBy(desc(documents.createdAt)).limit(300);
    return list.map(({ associationId, unitId, ...d }) => ({ ...d, unit: o.units.find(u => u.unitId === unitId)?.unit ?? null, society: o.units.find(u => u.associationId === associationId)?.society ?? '' }));
  });
  app.post('/owner/documents/:id/opened', async req => {
    const o = await owned(req);
    const { id } = parse(Id, req.params);
    const [d] = await db.select().from(documents).where(and(eq(documents.id, id), eq(documents.shared, true)));
    if (!d || !(d.unitId ? o.units.some(u => u.unitId === d.unitId) : o.units.some(u => u.associationId === d.associationId))) throw notFound('That document');
    await db.insert(ownerActivity).values({ associationId: d.associationId, userId: o.userId, action: `Opened “${d.title}”` });
    return { ok: true };
  });

  /* ================= the office ================= */
  const office = async (req: FastifyRequest, write = true) => {
    const { aid } = parse(z.object({ aid: z.uuid() }), req.params);
    const s = await staffOf(db, await uid(req), aid, write ? ['admin'] : ['admin', 'committee']);
    return { aid, by: { userId: s.userId, name: s.name } };
  };
  app.get('/admin/:aid/owners/settings', async req => { const { aid } = await office(req, false); return settingsOf(aid); });
  app.put('/admin/:aid/owners/settings', async req => {
    const { aid, by } = await office(req);
    const b = parse(z.object({
      enabled: z.boolean(), reports: z.object({ statement: z.boolean(), transactions: z.boolean(), expenses: z.boolean(), societyAccounts: z.boolean() }).partial(),
      showRequests: z.boolean(), showMessages: z.boolean(), showCosts: z.boolean(), approveAbove: z.number().int().min(0).max(100_000_000),
    }).partial(), req.body);
    const cur = await settingsOf(aid), next: OwnerPortalSettings = { ...cur, ...b, reports: { ...cur.reports, ...b.reports } };
    await db.update(associations).set({ ownerPortal: next }).where(eq(associations.id, aid));
    await audit(db, aid, by.userId, by.name, 'changed what owners can see in the owner portal');
    return next;
  });

  /** a set of flats as the Owners page shows them: who owns each, how it is occupied, and what is held for the owner */
  const ownerRows = async (aid: string, flats: (typeof units.$inferSelect)[]) => {
    if (!flats.length) return [];
    const people = await db.select({ unitId: unitMembers.unitId, userId: users.id, name: users.name, phone: users.phone, role: unitMembers.role }).from(unitMembers).innerJoin(users, eq(users.id, unitMembers.userId))
      .where(and(inArray(unitMembers.unitId, flats.map(f => f.id)), eq(unitMembers.status, 'active'), inArray(unitMembers.role, ['Owner', 'Tenant'])));
    const last = await rows<{ user_id: string; at: Date }>(sql`select user_id, max(created_at) as at from owner_activity where association_id = ${aid} group by user_id`);
    // the money is worked out for these flats only — a page of ten costs ten flats' worth of work, not the whole society's
    const f = await figures(flats.map(u => ({ unitId: u.id, unit: u.code, label: u.label, associationId: aid, society: '', occupancy: u.occupancy, monthlyRent: u.monthlyRent, leaseEnd: u.leaseEnd, area: u.area, flatType: u.flatType })));
    const due = await unitBalances(db, aid);
    return flats.map(u => {
      const owner = people.find(p => p.unitId === u.id && p.role === 'Owner'), x = f.find(y => y.unitId === u.id)!;
      return { unitId: u.id, unit: u.code, occupancy: u.occupancy, monthlyRent: u.monthlyRent, leaseEnd: u.leaseEnd, owner: owner?.name ?? null, ownerPhone: owner?.phone ?? null,
        tenant: people.find(p => p.unitId === u.id && p.role === 'Tenant')?.name ?? null, rentPending: x.rentPending, heldForOwner: x.heldForOwner, duesOnFlat: due.get(u.id) ?? 0,
        lastSeen: owner ? last.find(l => l.user_id === owner.userId)?.at ?? null : null };
    });
  };

  /**
   * Every flat with its owner. With `page`, one page of them — searched (flat number, owner's or tenant's name or phone),
   * filtered and sorted by the database; without it, the whole list.
   */
  app.get('/admin/:aid/owners', async req => {
    const { aid } = await office(req, false);
    const q = parse(PageQuery.extend({ occ: z.enum(OCCUPANCY).optional(), owner: z.enum(['Yes', 'No']).optional() }), req.query);
    const hasOwner = sql`exists (select 1 from unit_members m where m.unit_id = ${units.id} and m.role = 'Owner' and m.status = 'active')`;
    const pattern = q.q ? likeOf(q.q) : null;
    const where = and(
      eq(units.associationId, aid),
      q.occ ? eq(units.occupancy, q.occ) : undefined,
      q.owner === 'Yes' ? hasOwner : q.owner === 'No' ? sql`not ${hasOwner}` : undefined,
      pattern ? or(ilike(units.code, pattern), sql`exists (select 1 from unit_members m join users p on p.id = m.user_id
        where m.unit_id = ${units.id} and m.status = 'active' and m.role in ('Owner', 'Tenant') and (p.name ilike ${pattern} or p.phone ilike ${pattern}))`) : undefined,
    );
    if (q.page === undefined) return ownerRows(aid, await db.select().from(units).where(where).orderBy(units.code));
    const page = { page: q.page, limit: q.limit };
    const order = q.sort === 'rent' ? [desc(units.monthlyRent), asc(units.code)] : q.sort === 'lease' ? [sql`${units.leaseEnd} asc nulls last`, asc(units.code)] : [asc(units.code)];
    const [[n], list] = await Promise.all([
      db.select({ n: sql<number>`count(*)::int` }).from(units).where(where),
      db.select().from(units).where(where).orderBy(...order).limit(page.limit).offset(offsetOf(page)),
    ]);
    return paged(await ownerRows(aid, list), n?.n ?? 0, page);
  });

  /** the figures at the top of the Owners page, for the whole society — the list below them is only a page */
  app.get('/admin/:aid/owners/summary', async req => {
    const { aid } = await office(req, false);
    const flats = await db.select().from(units).where(eq(units.associationId, aid));
    const f = flats.length ? await figures(flats.map(u => ({ unitId: u.id, unit: u.code, label: u.label, associationId: aid, society: '', occupancy: u.occupancy, monthlyRent: u.monthlyRent, leaseEnd: u.leaseEnd, area: u.area, flatType: u.flatType }))) : [];
    return {
      flats: flats.length, let: flats.filter(u => u.occupancy === 'Rented').length, vacant: flats.filter(u => u.occupancy === 'Vacant').length,
      heldForOwners: f.reduce((n, x) => n + Math.max(0, x.heldForOwner), 0), rentPending: f.reduce((n, x) => n + x.rentPending, 0),
    };
  });
  /**
   * One flat in full, for the office: the owner and everyone living there, the money, every bill and receipt,
   * repairs and issues, the documents its owner can open, recent visitors, and what the owner did in the portal.
   */
  app.get('/admin/:aid/owners/units/:id', async req => {
    const { aid } = await office(req, false);
    const { id } = parse(Id, req.params);
    const [u] = await db.select().from(units).where(and(eq(units.id, id), eq(units.associationId, aid)));
    if (!u) throw notFound('That flat');
    const people = await db.select({ memberId: unitMembers.id, userId: users.id, name: users.name, phone: users.phone, role: unitMembers.role, status: unitMembers.status, since: unitMembers.createdAt,
      standing: sql<string>`coalesce(${standings.status}, 'Active')` })
      .from(unitMembers).innerJoin(users, eq(users.id, unitMembers.userId)).leftJoin(standings, and(eq(standings.userId, users.id), eq(standings.associationId, aid)))
      .where(eq(unitMembers.unitId, id)).orderBy(sql`case ${unitMembers.role} when 'Owner' then 0 when 'Tenant' then 1 else 2 end`, users.name);
    const ownerIds = people.filter(p => p.role === 'Owner' && p.status === 'active').map(p => p.userId);
    const [[fig], due, billRows, payRows, fixed, paid, issueRows, docRows, visitRows, activity] = await Promise.all([
      figures([{ unitId: u.id, unit: u.code, label: u.label, associationId: aid, society: '', occupancy: u.occupancy, monthlyRent: u.monthlyRent, leaseEnd: u.leaseEnd, area: u.area, flatType: u.flatType }]),
      unitBalances(db, aid),
      db.select().from(bills).where(eq(bills.unitId, id)).orderBy(desc(bills.dueDate), desc(bills.createdAt)).limit(100),
      db.select().from(payments).where(eq(payments.unitId, id)).orderBy(desc(payments.receivedOn), desc(payments.createdAt)).limit(100),
      repairs([id]),
      payouts([id]),
      db.select({ number: issues.number, title: issues.title, category: issues.category, priority: issues.priority, status: issues.status, createdAt: issues.createdAt, by: users.name })
        .from(issues).leftJoin(users, eq(users.id, issues.reporterId)).where(and(eq(issues.unitId, id), eq(issues.associationId, aid))).orderBy(desc(issues.createdAt)).limit(100),
      db.select().from(documents).where(and(eq(documents.associationId, aid), or(eq(documents.unitId, id), isNull(documents.unitId)))).orderBy(desc(documents.createdAt)).limit(100),
      db.select({ id: visits.id, name: visits.name, partner: visits.partner, kind: visits.kind, visitorType: visits.visitorType, status: visits.status, createdAt: visits.createdAt })
        .from(visits).where(eq(visits.unitId, id)).orderBy(desc(visits.createdAt)).limit(15),
      ownerIds.length ? db.select({ name: users.name, action: ownerActivity.action, at: ownerActivity.createdAt }).from(ownerActivity).innerJoin(users, eq(users.id, ownerActivity.userId))
        .where(and(eq(ownerActivity.associationId, aid), inArray(ownerActivity.userId, ownerIds))).orderBy(desc(ownerActivity.createdAt)).limit(50) : [],
    ]);
    const x = fig!;
    return {
      flat: { unitId: u.id, unit: u.code, label: u.label, tower: u.tower, area: u.area, flatType: u.flatType, occupancy: u.occupancy, monthlyRent: u.monthlyRent, leaseEnd: u.leaseEnd },
      people: people.map(({ userId: _u, ...p }) => p),
      lastSeen: activity[0]?.at ?? null,
      money: { rentBilled: x.rentBilled, rentCollected: x.rentCollected, rentPending: x.rentPending, chargesBilled: x.chargesBilled, chargesPaid: x.chargesPaid, chargesPending: x.chargesPending,
        repairs: x.repairs, repairsDeducted: x.repairsDeducted, paidOut: x.paidOut, heldForOwner: x.heldForOwner, duesOnFlat: due.get(u.id) ?? 0 },
      bills: billRows.map(b => ({ number: b.number, period: b.period, chargeType: b.chargeType, description: b.description, amount: b.amount, paid: b.paid, due: dueOf(b), dueDate: b.dueDate, status: billStatus(b) })),
      payments: payRows.map(p => ({ number: p.number, amount: p.amount, mode: p.mode, reference: p.reference, receivedOn: p.receivedOn, payerName: p.payerName, reversed: !!p.reversedAt })),
      payouts: paid.map(p => ({ id: p.id, amount: p.amount, paidOn: p.paidOn, mode: p.mode, reference: p.reference, note: p.note, byName: p.byName })),
      repairs: fixed.map(r => ({ issue: ref(r.issue), title: r.title, category: r.category, vendor: r.vendor, amount: r.amount, status: r.status, fileUrl: r.fileUrl, at: r.at, charged: r.charged })),
      issues: issueRows.map(({ number, ...i }) => ({ ref: ref(number), ...i })),
      documents: docRows.map(x2 => ({ id: x2.id, title: x2.title, kind: x2.kind, fileUrl: x2.fileUrl, shared: x2.shared, forAll: x2.unitId === null, byName: x2.byName, createdAt: x2.createdAt })),
      visits: visitRows.map(v => ({ id: v.id, who: v.kind === 'delivery' ? v.partner || v.name : v.name, visitorType: v.visitorType, status: v.status, createdAt: v.createdAt })),
      activity,
    };
  });
  app.put('/admin/:aid/owners/units/:id', async req => {
    const { aid, by } = await office(req);
    const { id } = parse(Id, req.params);
    const b = parse(z.object({ occupancy: z.enum(OCCUPANCY), monthlyRent: z.number().int().min(0).max(100_000_000), leaseEnd: Ymd.nullable() }).partial(), req.body);
    const [u] = await db.update(units).set(changes(b)).where(and(eq(units.id, id), eq(units.associationId, aid))).returning();
    if (!u) throw notFound('That flat');
    await audit(db, aid, by.userId, by.name, `updated ${u.code}: ${u.occupancy}${u.monthlyRent ? ' · rent ' + rupees(u.monthlyRent) : ''}`);
    return { unitId: u.id, unit: u.code, occupancy: u.occupancy, monthlyRent: u.monthlyRent, leaseEnd: u.leaseEnd };
  });

  /** pay an owner from the rent held for them — never more than is held */
  app.post('/admin/:aid/owners/payouts', async (req, reply) => {
    const { aid, by } = await office(req);
    const b = parse(z.object({ unitId: z.uuid(), amount: z.number().int().min(1).max(100_000_000), paidOn: Ymd.optional(), mode: z.enum(['Bank transfer', 'UPI', 'Cheque', 'Cash']).default('Bank transfer'),
      reference: z.string().trim().max(60).default(''), note: z.string().trim().max(200).default('') }), req.body);
    const [u] = await db.select().from(units).where(and(eq(units.id, b.unitId), eq(units.associationId, aid)));
    if (!u) throw notFound('That flat');
    const [x] = await figures([{ unitId: u.id, unit: u.code, label: u.label, associationId: aid, society: '', occupancy: u.occupancy, monthlyRent: u.monthlyRent, leaseEnd: u.leaseEnd, area: u.area, flatType: u.flatType }]);
    if (b.amount > x!.heldForOwner) throw badRequest('more_than_held', x!.heldForOwner > 0 ? `Only ${rupees(x!.heldForOwner)} is held for the owner of ${u.code}.` : `Nothing is held for the owner of ${u.code} right now.`);
    const chart = await chartOf(db, aid), on = b.paidOn ?? today();
    const p = await db.transaction(async tx => {
      const e = await post(tx, { associationId: aid, date: on, memo: `Paid to owner · ${u.code} · ${b.mode}${b.reference ? ' ' + b.reference : ''}`, source: 'journal', by,
        lines: [{ accountId: byRole(chart, 'owner_funds').id, debit: b.amount }, { accountId: byRole(chart, b.mode === 'Cash' ? 'cash' : 'bank').id, credit: b.amount }] });
      const [row] = await tx.insert(ownerPayouts).values({ associationId: aid, unitId: u.id, amount: b.amount, paidOn: on, mode: b.mode, reference: b.reference, note: b.note, entryId: e.id, byName: by.name }).returning();
      return row!;
    });
    const owners = (await db.select({ userId: unitMembers.userId }).from(unitMembers).where(and(eq(unitMembers.unitId, u.id), eq(unitMembers.role, 'Owner'), eq(unitMembers.status, 'active')))).map(m => m.userId);
    await notify(db, owners, { kind: 'payments', title: `${rupees(b.amount)} paid to you`, body: `Rent for ${u.code}, by ${b.mode.toLowerCase()}${b.reference ? ' · ' + b.reference : ''}.`, href: '/owner' });
    await audit(db, aid, by.userId, by.name, `paid ${rupees(b.amount)} to the owner of ${u.code}`);
    return reply.status(201).send(p);
  });
  app.get('/admin/:aid/owners/payouts', async req => {
    const { aid } = await office(req, false);
    return db.select({ id: ownerPayouts.id, unit: units.code, amount: ownerPayouts.amount, paidOn: ownerPayouts.paidOn, mode: ownerPayouts.mode, reference: ownerPayouts.reference, note: ownerPayouts.note, byName: ownerPayouts.byName })
      .from(ownerPayouts).innerJoin(units, eq(units.id, ownerPayouts.unitId)).where(eq(ownerPayouts.associationId, aid)).orderBy(desc(ownerPayouts.paidOn)).limit(500);
  });

  app.get('/admin/:aid/owners/activity', async req => {
    const { aid } = await office(req, false);
    return db.select({ name: users.name, action: ownerActivity.action, at: ownerActivity.createdAt }).from(ownerActivity).innerJoin(users, eq(users.id, ownerActivity.userId))
      .where(eq(ownerActivity.associationId, aid)).orderBy(desc(ownerActivity.createdAt)).limit(200);
  });

  /* ---- documents ---- */
  const docsOut = (aid: string) => db.select({ id: documents.id, title: documents.title, kind: documents.kind, fileUrl: documents.fileUrl, unit: units.code, shared: documents.shared, byName: documents.byName, createdAt: documents.createdAt })
    .from(documents).leftJoin(units, eq(units.id, documents.unitId)).where(eq(documents.associationId, aid)).orderBy(desc(documents.createdAt)).limit(500);
  app.get('/admin/:aid/documents', async req => { const { aid } = await office(req, false); return docsOut(aid); });
  app.post('/admin/:aid/documents', async (req, reply) => {
    const { aid, by } = await office(req);
    const b = parse(z.object({ title: z.string().trim().min(2).max(120), kind: z.enum(DOCUMENT_KINDS).default('Other'), fileUrl: z.url(), unitId: z.uuid().nullish(), shared: z.boolean().default(true) }), req.body);
    if (!b.fileUrl.startsWith(config.PUBLIC_URL + '/files/')) throw badRequest('bad_attachment', 'Upload the file first.');
    let code = 'all owners';
    if (b.unitId) {
      const [u] = await db.select({ code: units.code }).from(units).where(and(eq(units.id, b.unitId), eq(units.associationId, aid)));
      if (!u) throw notFound('That flat');
      code = u.code;
    }
    const [d] = await db.insert(documents).values({ associationId: aid, unitId: b.unitId ?? null, title: b.title, kind: b.kind, fileUrl: b.fileUrl, shared: b.shared, byName: by.name }).returning();
    if (b.shared) {
      const owners = await db.select({ userId: unitMembers.userId }).from(unitMembers).innerJoin(units, eq(units.id, unitMembers.unitId))
        .where(and(eq(units.associationId, aid), b.unitId ? eq(units.id, b.unitId) : undefined, eq(unitMembers.role, 'Owner'), eq(unitMembers.status, 'active')));
      await notify(db, [...new Set(owners.map(x => x.userId))], { kind: 'messages', title: `New document: ${b.title}`, body: `${b.kind} shared by the society office.`, href: '/owner/documents' });
    }
    await audit(db, aid, by.userId, by.name, `added document “${b.title}” for ${code}`);
    return reply.status(201).send((await docsOut(aid)).find(x => x.id === d!.id));
  });
  app.put('/admin/:aid/documents/:id', async req => {
    const { aid } = await office(req);
    const { id } = parse(Id, req.params);
    const { shared } = parse(z.object({ shared: z.boolean() }), req.body);
    const done = await db.update(documents).set({ shared }).where(and(eq(documents.id, id), eq(documents.associationId, aid))).returning();
    if (!done.length) throw notFound('That document');
    return (await docsOut(aid)).find(x => x.id === id);
  });
  app.delete('/admin/:aid/documents/:id', async (req, reply) => {
    const { aid, by } = await office(req);
    const { id } = parse(Id, req.params);
    const gone = await db.delete(documents).where(and(eq(documents.id, id), eq(documents.associationId, aid))).returning();
    if (!gone.length) throw notFound('That document');
    await audit(db, aid, by.userId, by.name, `removed document “${gone[0]!.title}”`);
    return reply.status(204).send();
  });
};
