import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../app.js';
import {
  accounts, associations, auditLog, bankLines, bills, CHARGE_TYPES, expenses, journalEntries, journalLines, messages, PAYMENT_MODES, paymentAllocations, payments, periodLocks,
  refreshTokens, staffRoles, unitMembers, units, users, vendors, type AccountingSettings, type Audience,
} from '../db/schema.js';
import { audit } from '../lib/audit.js';
import { residentOf, staffOf, userIdFrom } from '../lib/auth.js';
import { deliver, remindOverdue } from '../lib/comms.js';
import { hashPassword } from '../lib/crypto.js';
import {
  addExpense, billOne, billStatus, cancelBill, decideExpense, dueOf, generateBills, payExpense, previewRun, recordPayment, reversePayment, rupees, runLateFees, unitBalances, waive,
  type Bill,
} from '../lib/finance.js';
import { changes, badRequest, conflict, notFound, parse } from '../lib/http.js';
import { assertOpen, balances, byRole, chartOf, isDate, monthName, post, reverse, settingsOf, today } from '../lib/ledger.js';

const Id = z.object({ id: z.uuid() });
const Ymd = z.string().refine(isDate, 'Use a date like 2026-11-17');
const Period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month like 2026-11');
const Money = z.number().int().min(1).max(100_000_000);
const Range = z.object({ from: Ymd.optional(), to: Ymd.optional() });

const RunIn = z.object({
  period: Period, chargeType: z.enum(CHARGE_TYPES), method: z.enum(['flat', 'sqft', 'type', 'custom']), dueDate: Ymd, description: z.string().trim().max(120).optional(),
  amount: Money.optional(), rate: z.number().min(0.01).max(10000).optional(), byType: z.record(z.string(), Money).optional(), byUnit: z.record(z.uuid(), Money).optional(),
  unitIds: z.array(z.uuid()).max(5000).optional(),
});

/** turn rows into a CSV download — the "export for the auditor" */
function csv(reply: FastifyReply, name: string, head: string[], rows: (string | number | null)[][]) {
  const cell = (v: string | number | null) => { const s = v === null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s; };
  return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${name}.csv"`)
    .send('﻿' + [head, ...rows].map(r => r.map(cell).join(',')).join('\r\n'));
}

/**
 * Accounting.
 *   /v1/admin/:aid/finance/*   the office (admin writes; committee and auditor read)
 *   /v1/dues                   the resident: what my flat owes, my ledger, my receipts, paying
 */
export const financeRoutes = ({ config, db, messenger }: Deps): FastifyPluginAsync => async app => {
  const uid = (req: FastifyRequest) => userIdFrom(req, config.JWT_SECRET);
  const reader = async (req: FastifyRequest) => {
    const { aid } = parse(z.object({ aid: z.uuid() }), req.params);
    const s = await staffOf(db, await uid(req), aid, ['admin', 'committee', 'auditor']);
    return { aid, by: { userId: s.userId, name: s.name } };
  };
  const writer = async (req: FastifyRequest) => {
    const { aid } = parse(z.object({ aid: z.uuid() }), req.params);
    const s = await staffOf(db, await uid(req), aid, ['admin']);
    return { aid, by: { userId: s.userId, name: s.name } };
  };
  const rows = async <T>(q: ReturnType<typeof sql>) => ((await db.execute(q)) as unknown as { rows: T[] }).rows;
  const billOut = (b: Bill, unit?: string) => ({ id: b.id, number: b.number, unitId: b.unitId, unit, period: b.period, chargeType: b.chargeType, description: b.description, amount: b.amount, paid: b.paid, waived: b.waived,
    due: dueOf(b), dueDate: b.dueDate, status: billStatus(b), createdAt: b.createdAt });
  const findBill = async (aid: string, id: string) => {
    const [b] = await db.select().from(bills).where(and(eq(bills.id, id), eq(bills.associationId, aid)));
    if (!b) throw notFound('That bill');
    return b;
  };
  const monthStart = () => today().slice(0, 8) + '01';

  /* ================= dashboard ================= */
  app.get('/admin/:aid/finance/dashboard', async req => {
    const { aid } = await reader(req);
    await chartOf(db, aid);
    const from = monthStart(), to = today();
    const month = await balances(db, aid, { from, to }), all = await balances(db, aid, { to });
    const byUnit = await unitBalances(db, aid), due = [...byUnit.values()];
    const open = (await db.select().from(bills).where(and(eq(bills.associationId, aid), isNull(bills.cancelledAt)))).filter(b => dueOf(b) > 0);
    const [col] = await rows<{ n: number }>(sql`select coalesce(sum(amount), 0)::int as n from payments where association_id = ${aid} and reversed_at is null and received_on >= ${from}::date`);
    const flow = await rows<{ month: string; money_in: number; money_out: number }>(sql`
      select to_char(e.date, 'YYYY-MM') as month, coalesce(sum(l.debit), 0)::int as money_in, coalesce(sum(l.credit), 0)::int as money_out
      from journal_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id
      where e.association_id = ${aid} and a.role in ('bank', 'cash') and e.date >= (date_trunc('month', now()) - interval '5 months')::date group by 1 order by 1`);
    const recon = await rows<{ status: string; n: number }>(sql`select status, count(*)::int as n from bank_lines where association_id = ${aid} group by status`);
    const [pending] = await rows<{ n: number; amount: number }>(sql`select count(*)::int as n, coalesce(sum(amount), 0)::int as amount from expenses where association_id = ${aid} and status = 'Pending approval'`);
    const [payable] = await rows<{ n: number; amount: number }>(sql`select count(*)::int as n, coalesce(sum(amount), 0)::int as amount from expenses where association_id = ${aid} and status = 'Approved'`);
    // this month's bills: how much was asked for and how much of that has come in
    const [asked] = await rows<{ billed: number; paid: number; n: number }>(sql`
      select coalesce(sum(amount - waived), 0)::int as billed, coalesce(sum(paid), 0)::int as paid, count(*)::int as n
      from bills where association_id = ${aid} and cancelled_at is null and period = ${to.slice(0, 7)}`);
    const flats = await db.select({ id: units.id, code: units.code }).from(units).where(eq(units.associationId, aid));
    const code = new Map(flats.map(f => [f.id, f.code]));
    const topDues = [...byUnit.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([unitId, amount]) => ({ unitId, unit: code.get(unitId) ?? '', amount }));
    const recent = await db.select({ id: payments.id, number: payments.number, unit: units.code, amount: payments.amount, mode: payments.mode, receivedOn: payments.receivedOn })
      .from(payments).innerJoin(units, eq(units.id, payments.unitId)).where(and(eq(payments.associationId, aid), isNull(payments.reversedAt))).orderBy(desc(payments.receivedOn), desc(payments.createdAt)).limit(5);
    return {
      month: monthName(to.slice(0, 7)),
      flats: flats.length, billedThisMonth: asked!.billed, paidOfBilled: asked!.paid, billsThisMonth: asked!.n, topDues, recentPayments: recent,
      collected: col!.n, pendingDues: due.filter(n => n > 0).reduce((a, n) => a + n, 0), flatsWithDues: due.filter(n => n > 0).length, advances: -due.filter(n => n < 0).reduce((a, n) => a + n, 0),
      overdue: open.filter(b => billStatus(b) === 'Overdue').reduce((n, b) => n + dueOf(b), 0), overdueBills: open.filter(b => billStatus(b) === 'Overdue').length,
      income: month.filter(a => a.kind === 'income' && a.balance).map(a => ({ name: a.name, amount: a.balance })),
      expenses: month.filter(a => a.kind === 'expense' && a.balance).map(a => ({ name: a.name, amount: a.balance })),
      bank: all.filter(a => a.role === 'bank').reduce((n, a) => n + a.balance, 0), cash: all.filter(a => a.role === 'cash').reduce((n, a) => n + a.balance, 0),
      cashFlow: flow, reconciliation: { unmatched: recon.find(r => r.status === 'Unmatched')?.n ?? 0, matched: recon.find(r => r.status === 'Matched')?.n ?? 0 },
      toApprove: pending!, toPay: payable!,
    };
  });

  /* ================= chart of accounts, settings, flats ================= */
  app.get('/admin/:aid/finance/accounts', async req => {
    const { aid } = await reader(req);
    await chartOf(db, aid);
    return (await balances(db, aid)).map(a => ({ id: a.id, code: a.code, name: a.name, kind: a.kind, role: a.role, balance: a.balance }));
  });
  app.post('/admin/:aid/finance/accounts', async (req, reply) => {
    const { aid, by } = await writer(req);
    const b = parse(z.object({ code: z.string().regex(/^\d{4}$/, 'Use a 4-digit code'), name: z.string().trim().min(2).max(60), kind: z.enum(['asset', 'liability', 'equity', 'income', 'expense']), bank: z.boolean().default(false) }), req.body);
    const chart = await chartOf(db, aid);
    if (chart.some(a => a.code === b.code)) throw conflict('code_taken', `Code ${b.code} is already ${chart.find(a => a.code === b.code)!.name}.`);
    const [a] = await db.insert(accounts).values({ associationId: aid, code: b.code, name: b.name, kind: b.kind, role: b.bank && b.kind === 'asset' ? 'bank' : null }).returning();
    await audit(db, aid, by.userId, by.name, `added account ${b.code} ${b.name}`);
    return reply.status(201).send(a);
  });
  app.put('/admin/:aid/finance/accounts/:id', async req => {
    const { aid, by } = await writer(req);
    const { id } = parse(Id, req.params);
    const { name } = parse(z.object({ name: z.string().trim().min(2).max(60) }), req.body);
    const [a] = await db.update(accounts).set({ name }).where(and(eq(accounts.id, id), eq(accounts.associationId, aid))).returning();
    if (!a) throw notFound('That account');
    await audit(db, aid, by.userId, by.name, `renamed account ${a.code} to ${name}`);
    return a;
  });

  app.get('/admin/:aid/finance/settings', async req => { const { aid } = await reader(req); return settingsOf(db, aid); });
  app.put('/admin/:aid/finance/settings', async req => {
    const { aid, by } = await writer(req);
    const b = parse(z.object({
      allowPartial: z.boolean(), lateFee: z.object({ kind: z.enum(['none', 'flat', 'percent']), value: z.number().min(0).max(100000), graceDays: z.number().int().min(0).max(90) }),
      approvalAbove: z.number().int().min(0).max(100_000_000), upiId: z.string().trim().max(80), bankDetails: z.string().trim().max(300),
    }).partial(), req.body);
    const next: AccountingSettings = { ...(await settingsOf(db, aid)), ...b } as AccountingSettings;
    if (next.lateFee.kind === 'percent' && next.lateFee.value > 25) throw badRequest('fee_too_high', 'A percentage late fee can be at most 25%.');
    await db.update(associations).set({ accounting: next }).where(eq(associations.id, aid));
    await audit(db, aid, by.userId, by.name, 'changed the accounting settings');
    return next;
  });

  /** every flat with what billing needs to know about it, and what it owes */
  app.get('/admin/:aid/finance/units', async req => {
    const { aid } = await reader(req);
    const bal = await unitBalances(db, aid);
    const flats = await db.select().from(units).where(eq(units.associationId, aid)).orderBy(units.code);
    const people = await db.select({ unitId: unitMembers.unitId, name: users.name, role: unitMembers.role }).from(unitMembers).innerJoin(users, eq(users.id, unitMembers.userId))
      .where(and(inArray(unitMembers.unitId, flats.length ? flats.map(f => f.id) : ['00000000-0000-0000-0000-000000000000']), eq(unitMembers.status, 'active')));
    return flats.map(f => ({ id: f.id, code: f.code, tower: f.tower, area: f.area, flatType: f.flatType, balance: bal.get(f.id) ?? 0,
      owner: people.find(p => p.unitId === f.id && p.role === 'Owner')?.name ?? people.find(p => p.unitId === f.id)?.name ?? null }));
  });
  app.put('/admin/:aid/finance/units/:id', async req => {
    const { aid } = await writer(req);
    const { id } = parse(Id, req.params);
    const b = parse(z.object({ area: z.number().int().min(0).max(100000), flatType: z.string().trim().max(20) }).partial(), req.body);
    const [u] = await db.update(units).set(changes(b)).where(and(eq(units.id, id), eq(units.associationId, aid))).returning();
    if (!u) throw notFound('That flat');
    return { id: u.id, code: u.code, area: u.area, flatType: u.flatType };
  });
  /** what a flat owed (or had paid ahead) before the society started using this system */
  app.post('/admin/:aid/finance/units/:id/opening', async (req, reply) => {
    const { aid, by } = await writer(req);
    const { id } = parse(Id, req.params);
    const b = parse(z.object({ amount: z.number().int().min(-100_000_000).max(100_000_000).refine(n => n !== 0, 'Enter an amount'), date: Ymd.optional() }), req.body);
    const [f] = await db.select().from(units).where(and(eq(units.id, id), eq(units.associationId, aid)));
    if (!f) throw notFound('That flat');
    const [had] = await db.select({ id: journalEntries.id }).from(journalEntries).innerJoin(journalLines, eq(journalLines.entryId, journalEntries.id))
      .where(and(eq(journalEntries.associationId, aid), eq(journalEntries.source, 'opening'), eq(journalLines.unitId, id), isNull(journalEntries.reversedBy)));
    if (had) throw conflict('has_opening', 'This flat already has an opening balance. Reverse that entry to change it.');
    const chart = await chartOf(db, aid), rec = byRole(chart, 'receivable').id, fund = byRole(chart, 'opening').id, n = Math.abs(b.amount);
    const e = await post(db, { associationId: aid, date: b.date ?? today(), memo: `Opening balance · ${f.code}`, source: 'opening', by,
      lines: b.amount > 0 ? [{ accountId: rec, debit: n, unitId: id }, { accountId: fund, credit: n }] : [{ accountId: fund, debit: n }, { accountId: rec, credit: n, unitId: id }] });
    await audit(db, aid, by.userId, by.name, `set opening balance for ${f.code}: ${b.amount > 0 ? rupees(n) + ' due' : rupees(n) + ' advance'}`);
    return reply.status(201).send({ entry: 'JV-' + e.number, balance: (await unitBalances(db, aid)).get(id) ?? 0 });
  });

  /* ================= billing ================= */
  app.post('/admin/:aid/finance/bills/preview', async req => {
    const { aid } = await reader(req);
    return previewRun(db, aid, parse(RunIn, req.body));
  });

  /** generate the month's bills, and (unless told not to) tell the flats */
  app.post('/admin/:aid/finance/bills/run', async (req, reply) => {
    const { aid, by } = await writer(req);
    const b = parse(RunIn.extend({ tell: z.boolean().default(true) }), req.body);
    const out = await generateBills(db, aid, b, by);
    let told = 0;
    if (b.tell) {
      const [{ next }] = (await db.select({ next: sql<number>`coalesce(max(${messages.number}), 100) + 1` }).from(messages).where(eq(messages.associationId, aid))) as [{ next: number }];
      const audience: Audience = { kind: 'units', unitIds: [...new Set(out.bills.map(x => x.unitId))] };
      const [m] = await db.insert(messages).values({ associationId: aid, number: next, type: 'Reminder', title: `${b.chargeType} bill for ${monthName(b.period)}`,
        body: `Your ${b.chargeType.toLowerCase()} bill for ${monthName(b.period)} is ready. It is due on ${b.dueDate}. Open the app to see the amount and pay.`,
        channels: ['push', 'email'], audience, audienceLabel: `${out.bills.length} billed flats`, source: 'bill_generated', createdBy: by.userId, byName: by.name }).returning();
      // a flat with nobody on the app can't be told; the bills stand either way
      told = await deliver(db, messenger, m!.id, { href: '/dues' }).then(r => r.recipients).catch(async () => { await db.delete(messages).where(eq(messages.id, m!.id)); return 0; });
    }
    await audit(db, aid, by.userId, by.name, `generated ${out.bills.length} ${b.chargeType} bills for ${monthName(b.period)} · ${rupees(out.run.total)}`);
    return reply.status(201).send({ run: out.run.id, bills: out.bills.length, total: out.run.total, skipped: out.skipped, residentsTold: told });
  });

  app.post('/admin/:aid/finance/bills', async (req, reply) => {
    const { aid, by } = await writer(req);
    const b = parse(z.object({ unitId: z.uuid(), chargeType: z.enum(CHARGE_TYPES), amount: Money, dueDate: Ymd, period: Period.optional(), description: z.string().trim().max(120).optional() }), req.body);
    const made = await billOne(db, aid, b, by);
    await audit(db, aid, by.userId, by.name, `billed ${made.number} · ${b.chargeType} · ${rupees(b.amount)}`);
    return reply.status(201).send(billOut(made));
  });

  app.get('/admin/:aid/finance/bills', async req => {
    const { aid } = await reader(req);
    const f = parse(z.object({ period: Period.optional(), unitId: z.uuid().optional(), status: z.enum(['Unpaid', 'Part paid', 'Overdue', 'Paid', 'Waived', 'Cancelled', 'Open']).optional() }), req.query);
    const list = await db.select({ b: bills, unit: units.code }).from(bills).innerJoin(units, eq(units.id, bills.unitId))
      .where(and(eq(bills.associationId, aid), f.period ? eq(bills.period, f.period) : undefined, f.unitId ? eq(bills.unitId, f.unitId) : undefined)).orderBy(desc(bills.createdAt), units.code).limit(2000);
    const out = list.map(x => billOut(x.b, x.unit));
    return f.status === 'Open' ? out.filter(b => b.due > 0) : f.status ? out.filter(b => b.status === f.status) : out;
  });

  app.post('/admin/:aid/finance/bills/:id/waive', async req => {
    const { aid, by } = await writer(req);
    const { id } = parse(Id, req.params);
    const b = parse(z.object({ amount: Money, reason: z.string().trim().min(3).max(200) }), req.body);
    const u = await waive(db, await findBill(aid, id), b.amount, b.reason, by);
    await audit(db, aid, by.userId, by.name, `waived ${rupees(b.amount)} on ${u.number} — ${b.reason}`);
    return billOut(u);
  });
  app.post('/admin/:aid/finance/bills/:id/cancel', async req => {
    const { aid, by } = await writer(req);
    const { id } = parse(Id, req.params);
    const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(200) }), req.body);
    const u = await cancelBill(db, await findBill(aid, id), reason, by);
    await audit(db, aid, by.userId, by.name, `cancelled ${u.number} — ${reason}`);
    return billOut(u);
  });

  app.post('/admin/:aid/finance/late-fees/run', async req => {
    const { aid, by } = await writer(req);
    const made = await runLateFees(db, aid, by);
    if (made.length) await audit(db, aid, by.userId, by.name, `charged late fees on ${made.length} overdue bills · ${rupees(made.reduce((n, b) => n + b.amount, 0))}`);
    return { charged: made.length, total: made.reduce((n, b) => n + b.amount, 0) };
  });

  /** remind every flat with something overdue — recorded in the communication hub like any other message */
  app.post('/admin/:aid/finance/reminders', async req => {
    const { aid, by } = await writer(req);
    return remindOverdue(db, messenger, aid, by);
  });

  /* ================= payments ================= */
  const PaymentIn = z.object({
    unitId: z.uuid(), amount: Money, mode: z.enum(PAYMENT_MODES), reference: z.string().trim().max(60).optional(), chequeNo: z.string().trim().max(20).optional(), chequeDate: Ymd.optional(),
    receivedOn: Ymd.optional(), payerName: z.string().trim().max(80).optional(), note: z.string().trim().max(200).optional(), billIds: z.array(z.uuid()).max(100).optional(), accountId: z.uuid().optional(),
  });
  /** everything a printed receipt shows */
  const receipt = async (id: string, aid: string) => {
    const [p] = await db.select({ p: payments, unit: units.code, unitLabel: units.label, society: associations.name, into: accounts.name })
      .from(payments).innerJoin(units, eq(units.id, payments.unitId)).innerJoin(associations, eq(associations.id, payments.associationId)).innerJoin(accounts, eq(accounts.id, payments.accountId))
      .where(and(eq(payments.id, id), eq(payments.associationId, aid)));
    if (!p) throw notFound('That receipt');
    const settled = await db.select({ number: bills.number, chargeType: bills.chargeType, period: bills.period, amount: paymentAllocations.amount })
      .from(paymentAllocations).innerJoin(bills, eq(bills.id, paymentAllocations.billId)).where(eq(paymentAllocations.paymentId, id));
    const used = settled.reduce((n, s) => n + s.amount, 0);
    const { associationId: _a, createdBy: _c, entryId: _e, accountId: _i, ...rest } = p.p;
    return { ...rest, unit: p.unit, unitLabel: p.unitLabel, society: p.society, depositedTo: p.into, settled, advance: p.p.reversedAt ? 0 : p.p.amount - used, reversed: !!p.p.reversedAt };
  };

  app.post('/admin/:aid/finance/payments', async (req, reply) => {
    const { aid, by } = await writer(req);
    const out = await recordPayment(db, aid, parse(PaymentIn, req.body), by);
    await audit(db, aid, by.userId, by.name, `recorded ${rupees(out.payment.amount)} from ${out.unit} · ${out.payment.mode} · ${out.payment.number}`);
    return reply.status(201).send(await receipt(out.payment.id, aid));
  });
  app.get('/admin/:aid/finance/payments', async req => {
    const { aid } = await reader(req);
    const f = parse(Range.extend({ unitId: z.uuid().optional(), mode: z.enum(PAYMENT_MODES).optional() }), req.query);
    return db.select({ id: payments.id, number: payments.number, unit: units.code, amount: payments.amount, mode: payments.mode, reference: payments.reference, chequeNo: payments.chequeNo, chequeStatus: payments.chequeStatus,
      receivedOn: payments.receivedOn, payerName: payments.payerName, source: payments.source, byName: payments.byName, reversed: sql<boolean>`${payments.reversedAt} is not null`, reverseReason: payments.reverseReason })
      .from(payments).innerJoin(units, eq(units.id, payments.unitId))
      .where(and(eq(payments.associationId, aid), f.from ? gte(payments.receivedOn, f.from) : undefined, f.to ? lte(payments.receivedOn, f.to) : undefined, f.unitId ? eq(payments.unitId, f.unitId) : undefined, f.mode ? eq(payments.mode, f.mode) : undefined))
      .orderBy(desc(payments.receivedOn), desc(payments.createdAt)).limit(2000);
  });
  app.get('/admin/:aid/finance/payments/:id', async req => { const { aid } = await reader(req); return receipt(parse(Id, req.params).id, aid); });
  app.post('/admin/:aid/finance/payments/:id/reverse', async req => {
    const { aid, by } = await writer(req);
    const { id } = parse(Id, req.params);
    const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(200) }), req.body);
    const p = await reversePayment(db, id, aid, reason, by);
    await audit(db, aid, by.userId, by.name, `reversed ${p.number} (${rupees(p.amount)}) — ${reason}`);
    return receipt(id, aid);
  });
  app.post('/admin/:aid/finance/payments/:id/cheque', async req => {
    const { aid, by } = await writer(req);
    const { id } = parse(Id, req.params);
    const { status } = parse(z.object({ status: z.enum(['Cleared', 'Bounced']) }), req.body);
    const [p] = await db.select().from(payments).where(and(eq(payments.id, id), eq(payments.associationId, aid)));
    if (!p || p.mode !== 'Cheque') throw notFound('That cheque');
    if (p.chequeStatus !== 'Pending') throw conflict('cheque_settled', `This cheque is already marked ${p.chequeStatus?.toLowerCase()}.`);
    if (status === 'Bounced') await reversePayment(db, id, aid, `Cheque ${p.chequeNo} bounced`, by);
    else await db.update(payments).set({ chequeStatus: 'Cleared' }).where(eq(payments.id, id));
    await audit(db, aid, by.userId, by.name, `cheque ${p.chequeNo} (${p.number}) ${status.toLowerCase()}`);
    return receipt(id, aid);
  });

  /** one flat's account, oldest first, with the balance after every line */
  const ledgerOf = async (aid: string, unitId: string, o: { from?: string; to?: string } = {}) => {
    const lines = await rows<{ date: string; number: number; memo: string; source: string; debit: number; credit: number }>(sql`
      select to_char(e.date, 'YYYY-MM-DD') as date, e.number, e.memo, e.source, l.debit, l.credit
      from journal_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id
      where e.association_id = ${aid} and a.role = 'receivable' and l.unit_id = ${unitId} order by e.date, e.number`);
    let bal = 0, opening = 0;
    const out: { date: string; ref: string; what: string; kind: string; charge: number; payment: number; balance: number }[] = [];
    for (const l of lines) {
      bal += l.debit - l.credit;
      if (o.from && l.date < o.from) { opening = bal; continue; }
      if (o.to && l.date > o.to) continue;
      out.push({ date: l.date, ref: 'JV-' + l.number, what: l.memo, kind: l.source, charge: l.debit, payment: l.credit, balance: bal });
    }
    return { opening, lines: out, closing: out.length ? out[out.length - 1]!.balance : opening };
  };
  app.get('/admin/:aid/finance/ledger/:id', async (req, reply) => {
    const { aid } = await reader(req);
    const { id } = parse(Id, req.params);
    const f = parse(Range.extend({ format: z.enum(['json', 'csv']).default('json') }), req.query);
    const [u] = await db.select().from(units).where(and(eq(units.id, id), eq(units.associationId, aid)));
    if (!u) throw notFound('That flat');
    const l = await ledgerOf(aid, id, f);
    if (f.format === 'csv') return csv(reply, `ledger-${u.code}`, ['Date', 'Reference', 'Particulars', 'Charge', 'Payment', 'Balance'], [['', '', 'Opening balance', null, null, l.opening], ...l.lines.map(x => [x.date, x.ref, x.what, x.charge || null, x.payment || null, x.balance])]);
    return { unit: u.code, label: u.label, ...l };
  });

  /* ================= expenses ================= */
  const expenseOut = async (aid: string, where = and(eq(expenses.associationId, aid))) =>
    db.select({ id: expenses.id, number: expenses.number, payee: expenses.payee, vendorId: expenses.vendorId, head: accounts.name, accountId: expenses.accountId, amount: expenses.amount, date: expenses.date,
      description: expenses.description, billNo: expenses.billNo, receiptUrl: expenses.receiptUrl, status: expenses.status, decidedByName: expenses.decidedByName, paidOn: expenses.paidOn,
      paymentMode: expenses.paymentMode, reference: expenses.reference, byName: expenses.byName, fromMaintenance: sql<boolean>`${expenses.issueInvoiceId} is not null` })
      .from(expenses).innerJoin(accounts, eq(accounts.id, expenses.accountId)).where(where).orderBy(desc(expenses.date), desc(expenses.createdAt)).limit(2000);
  const findExpense = async (aid: string, id: string) => {
    const [e] = await db.select().from(expenses).where(and(eq(expenses.id, id), eq(expenses.associationId, aid)));
    if (!e) throw notFound('That expense');
    return e;
  };
  app.get('/admin/:aid/finance/expenses', async req => {
    const { aid } = await reader(req);
    const f = parse(Range.extend({ status: z.enum(['Pending approval', 'Approved', 'Paid', 'Rejected']).optional() }), req.query);
    return expenseOut(aid, and(eq(expenses.associationId, aid), f.status ? eq(expenses.status, f.status) : undefined, f.from ? gte(expenses.date, f.from) : undefined, f.to ? lte(expenses.date, f.to) : undefined));
  });
  app.post('/admin/:aid/finance/expenses', async (req, reply) => {
    const { aid, by } = await writer(req);
    const b = parse(z.object({
      payee: z.string().trim().min(2).max(80), vendorId: z.uuid().optional(), accountId: z.uuid(), amount: Money, date: Ymd.optional(), description: z.string().trim().max(200).optional(),
      billNo: z.string().trim().max(40).optional(), receiptUrl: z.url().optional(),
      /** already paid (petty cash, a card swipe): book and pay in one step */
      paid: z.object({ mode: z.enum(PAYMENT_MODES), accountId: z.uuid().optional(), reference: z.string().trim().max(60).optional(), paidOn: Ymd.optional() }).optional(),
    }), req.body);
    if (b.receiptUrl && !b.receiptUrl.startsWith(config.PUBLIC_URL + '/files/')) throw badRequest('bad_attachment', 'Upload the receipt first.');
    if (b.vendorId) {
      const [v] = await db.select({ id: vendors.id }).from(vendors).where(and(eq(vendors.id, b.vendorId), eq(vendors.associationId, aid)));
      if (!v) throw notFound('That vendor');
    }
    let e = await addExpense(db, aid, b, by);
    if (b.paid && e.status === 'Approved') e = await payExpense(db, e, b.paid, by);
    await audit(db, aid, by.userId, by.name, `booked ${e.number} · ${b.payee} · ${rupees(b.amount)} · ${e.status.toLowerCase()}`);
    return reply.status(201).send((await expenseOut(aid, eq(expenses.id, e.id)))[0]);
  });
  app.post('/admin/:aid/finance/expenses/:id/decision', async req => {
    const { aid, by } = await writer(req);
    const { id } = parse(Id, req.params);
    const { decision } = parse(z.object({ decision: z.enum(['approve', 'reject']) }), req.body);
    const e = await decideExpense(db, await findExpense(aid, id), decision, by);
    await audit(db, aid, by.userId, by.name, `${decision === 'approve' ? 'approved' : 'rejected'} ${e.number} · ${rupees(e.amount)}`);
    return (await expenseOut(aid, eq(expenses.id, id)))[0];
  });
  app.post('/admin/:aid/finance/expenses/:id/pay', async req => {
    const { aid, by } = await writer(req);
    const { id } = parse(Id, req.params);
    const b = parse(z.object({ mode: z.enum(PAYMENT_MODES), accountId: z.uuid().optional(), reference: z.string().trim().max(60).optional(), paidOn: Ymd.optional() }), req.body);
    const e = await payExpense(db, await findExpense(aid, id), b, by);
    await audit(db, aid, by.userId, by.name, `paid ${e.number} · ${e.payee} · ${rupees(e.amount)} · ${b.mode}`);
    return (await expenseOut(aid, eq(expenses.id, id)))[0];
  });

  /* ================= journal ================= */
  const entriesOut = async (aid: string, f: { from?: string; to?: string }, limit = 500) => {
    const list = await db.select().from(journalEntries).where(and(eq(journalEntries.associationId, aid), f.from ? gte(journalEntries.date, f.from) : undefined, f.to ? lte(journalEntries.date, f.to) : undefined))
      .orderBy(desc(journalEntries.date), desc(journalEntries.number)).limit(limit);
    if (!list.length) return [];
    const lines = await db.select({ entryId: journalLines.entryId, account: accounts.name, code: accounts.code, debit: journalLines.debit, credit: journalLines.credit, unit: units.code })
      .from(journalLines).innerJoin(accounts, eq(accounts.id, journalLines.accountId)).leftJoin(units, eq(units.id, journalLines.unitId)).where(inArray(journalLines.entryId, list.map(e => e.id)));
    return list.map(e => ({ id: e.id, ref: 'JV-' + e.number, date: e.date, memo: e.memo, source: e.source, byName: e.byName, reversed: !!e.reversedBy, isReversal: !!e.reverses,
      lines: lines.filter(l => l.entryId === e.id).map(({ entryId: _e, ...l }) => l) }));
  };
  app.get('/admin/:aid/finance/journal', async req => { const { aid } = await reader(req); return entriesOut(aid, parse(Range, req.query)); });
  /** a manual adjustment */
  app.post('/admin/:aid/finance/journal', async (req, reply) => {
    const { aid, by } = await writer(req);
    const b = parse(z.object({ date: Ymd, memo: z.string().trim().min(3).max(200),
      lines: z.array(z.object({ accountId: z.uuid(), debit: z.number().int().min(0).default(0), credit: z.number().int().min(0).default(0), unitId: z.uuid().optional() })).min(2).max(40) }), req.body);
    const chart = await chartOf(db, aid);
    for (const l of b.lines) {
      const a = chart.find(x => x.id === l.accountId);
      if (!a) throw notFound('One of those accounts');
      if (a.role === 'receivable' && !l.unitId) throw badRequest('unit_needed', 'A line on dues receivable must name the flat.');
    }
    const e = await post(db, { associationId: aid, date: b.date, memo: b.memo, source: 'journal', lines: b.lines, by });
    await audit(db, aid, by.userId, by.name, `posted journal JV-${e.number} — ${b.memo}`);
    return reply.status(201).send((await entriesOut(aid, { from: b.date, to: b.date })).find(x => x.id === e.id));
  });
  /** only manual, opening and bank entries are reversed here; bills, payments and expenses have their own undo */
  app.post('/admin/:aid/finance/journal/:id/reverse', async req => {
    const { aid, by } = await writer(req);
    const { id } = parse(Id, req.params);
    const { reason } = parse(z.object({ reason: z.string().trim().min(3).max(200) }), req.body);
    const [e] = await db.select().from(journalEntries).where(and(eq(journalEntries.id, id), eq(journalEntries.associationId, aid)));
    if (!e) throw notFound('That entry');
    if (!['journal', 'opening', 'bank'].includes(e.source)) throw conflict('use_its_own_undo', 'Undo this from where it came: cancel the bill, reverse the payment, or reject the expense.');
    const r = await reverse(db, id, { memo: `Reversal of JV-${e.number} — ${reason}`, by });
    await db.update(bankLines).set({ status: 'Unmatched', matchedType: null, matchedId: null, matchedHow: null }).where(and(eq(bankLines.matchedType, 'entry'), eq(bankLines.matchedId, id)));
    await audit(db, aid, by.userId, by.name, `reversed JV-${e.number} — ${reason}`);
    return { reversal: 'JV-' + r.number };
  });

  /* ================= bank statement and reconciliation ================= */
  /** read a statement the bank exported: any column order, as long as it has a date and money in / money out */
  function readStatement(text: string) {
    const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
    const split = (l: string) => { const out: string[] = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map(s => s.trim()); };
    const at = lines.findIndex(l => /date/i.test(l) && /(debit|credit|withdraw|deposit|amount)/i.test(l));
    if (at < 0) throw badRequest('no_header', 'The file needs a header row with a Date column and Debit / Credit (or Withdrawal / Deposit, or Amount) columns.');
    const head = split(lines[at]!).map(h => h.toLowerCase());
    const col = (...names: RegExp[]) => head.findIndex(h => names.some(n => n.test(h)));
    const c = { date: col(/date/), desc: col(/narration|description|particular|remark|detail/), ref: col(/ref|chq|cheque|utr/), debit: col(/debit|withdraw/), credit: col(/credit|deposit/), amount: col(/^amount/), type: col(/dr\s*\/\s*cr|type/), balance: col(/balance/) };
    const num = (s?: string) => { const n = Math.round(Number((s ?? '').replace(/[₹,\s]/g, '').replace(/(cr|dr)$/i, ''))); return Number.isFinite(n) ? Math.abs(n) : 0; };
    const ymd = (s: string) => {
      const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/) ?? null;
      if (m) return `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`;
      const d = s.match(/^(\d{1,2})[/\-. ](\d{1,2}|[A-Za-z]{3})[/\-. ](\d{2,4})/); // Indian statements: day first
      if (!d) return null;
      const mon = /^\d+$/.test(d[2]!) ? Number(d[2]) : ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(d[2]!.toLowerCase()) + 1;
      const y = d[3]!.length === 2 ? '20' + d[3] : d[3]!;
      return mon >= 1 && mon <= 12 ? `${y}-${String(mon).padStart(2, '0')}-${d[1]!.padStart(2, '0')}` : null;
    };
    const out: { date: string; description: string; reference: string; debit: number; credit: number; balance: number | null }[] = [];
    for (const l of lines.slice(at + 1)) {
      const f = split(l), date = ymd(f[c.date] ?? '');
      if (!date || !isDate(date)) continue; // totals and footers
      let debit = c.debit >= 0 ? num(f[c.debit]) : 0, credit = c.credit >= 0 ? num(f[c.credit]) : 0;
      if (c.amount >= 0 && !debit && !credit) { const n = num(f[c.amount]); if (/^d/i.test(f[c.type] ?? '') || /^-/.test(f[c.amount] ?? '')) debit = n; else credit = n; }
      if (!debit && !credit) continue;
      out.push({ date, description: (f[c.desc] ?? '').slice(0, 300), reference: c.ref >= 0 ? (f[c.ref] ?? '').slice(0, 80) : '', debit, credit, balance: c.balance >= 0 && f[c.balance] ? num(f[c.balance]) : null });
    }
    if (!out.length) throw badRequest('no_rows', 'No transactions could be read from that file.');
    return out;
  }
  /** what each unmatched line could be: a receipt (money in) or a paid expense (money out) of the same amount within a few days */
  const candidates = async (aid: string, accountId: string) => {
    const taken = await db.select({ t: bankLines.matchedType, id: bankLines.matchedId }).from(bankLines).where(and(eq(bankLines.associationId, aid), eq(bankLines.status, 'Matched')));
    const used = new Set(taken.map(x => x.t + ':' + x.id));
    const pays = (await db.select({ id: payments.id, number: payments.number, amount: payments.amount, date: payments.receivedOn, reference: payments.reference, chequeNo: payments.chequeNo, unit: units.code })
      .from(payments).innerJoin(units, eq(units.id, payments.unitId)).where(and(eq(payments.associationId, aid), eq(payments.accountId, accountId), isNull(payments.reversedAt)))).filter(p => !used.has('payment:' + p.id));
    const exps = (await db.select({ id: expenses.id, number: expenses.number, amount: expenses.amount, date: expenses.paidOn, reference: expenses.reference, payee: expenses.payee })
      .from(expenses).where(and(eq(expenses.associationId, aid), eq(expenses.status, 'Paid'), eq(expenses.paidFrom, accountId)))).filter(e => !used.has('expense:' + e.id));
    return { pays, exps };
  };
  const near = (a: string, b: string | null, days = 4) => !!b && Math.abs(Date.parse(a) - Date.parse(b)) <= days * 864e5;
  const refHit = (line: { description: string; reference: string }, ...refs: (string | null)[]) => refs.some(r => !!r && r.length >= 4 && (line.description + ' ' + line.reference).toLowerCase().includes(r.toLowerCase()));

  app.post('/admin/:aid/finance/bank/import', async (req, reply) => {
    const { aid, by } = await writer(req);
    const b = parse(z.object({ accountId: z.uuid().optional(), csv: z.string().min(10).max(900_000) }), req.body);
    const chart = await chartOf(db, aid);
    const bank = b.accountId ? chart.find(a => a.id === b.accountId && a.role === 'bank') : byRole(chart, 'bank');
    if (!bank) throw badRequest('bad_account', 'Choose a bank account.');
    const parsed = readStatement(b.csv);
    // a line already imported (same day, amounts and text) is not imported twice
    const have = new Set((await db.select({ k: sql<string>`${bankLines.date} || '|' || ${bankLines.debit} || '|' || ${bankLines.credit} || '|' || ${bankLines.description}` }).from(bankLines)
      .where(and(eq(bankLines.associationId, aid), eq(bankLines.accountId, bank.id)))).map(x => x.k));
    const fresh = parsed.filter(l => !have.has(`${l.date}|${l.debit}|${l.credit}|${l.description}`));
    const batch = randomUUID();
    if (fresh.length) await db.insert(bankLines).values(fresh.map(l => ({ ...l, associationId: aid, accountId: bank.id, batch })));
    // match what can only be one thing: same amount, close in date, and either the reference agrees or nothing else fits
    const { pays, exps } = await candidates(aid, bank.id);
    const lines = await db.select().from(bankLines).where(eq(bankLines.batch, batch));
    let matched = 0;
    for (const l of lines) {
      const pool = l.credit ? pays.filter(p => p.amount === l.credit && near(l.date, p.date)).map(p => ({ type: 'payment' as const, id: p.id, strong: refHit(l, p.reference, p.chequeNo) }))
        : exps.filter(e => e.amount === l.debit && near(l.date, e.date)).map(e => ({ type: 'expense' as const, id: e.id, strong: refHit(l, e.reference) }));
      const strong = pool.filter(p => p.strong), pick = strong.length === 1 ? strong[0] : pool.length === 1 ? pool[0] : null;
      if (!pick) continue;
      await db.update(bankLines).set({ status: 'Matched', matchedType: pick.type, matchedId: pick.id, matchedHow: 'auto' }).where(eq(bankLines.id, l.id));
      (pick.type === 'payment' ? pays : exps).splice((pick.type === 'payment' ? pays : exps).findIndex(x => x.id === pick.id), 1);
      matched++;
    }
    await audit(db, aid, by.userId, by.name, `imported a bank statement · ${fresh.length} lines · ${matched} matched automatically`);
    return reply.status(201).send({ batch, read: parsed.length, imported: fresh.length, duplicates: parsed.length - fresh.length, matched, unmatched: fresh.length - matched });
  });

  app.get('/admin/:aid/finance/bank', async req => {
    const { aid } = await reader(req);
    const f = parse(Range.extend({ status: z.enum(['Unmatched', 'Matched', 'Ignored']).optional() }), req.query);
    const lines = await db.select().from(bankLines).where(and(eq(bankLines.associationId, aid), f.status ? eq(bankLines.status, f.status) : undefined, f.from ? gte(bankLines.date, f.from) : undefined, f.to ? lte(bankLines.date, f.to) : undefined))
      .orderBy(desc(bankLines.date), bankLines.createdAt).limit(2000);
    const bank = lines[0]?.accountId;
    const { pays, exps } = bank ? await candidates(aid, bank) : { pays: [], exps: [] };
    const allPays = await db.select({ id: payments.id, number: payments.number, unit: units.code }).from(payments).innerJoin(units, eq(units.id, payments.unitId)).where(eq(payments.associationId, aid));
    const allExps = await db.select({ id: expenses.id, number: expenses.number, payee: expenses.payee }).from(expenses).where(eq(expenses.associationId, aid));
    return lines.map(l => ({
      id: l.id, date: l.date, description: l.description, reference: l.reference, moneyOut: l.debit, moneyIn: l.credit, balance: l.balance, status: l.status, matchedHow: l.matchedHow,
      matchedTo: l.matchedType === 'payment' ? (p => p && `${p.number} · ${p.unit}`)(allPays.find(p => p.id === l.matchedId)) ?? null
        : l.matchedType === 'expense' ? (e => e && `${e.number} · ${e.payee}`)(allExps.find(e => e.id === l.matchedId)) ?? null
        : l.matchedType === 'entry' ? 'Journal entry' : null,
      suggestions: l.status !== 'Unmatched' ? [] : l.credit
        ? pays.filter(p => p.amount === l.credit).sort((a, b) => Math.abs(Date.parse(a.date) - Date.parse(l.date)) - Math.abs(Date.parse(b.date) - Date.parse(l.date))).slice(0, 5).map(p => ({ type: 'payment', id: p.id, label: `${p.number} · ${p.unit} · ${p.date}` }))
        : exps.filter(e => e.amount === l.debit).slice(0, 5).map(e => ({ type: 'expense', id: e.id, label: `${e.number} · ${e.payee} · ${e.date}` })),
    }));
  });
  const findLine = async (aid: string, id: string) => {
    const [l] = await db.select().from(bankLines).where(and(eq(bankLines.id, id), eq(bankLines.associationId, aid)));
    if (!l) throw notFound('That bank line');
    await assertOpen(db, aid, l.date);
    return l;
  };
  app.post('/admin/:aid/finance/bank/:id/match', async req => {
    const { aid } = await writer(req);
    const { id } = parse(Id, req.params);
    const b = parse(z.object({ type: z.enum(['payment', 'expense']), id: z.uuid() }), req.body);
    const l = await findLine(aid, id);
    if (l.status === 'Matched') throw conflict('already_matched', 'This line is already matched. Unmatch it first.');
    const [taken] = await db.select({ id: bankLines.id }).from(bankLines).where(and(eq(bankLines.associationId, aid), eq(bankLines.matchedType, b.type), eq(bankLines.matchedId, b.id)));
    if (taken) throw conflict('target_taken', 'That entry is already matched to another bank line.');
    const amount = b.type === 'payment' ? (await db.select({ n: payments.amount }).from(payments).where(and(eq(payments.id, b.id), eq(payments.associationId, aid))))[0]?.n
      : (await db.select({ n: expenses.amount }).from(expenses).where(and(eq(expenses.id, b.id), eq(expenses.associationId, aid), eq(expenses.status, 'Paid'))))[0]?.n;
    if (amount === undefined) throw notFound('That entry');
    if (amount !== (b.type === 'payment' ? l.credit : l.debit)) throw badRequest('amount_differs', `The amounts differ: the bank shows ${rupees(b.type === 'payment' ? l.credit : l.debit)}, the entry is ${rupees(amount)}.`);
    await db.update(bankLines).set({ status: 'Matched', matchedType: b.type, matchedId: b.id, matchedHow: 'manual' }).where(eq(bankLines.id, id));
    return { matched: true };
  });
  app.post('/admin/:aid/finance/bank/:id/unmatch', async req => {
    const { aid } = await writer(req);
    const l = await findLine(aid, parse(Id, req.params).id);
    if (l.matchedType === 'entry') throw conflict('posted', 'This line was posted to the books. Reverse that journal entry to undo it.');
    await db.update(bankLines).set({ status: 'Unmatched', matchedType: null, matchedId: null, matchedHow: null }).where(eq(bankLines.id, l.id));
    return { matched: false };
  });
  /** something the books don't have yet — bank charges, interest: choose the head and it is posted */
  app.post('/admin/:aid/finance/bank/:id/categorize', async req => {
    const { aid, by } = await writer(req);
    const b = parse(z.object({ accountId: z.uuid(), memo: z.string().trim().max(200).optional() }), req.body);
    const l = await findLine(aid, parse(Id, req.params).id);
    if (l.status === 'Matched') throw conflict('already_matched', 'This line is already matched.');
    const chart = await chartOf(db, aid), head = chart.find(a => a.id === b.accountId);
    if (!head || head.role === 'receivable' || head.id === l.accountId) throw badRequest('bad_head', 'Choose an income, expense or fund head.');
    const amount = l.credit || l.debit;
    const e = await post(db, { associationId: aid, date: l.date, memo: b.memo || l.description || 'Bank statement entry', source: 'bank', by,
      lines: l.credit ? [{ accountId: l.accountId, debit: amount }, { accountId: head.id, credit: amount }] : [{ accountId: head.id, debit: amount }, { accountId: l.accountId, credit: amount }] });
    await db.update(bankLines).set({ status: 'Matched', matchedType: 'entry', matchedId: e.id, matchedHow: 'manual' }).where(eq(bankLines.id, l.id));
    await audit(db, aid, by.userId, by.name, `posted bank line to ${head.name} · ${rupees(amount)} · JV-${e.number}`);
    return { matched: true, entry: 'JV-' + e.number };
  });
  app.post('/admin/:aid/finance/bank/:id/ignore', async req => {
    const { aid } = await writer(req);
    const l = await findLine(aid, parse(Id, req.params).id);
    if (l.status === 'Matched') throw conflict('already_matched', 'This line is already matched.');
    await db.update(bankLines).set({ status: l.status === 'Ignored' ? 'Unmatched' : 'Ignored' }).where(eq(bankLines.id, l.id));
    return { status: l.status === 'Ignored' ? 'Unmatched' : 'Ignored' };
  });

  /* ---- closing a month ---- */
  app.get('/admin/:aid/finance/periods', async req => {
    const { aid } = await reader(req);
    const locks = await db.select().from(periodLocks).where(eq(periodLocks.associationId, aid));
    const months = await rows<{ period: string; entries: number; unmatched: number }>(sql`
      select p.period, (select count(*)::int from journal_entries e where e.association_id = ${aid} and to_char(e.date, 'YYYY-MM') = p.period) as entries,
        (select count(*)::int from bank_lines b where b.association_id = ${aid} and b.status = 'Unmatched' and to_char(b.date, 'YYYY-MM') = p.period) as unmatched
      from (select distinct to_char(date, 'YYYY-MM') as period from journal_entries where association_id = ${aid}) p order by p.period desc`);
    return months.map(m => { const l = locks.find(x => x.period === m.period); return { ...m, name: monthName(m.period), locked: !!l, lockedBy: l?.byName ?? null, lockedAt: l?.lockedAt ?? null }; });
  });
  app.post('/admin/:aid/finance/periods/:period/lock', async req => {
    const { aid, by } = await writer(req);
    const { period } = parse(z.object({ period: Period }), req.params);
    if (period >= today().slice(0, 7)) throw badRequest('month_not_over', 'A month can be closed once it is over.');
    const n = (await rows<{ n: number }>(sql`select count(*)::int as n from bank_lines where association_id = ${aid} and status = 'Unmatched' and to_char(date, 'YYYY-MM') = ${period}`))[0]?.n ?? 0;
    if (n) throw conflict('unreconciled', `${n} bank line${n === 1 ? ' is' : 's are'} still unmatched in ${monthName(period)}. Match, post or ignore them first.`);
    await db.insert(periodLocks).values({ associationId: aid, period, byName: by.name }).onConflictDoNothing();
    await audit(db, aid, by.userId, by.name, `closed the books for ${monthName(period)}`);
    return { period, locked: true };
  });
  app.delete('/admin/:aid/finance/periods/:period/lock', async req => {
    const { aid, by } = await writer(req);
    const { period } = parse(z.object({ period: Period }), req.params);
    const gone = await db.delete(periodLocks).where(and(eq(periodLocks.associationId, aid), eq(periodLocks.period, period))).returning();
    if (!gone.length) throw notFound('That lock');
    await audit(db, aid, by.userId, by.name, `reopened the books for ${monthName(period)}`);
    return { period, locked: false };
  });

  /* ================= auditors: a read-only login to the books ================= */
  const auditors = (aid: string) => db.select({ id: users.id, name: users.name, email: users.email }).from(staffRoles).innerJoin(users, eq(users.id, staffRoles.userId))
    .where(and(eq(staffRoles.associationId, aid), eq(staffRoles.role, 'auditor'), isNull(users.deletedAt))).orderBy(users.name);
  app.get('/admin/:aid/finance/auditors', async req => { const { aid } = await writer(req); return auditors(aid); });
  app.post('/admin/:aid/finance/auditors', async (req, reply) => {
    const { aid, by } = await writer(req);
    const b = parse(z.object({ name: z.string().trim().min(2).max(80), email: z.email(), password: z.string().min(8).max(100) }), req.body);
    const email = b.email.toLowerCase();
    const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    if (taken) throw conflict('email_taken', 'That email already has a login. Use a different one.');
    const [u] = await db.insert(users).values({ name: b.name, email, passwordHash: await hashPassword(b.password) }).returning();
    await db.insert(staffRoles).values({ userId: u!.id, associationId: aid, role: 'auditor', title: 'Auditor' });
    await audit(db, aid, by.userId, by.name, `gave ${b.name} read-only access to the books`);
    return reply.status(201).send({ id: u!.id, name: u!.name, email: u!.email });
  });
  app.delete('/admin/:aid/finance/auditors/:id', async (req, reply) => {
    const { aid, by } = await writer(req);
    const { id } = parse(Id, req.params);
    const gone = await db.delete(staffRoles).where(and(eq(staffRoles.userId, id), eq(staffRoles.associationId, aid), eq(staffRoles.role, 'auditor'))).returning();
    if (!gone.length) throw notFound('That auditor');
    await db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.userId, id), isNull(refreshTokens.revokedAt)));
    await audit(db, aid, by.userId, by.name, 'removed an auditor');
    return reply.status(204).send();
  });

  /* ================= reports ================= */
  const REPORTS = ['collection', 'defaulters', 'income', 'expense', 'vendors', 'pnl', 'balance-sheet', 'cash-flow', 'trial-balance', 'reconciliation', 'daybook', 'audit'] as const;
  app.get('/admin/:aid/finance/reports/:name', async (req, reply) => {
    const { aid } = await reader(req);
    const { name } = parse(z.object({ name: z.enum(REPORTS) }), req.params);
    const f = parse(Range.extend({ format: z.enum(['json', 'csv']).default('json') }), req.query);
    const from = f.from ?? (today().slice(0, 4) + '-' + (today().slice(5, 7) >= '04' ? '04' : '01') + '-01'), to = f.to ?? today();
    const fromFY = f.from ?? `${Number(today().slice(0, 4)) - (today().slice(5, 7) < '04' ? 1 : 0)}-04-01`; // the Indian financial year starts in April
    const send = (title: string, head: string[], data: (string | number | null)[][], extra: Record<string, unknown> = {}) =>
      f.format === 'csv' ? csv(reply, `${name}-${to}`, head, data) : { name, title, from: fromFY, to, head, rows: data, ...extra };
    void from;

    if (name === 'collection') {
      const r = await rows<{ month: string; mode: string; receipts: number; amount: number }>(sql`
        select to_char(received_on, 'YYYY-MM') as month, mode, count(*)::int as receipts, sum(amount)::int as amount from payments
        where association_id = ${aid} and reversed_at is null and received_on between ${fromFY}::date and ${to}::date group by 1, 2 order by 1 desc, 2`);
      return send('Collection, month by month', ['Month', 'Mode', 'Receipts', 'Amount'], r.map(x => [monthName(x.month), x.mode, x.receipts, x.amount]), { total: r.reduce((n, x) => n + x.amount, 0) });
    }
    if (name === 'defaulters') {
      const bal = await unitBalances(db, aid);
      const open = (await db.select({ b: bills, unit: units.code }).from(bills).innerJoin(units, eq(units.id, bills.unitId)).where(and(eq(bills.associationId, aid), isNull(bills.cancelledAt)))).filter(x => dueOf(x.b) > 0);
      const age = (d: string) => Math.max(0, Math.floor((Date.parse(today()) - Date.parse(d)) / 864e5));
      const byUnit = new Map<string, { unit: string; bills: number; oldest: number; d30: number; d60: number; d90: number; over: number }>();
      for (const { b, unit } of open) {
        const r = byUnit.get(b.unitId) ?? { unit, bills: 0, oldest: 0, d30: 0, d60: 0, d90: 0, over: 0 }, a = age(b.dueDate), due = dueOf(b);
        r.bills++; r.oldest = Math.max(r.oldest, a);
        if (a <= 30) r.d30 += due; else if (a <= 60) r.d60 += due; else if (a <= 90) r.d90 += due; else r.over += due;
        byUnit.set(b.unitId, r);
      }
      const data = [...byUnit.entries()].map(([id, r]) => ({ ...r, balance: bal.get(id) ?? 0 })).filter(r => r.balance > 0).sort((a, b) => b.balance - a.balance);
      return send('Flats with pending dues', ['Flat', 'Open bills', 'Days overdue', '0–30 days', '31–60 days', '61–90 days', 'Over 90 days', 'Total due'],
        data.map(r => [r.unit, r.bills, r.oldest, r.d30, r.d60, r.d90, r.over, r.balance]), { total: data.reduce((n, r) => n + r.balance, 0) });
    }
    if (name === 'income' || name === 'expense') {
      const b = (await balances(db, aid, { from: fromFY, to })).filter(a => a.kind === name && a.balance);
      return send(name === 'income' ? 'Income by head' : 'Expenses by head', ['Code', 'Head', 'Amount'], b.map(a => [a.code, a.name, a.balance]), { total: b.reduce((n, a) => n + a.balance, 0) });
    }
    if (name === 'vendors') {
      const r = await rows<{ payee: string; bills: number; total: number; paid: number; due: number; waiting: number }>(sql`
        select payee, count(*)::int as bills, sum(amount) filter (where status in ('Approved','Paid'))::int as total, coalesce(sum(amount) filter (where status = 'Paid'), 0)::int as paid,
          coalesce(sum(amount) filter (where status = 'Approved'), 0)::int as due, coalesce(sum(amount) filter (where status = 'Pending approval'), 0)::int as waiting
        from expenses where association_id = ${aid} and date between ${fromFY}::date and ${to}::date and status <> 'Rejected' group by payee order by due desc, total desc nulls last`);
      return send('Vendor payments', ['Payee', 'Bills', 'Booked', 'Paid', 'Still to pay', 'Awaiting approval'], r.map(x => [x.payee, x.bills, x.total ?? 0, x.paid, x.due, x.waiting]), { total: r.reduce((n, x) => n + x.due, 0) });
    }
    if (name === 'pnl') {
      const b = await balances(db, aid, { from: fromFY, to });
      const inc = b.filter(a => a.kind === 'income' && a.balance), exp = b.filter(a => a.kind === 'expense' && a.balance);
      const ti = inc.reduce((n, a) => n + a.balance, 0), te = exp.reduce((n, a) => n + a.balance, 0);
      return send('Income and expenditure', ['Section', 'Head', 'Amount'], [...inc.map(a => ['Income', a.name, a.balance]), ['Income', 'Total income', ti], ...exp.map(a => ['Expenses', a.name, a.balance]), ['Expenses', 'Total expenses', te], ['Result', ti - te >= 0 ? 'Surplus' : 'Deficit', ti - te]],
        { income: ti, expenses: te, surplus: ti - te });
    }
    if (name === 'balance-sheet') {
      const b = await balances(db, aid, { to });
      const surplus = b.filter(a => a.kind === 'income').reduce((n, a) => n + a.balance, 0) - b.filter(a => a.kind === 'expense').reduce((n, a) => n + a.balance, 0);
      const part = (k: string) => b.filter(a => a.kind === k && a.balance);
      const assets = part('asset').reduce((n, a) => n + a.balance, 0), liab = part('liability').reduce((n, a) => n + a.balance, 0), funds = part('equity').reduce((n, a) => n + a.balance, 0) + surplus;
      return send('Balance sheet', ['Section', 'Head', 'Amount'], [...part('asset').map(a => ['Assets', a.name, a.balance]), ['Assets', 'Total assets', assets],
        ...part('liability').map(a => ['Liabilities', a.name, a.balance]), ['Liabilities', 'Total liabilities', liab],
        ...part('equity').map(a => ['Funds', a.name, a.balance]), ['Funds', 'Surplus to date', surplus], ['Funds', 'Total funds', funds], ['Check', 'Liabilities + funds', liab + funds]],
        { assets, liabilities: liab, funds, balanced: assets === liab + funds });
    }
    if (name === 'cash-flow') {
      // every movement of bank and cash, named by what the other side of the entry was
      const r = await rows<{ month: string; head: string; money_in: number; money_out: number }>(sql`
        select to_char(e.date, 'YYYY-MM') as month, coalesce((select min(a2.name) from journal_lines l2 join accounts a2 on a2.id = l2.account_id where l2.entry_id = e.id and a2.role is distinct from 'bank' and a2.role is distinct from 'cash'), 'Transfer') as head,
          sum(l.debit)::int as money_in, sum(l.credit)::int as money_out
        from journal_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id
        where e.association_id = ${aid} and a.role in ('bank', 'cash') and e.date between ${fromFY}::date and ${to}::date group by 1, 2 order by 1 desc, 2`);
      const tin = r.reduce((n, x) => n + x.money_in, 0), tout = r.reduce((n, x) => n + x.money_out, 0);
      return send('Cash flow', ['Month', 'From / to', 'Money in', 'Money out'], r.map(x => [monthName(x.month), x.head, x.money_in, x.money_out]), { moneyIn: tin, moneyOut: tout, net: tin - tout });
    }
    if (name === 'trial-balance') {
      const b = (await balances(db, aid, { to })).filter(a => a.debit || a.credit);
      const net = b.map(a => ({ ...a, dr: Math.max(0, a.debit - a.credit), cr: Math.max(0, a.credit - a.debit) }));
      return send('Trial balance', ['Code', 'Account', 'Debit', 'Credit'], net.map(a => [a.code, a.name, a.dr || null, a.cr || null]), { debit: net.reduce((n, a) => n + a.dr, 0), credit: net.reduce((n, a) => n + a.cr, 0) });
    }
    if (name === 'reconciliation') {
      const l = await db.select().from(bankLines).where(and(eq(bankLines.associationId, aid), gte(bankLines.date, fromFY), lte(bankLines.date, to))).orderBy(bankLines.date);
      const count = (s: string) => l.filter(x => x.status === s).length;
      return send('Bank reconciliation', ['Date', 'Description', 'Reference', 'Money out', 'Money in', 'Status', 'How'], l.map(x => [x.date, x.description, x.reference, x.debit || null, x.credit || null, x.status, x.matchedHow]),
        { matched: count('Matched'), unmatched: count('Unmatched'), ignored: count('Ignored'), unmatchedIn: l.filter(x => x.status === 'Unmatched').reduce((n, x) => n + x.credit, 0), unmatchedOut: l.filter(x => x.status === 'Unmatched').reduce((n, x) => n + x.debit, 0) });
    }
    if (name === 'daybook') {
      // one row per ledger line, the layout accounting packages (Tally, Zoho Books) import as vouchers
      const voucher = { bill: 'Sales', payment: 'Receipt', expense: 'Purchase', expense_payment: 'Payment', journal: 'Journal', waiver: 'Journal', opening: 'Journal', bank: 'Journal', reversal: 'Journal' } as const;
      const e = (await entriesOut(aid, { from: fromFY, to }, 20000)).reverse();
      return send('Day book (voucher export)', ['Date', 'Voucher type', 'Voucher no', 'Ledger', 'Flat', 'Debit', 'Credit', 'Narration'],
        e.flatMap(x => x.lines.map(l => [x.date, voucher[x.source as keyof typeof voucher] ?? 'Journal', x.ref, l.account, l.unit, l.debit || null, l.credit || null, x.memo])), { entries: e.length });
    }
    // audit: who did what to the books
    const a = await db.select({ at: auditLog.createdAt, actor: auditLog.actor, action: auditLog.action }).from(auditLog)
      .where(and(eq(auditLog.associationId, aid), gte(auditLog.createdAt, new Date(fromFY + 'T00:00:00+05:30')), lte(auditLog.createdAt, new Date(to + 'T23:59:59+05:30')),
        sql`${auditLog.action} ~* '(bill|recorded ₹|reversed|waived|cancelled BILL|expense|EXP-|journal|JV-|bank|books|late fee|opening balance|account)'`)).orderBy(desc(auditLog.createdAt)).limit(2000);
    return send('Audit trail of the books', ['When', 'Who', 'What'], a.map(x => [x.at.toISOString().replace('T', ' ').slice(0, 16), x.actor, x.action]));
  });

  /* ================= the resident ================= */
  app.get('/dues', async req => {
    const me = await residentOf(db, await uid(req));
    await chartOf(db, me.associationId);
    const s = await settingsOf(db, me.associationId);
    const mine = await db.select().from(bills).where(and(eq(bills.unitId, me.unitId), isNull(bills.cancelledAt))).orderBy(desc(bills.dueDate)).limit(200);
    const pays = await db.select({ id: payments.id, number: payments.number, amount: payments.amount, mode: payments.mode, receivedOn: payments.receivedOn, reversed: sql<boolean>`${payments.reversedAt} is not null` })
      .from(payments).where(eq(payments.unitId, me.unitId)).orderBy(desc(payments.receivedOn), desc(payments.createdAt)).limit(100);
    const l = await ledgerOf(me.associationId, me.unitId);
    const balance = (await unitBalances(db, me.associationId)).get(me.unitId) ?? 0;
    return {
      unit: me.unitCode, balance, due: Math.max(0, balance), advance: Math.max(0, -balance),
      open: mine.filter(b => dueOf(b) > 0).map(b => billOut(b)).reverse(), paid: mine.filter(b => dueOf(b) === 0).slice(0, 24).map(b => billOut(b)),
      payments: pays, ledger: l.lines.slice(-60).reverse(),
      pay: { online: config.PAYMENTS === 'mock', allowPartial: s.allowPartial, upiId: s.upiId, bankDetails: s.bankDetails },
    };
  });
  app.get('/dues/receipts/:id', async req => {
    const me = await residentOf(db, await uid(req));
    const r = await receipt(parse(Id, req.params).id, me.associationId);
    if (r.unitId !== me.unitId) throw notFound('That receipt');
    return r;
  });
  /**
   * Pay from the app. A real payment gateway (Razorpay, Cashfree, PayU) needs a merchant account; until one
   * is connected this answers "not set up" — except with PAYMENTS=mock, which stands in for the gateway in
   * development and tests so the rest of the flow (receipt, ledger, bill settled) can be seen working.
   */
  app.post('/dues/pay', async (req, reply) => {
    const me = await residentOf(db, await uid(req));
    const b = parse(z.object({ amount: Money, billIds: z.array(z.uuid()).max(100).optional() }), req.body);
    if (config.PAYMENTS !== 'mock') throw conflict('online_not_set_up', 'Online payment isn’t set up for this society yet. Pay by UPI or at the office and it will show here once recorded.');
    const out = await recordPayment(db, me.associationId, { unitId: me.unitId, amount: b.amount, mode: 'Payment gateway', reference: 'TEST-' + randomUUID().slice(0, 8).toUpperCase(), billIds: b.billIds, payerName: me.name, source: 'resident' },
      { userId: me.userId, name: me.name });
    await audit(db, me.associationId, me.userId, me.name, `paid ${rupees(b.amount)} in the app · ${out.payment.number} (test gateway)`);
    return reply.status(201).send(await receipt(out.payment.id, me.associationId));
  });
};
