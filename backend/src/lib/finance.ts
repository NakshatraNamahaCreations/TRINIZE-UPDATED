import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import {
  bills, billRuns, expenses, payments, paymentAllocations, unitMembers, units,
  type BillMethod, type ChargeType, type PaymentMode,
} from '../db/schema.js';
import { notify } from './community.js';
import { badRequest, conflict, notFound } from './http.js';
import { byCode, byRole, CHARGE_ACCOUNT, chartOf, monthName, post, reverse, settingsOf, today, type Account } from './ledger.js';

/* What the office does with money, each as one operation that also posts to the ledger:
   bill a flat, take a payment, waive, book and pay an expense. */

type Tx = Pick<DB, 'select' | 'insert' | 'update' | 'delete' | 'execute' | 'transaction'>;
export type By = { userId: string | null; name: string };
export type Bill = typeof bills.$inferSelect;
export const rupees = (n: number) => '₹' + n.toLocaleString('en-IN');

export type BillStatus = 'Unpaid' | 'Part paid' | 'Overdue' | 'Paid' | 'Waived' | 'Cancelled';
export const dueOf = (b: Pick<Bill, 'amount' | 'paid' | 'waived' | 'cancelledAt'>) => (b.cancelledAt ? 0 : Math.max(0, b.amount - b.paid - b.waived));
export function billStatus(b: Bill, on = today()): BillStatus {
  if (b.cancelledAt) return 'Cancelled';
  if (dueOf(b) === 0) return b.paid === 0 && b.waived > 0 ? 'Waived' : 'Paid';
  if (b.dueDate < on) return 'Overdue';
  return b.paid + b.waived > 0 ? 'Part paid' : 'Unpaid';
}

/** what a flat owes right now (negative = it has paid in advance) — read from the ledger, not from the bills */
export async function unitBalances(db: Tx, associationId: string, asOf?: string): Promise<Map<string, number>> {
  const rows = ((await db.execute(sql`
    select l.unit_id as unit, (coalesce(sum(l.debit), 0) - coalesce(sum(l.credit), 0))::int as balance
    from journal_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id
    where e.association_id = ${associationId} and a.role = 'receivable' and l.unit_id is not null and (${asOf ?? null}::date is null or e.date <= ${asOf ?? null}::date)
    group by l.unit_id`)) as unknown as { rows: { unit: string; balance: number }[] }).rows;
  return new Map(rows.map(r => [r.unit, r.balance]));
}

/* ---------- billing ---------- */
export type RunInput = {
  period: string; chargeType: ChargeType; method: BillMethod; dueDate: string; description?: string;
  amount?: number; rate?: number; byType?: Record<string, number>; byUnit?: Record<string, number>; unitIds?: string[];
};

/** each flat's amount under the chosen method; flats that come to nothing are left out, with the reason */
export async function previewRun(db: Tx, associationId: string, r: RunInput) {
  const flats = await db.select().from(units).where(eq(units.associationId, associationId)).orderBy(units.code);
  const chosen = r.unitIds?.length ? flats.filter(f => r.unitIds!.includes(f.id)) : flats;
  const already = new Set((await db.select({ unitId: bills.unitId }).from(bills)
    .where(and(eq(bills.associationId, associationId), eq(bills.period, r.period), eq(bills.chargeType, r.chargeType), isNull(bills.cancelledAt)))).map(b => b.unitId));
  const rows = chosen.map(f => {
    const amount = r.method === 'flat' ? r.amount ?? 0
      : r.method === 'sqft' ? Math.round((r.rate ?? 0) * f.area)
      : r.method === 'type' ? r.byType?.[f.flatType] ?? 0
      : r.byUnit?.[f.id] ?? 0;
    const skip = already.has(f.id) ? 'Already billed for this month'
      : amount > 0 ? null
      : r.method === 'sqft' && !f.area ? 'No area on record'
      : r.method === 'type' && !f.flatType ? 'No flat type on record'
      : r.method === 'type' ? `No amount set for ${f.flatType}` : 'No amount';
    return { unitId: f.id, unit: f.code, area: f.area, flatType: f.flatType, amount: skip ? 0 : amount, skip };
  });
  return { rows, bills: rows.filter(x => !x.skip).length, total: rows.reduce((n, x) => n + x.amount, 0) };
}

async function nextBillNumber(db: Tx, associationId: string, period: string) {
  const prefix = `BILL-${period.slice(2, 4)}${period.slice(5, 7)}-`;
  const [{ n }] = (await db.select({ n: sql<number>`coalesce(max(split_part(${bills.number}, '-', 3)::int), 0)` }).from(bills)
    .where(and(eq(bills.associationId, associationId), sql`${bills.number} like ${prefix + '%'}`))) as [{ n: number }];
  return (i: number) => prefix + String(n + i + 1).padStart(4, '0');
}

/** money a flat has already paid that no bill has used yet is taken against a new bill straight away */
async function useAdvance(db: Tx, bill: Bill) {
  const free = ((await db.execute(sql`
    select p.id, (p.amount - coalesce((select sum(a.amount) from payment_allocations a where a.payment_id = p.id), 0))::int as free
    from payments p where p.unit_id = ${bill.unitId} and p.reversed_at is null order by p.received_on`)) as unknown as { rows: { id: string; free: number }[] }).rows.filter(p => p.free > 0);
  let left = dueOf(bill), used = 0;
  for (const p of free) {
    if (!left) break;
    const take = Math.min(left, p.free);
    await db.insert(paymentAllocations).values({ paymentId: p.id, billId: bill.id, amount: take });
    left -= take; used += take;
  }
  if (used) await db.update(bills).set({ paid: bill.paid + used }).where(eq(bills.id, bill.id));
  return used;
}

async function insertBill(db: Tx, chart: Account[], o: { associationId: string; unitId: string; unit: string; number: string; period: string; chargeType: ChargeType; description: string; amount: number; dueDate: string; runId?: string | null; lateFeeFor?: string | null; date?: string; by: By }) {
  const entry = await post(db, {
    associationId: o.associationId, date: o.date ?? today(), memo: `${o.chargeType} · ${monthName(o.period)} · ${o.unit}`, source: 'bill', by: o.by,
    lines: [{ accountId: byRole(chart, 'receivable').id, debit: o.amount, unitId: o.unitId }, { accountId: byCode(chart, CHARGE_ACCOUNT[o.chargeType]).id, credit: o.amount }],
  });
  const [b] = await db.insert(bills).values({ associationId: o.associationId, unitId: o.unitId, number: o.number, period: o.period, chargeType: o.chargeType, description: o.description,
    amount: o.amount, dueDate: o.dueDate, runId: o.runId ?? null, entryId: entry.id, lateFeeFor: o.lateFeeFor ?? null }).returning();
  // the bill as it stands after any advance was taken against it
  if (await useAdvance(db, b!)) return (await db.select().from(bills).where(eq(bills.id, b!.id)))[0]!;
  return b!;
}

export async function generateBills(db: Tx, associationId: string, r: RunInput, by: By) {
  const preview = await previewRun(db, associationId, r);
  const todo = preview.rows.filter(x => !x.skip);
  if (!todo.length) throw badRequest('nothing_to_bill', preview.rows.length ? 'No flat comes to an amount: ' + [...new Set(preview.rows.map(x => x.skip))].join('; ') + '.' : 'There are no flats to bill.');
  return db.transaction(async tx => {
    const chart = await chartOf(tx, associationId);
    const { amount, rate, byType, byUnit } = r;
    const [run] = await tx.insert(billRuns).values({ associationId, period: r.period, chargeType: r.chargeType, method: r.method, rate: { amount, rate, byType, byUnit }, dueDate: r.dueDate,
      bills: todo.length, total: preview.total, byName: by.name }).returning();
    const number = await nextBillNumber(tx, associationId, r.period);
    const made: Bill[] = [];
    for (const [i, x] of todo.entries()) {
      made.push(await insertBill(tx, chart, { associationId, unitId: x.unitId, unit: x.unit, number: number(i), period: r.period, chargeType: r.chargeType,
        description: r.description ?? '', amount: x.amount, dueDate: r.dueDate, runId: run!.id, by }));
    }
    return { run: run!, bills: made, skipped: preview.rows.filter(x => x.skip).map(x => ({ unit: x.unit, why: x.skip! })) };
  });
}

/** one bill for one flat: a penalty, a deposit, a one-off charge */
export async function billOne(db: Tx, associationId: string, o: { unitId: string; chargeType: ChargeType; amount: number; dueDate: string; period?: string; description?: string; lateFeeFor?: string }, by: By) {
  const [f] = await db.select().from(units).where(and(eq(units.id, o.unitId), eq(units.associationId, associationId)));
  if (!f) throw notFound('That flat');
  return db.transaction(async tx => {
    const period = o.period ?? today().slice(0, 7);
    const number = await nextBillNumber(tx, associationId, period);
    return insertBill(tx, await chartOf(tx, associationId), { associationId, unitId: f.id, unit: f.code, number: number(0), period, chargeType: o.chargeType,
      description: o.description ?? '', amount: o.amount, dueDate: o.dueDate, lateFeeFor: o.lateFeeFor, by });
  });
}

/** charge the society's late fee once on every bill that is past its grace period */
export async function runLateFees(db: Tx, associationId: string, by: By) {
  const s = await settingsOf(db, associationId);
  if (s.lateFee.kind === 'none' || s.lateFee.value <= 0) throw badRequest('no_late_fee', 'No late fee is set. Add one in the accounting settings first.');
  const cutoff = new Date(Date.now() + 5.5 * 3600e3 - s.lateFee.graceDays * 864e5).toISOString().slice(0, 10);
  const open = (await db.select().from(bills).where(and(eq(bills.associationId, associationId), isNull(bills.cancelledAt), isNull(bills.lateFeeFor), sql`${bills.dueDate} < ${cutoff}`, sql`${bills.chargeType} <> 'Penalty'`)))
    .filter(b => dueOf(b) > 0);
  const charged = new Set((await db.select({ id: bills.lateFeeFor }).from(bills).where(and(eq(bills.associationId, associationId), sql`${bills.lateFeeFor} is not null`, isNull(bills.cancelledAt)))).map(x => x.id));
  const made: Bill[] = [];
  for (const b of open.filter(x => !charged.has(x.id))) {
    const fee = s.lateFee.kind === 'flat' ? s.lateFee.value : Math.round(dueOf(b) * s.lateFee.value / 100);
    if (fee > 0) made.push(await billOne(db, associationId, { unitId: b.unitId, chargeType: 'Penalty', amount: fee, dueDate: today(), period: b.period, description: `Late fee on ${b.number}`, lateFeeFor: b.id }, by));
  }
  return made;
}

export async function waive(db: Tx, bill: Bill, amount: number, reason: string, by: By) {
  if (amount > dueOf(bill)) throw badRequest('too_much', `Only ${rupees(dueOf(bill))} is outstanding on this bill.`);
  return db.transaction(async tx => {
    const chart = await chartOf(tx, bill.associationId);
    await post(tx, { associationId: bill.associationId, date: today(), memo: `Waiver on ${bill.number} — ${reason}`, source: 'waiver', sourceId: bill.id, by,
      lines: [{ accountId: byRole(chart, 'waiver').id, debit: amount }, { accountId: byRole(chart, 'receivable').id, credit: amount, unitId: bill.unitId }] });
    const [u] = await tx.update(bills).set({ waived: bill.waived + amount }).where(eq(bills.id, bill.id)).returning();
    return u!;
  });
}

export async function cancelBill(db: Tx, bill: Bill, reason: string, by: By) {
  if (bill.cancelledAt) throw conflict('already_cancelled', 'This bill is already cancelled.');
  if (bill.paid > 0) throw conflict('has_payments', 'Money has been received against this bill. Reverse the payment first, or waive the balance.');
  return db.transaction(async tx => {
    if (bill.entryId) await reverse(tx, bill.entryId, { memo: `Cancelled ${bill.number} — ${reason}`, by });
    const [u] = await tx.update(bills).set({ cancelledAt: new Date() }).where(eq(bills.id, bill.id)).returning();
    return u!;
  });
}

/* ---------- payments ---------- */
export type PaymentInput = {
  unitId: string; amount: number; mode: PaymentMode; reference?: string; chequeNo?: string; chequeDate?: string; receivedOn?: string;
  payerName?: string; note?: string; billIds?: string[]; accountId?: string; source?: 'office' | 'resident';
};

/** Take money from a flat: receipt, ledger, and bills settled oldest first (or the ones named). */
export async function recordPayment(db: Tx, associationId: string, p: PaymentInput, by: By) {
  const [f] = await db.select().from(units).where(and(eq(units.id, p.unitId), eq(units.associationId, associationId)));
  if (!f) throw notFound('That flat');
  if (p.mode === 'Cheque' && !p.chequeNo) throw badRequest('cheque_no', 'Enter the cheque number.');
  const s = await settingsOf(db, associationId);
  return db.transaction(async tx => {
    const chart = await chartOf(tx, associationId);
    const open = (await tx.select().from(bills).where(and(eq(bills.unitId, f.id), isNull(bills.cancelledAt))).orderBy(asc(bills.dueDate), asc(bills.createdAt))).filter(b => dueOf(b) > 0);
    const target = p.billIds?.length ? open.filter(b => p.billIds!.includes(b.id)) : open;
    if (p.billIds?.length && target.length !== new Set(p.billIds).size) throw badRequest('bad_bills', 'One of those bills isn’t open for this flat.');
    const owed = target.reduce((n, b) => n + dueOf(b), 0);
    if (!s.allowPartial && owed > 0 && p.amount < owed) throw badRequest('partial_not_allowed', `This society doesn’t accept part payments. ${rupees(owed)} is due.`);
    const into = p.accountId ? chart.find(a => a.id === p.accountId && (a.role === 'bank' || a.role === 'cash')) : byRole(chart, p.mode === 'Cash' ? 'cash' : 'bank');
    if (!into) throw badRequest('bad_account', 'Choose the bank or cash account the money went into.');
    const on = p.receivedOn ?? today();
    const [{ n }] = (await tx.select({ n: sql<number>`coalesce(max(substring(${payments.number} from 5)::int), 0)` }).from(payments).where(eq(payments.associationId, associationId))) as [{ n: number }];
    const number = 'RCP-' + String(n + 1).padStart(6, '0');
    const entry = await post(tx, { associationId, date: on, memo: `Receipt ${number} · ${f.code} · ${p.mode}${p.reference ? ' ' + p.reference : ''}`, source: 'payment', by,
      lines: [{ accountId: into.id, debit: p.amount }, { accountId: byRole(chart, 'receivable').id, credit: p.amount, unitId: f.id }] });
    const [pay] = await tx.insert(payments).values({
      associationId, unitId: f.id, number, amount: p.amount, mode: p.mode, reference: p.reference ?? '', chequeNo: p.chequeNo ?? null, chequeDate: p.chequeDate ?? null,
      chequeStatus: p.mode === 'Cheque' ? 'Pending' : null, receivedOn: on, payerName: p.payerName ?? '', note: p.note ?? '', source: p.source ?? 'office', accountId: into.id, entryId: entry.id,
      createdBy: by.userId, byName: by.name,
    }).returning();
    let left = p.amount;
    const settled: { number: string; amount: number }[] = [];
    for (const b of target) {
      if (!left) break;
      const take = Math.min(left, dueOf(b));
      await tx.insert(paymentAllocations).values({ paymentId: pay!.id, billId: b.id, amount: take });
      await tx.update(bills).set({ paid: b.paid + take }).where(eq(bills.id, b.id));
      settled.push({ number: b.number, amount: take });
      left -= take;
    }
    const members = (await tx.select({ userId: unitMembers.userId }).from(unitMembers).where(and(eq(unitMembers.unitId, f.id), eq(unitMembers.status, 'active')))).map(m => m.userId);
    await notify(tx, members, { kind: 'payments', title: `Payment received · ${rupees(p.amount)}`, body: `Receipt ${number}${left ? ` · ${rupees(left)} kept as advance` : ''}. Thank you.`, href: '/dues/receipt/' + pay!.id });
    return { payment: pay!, unit: f.code, settled, advance: left };
  });
}

/** a bounced cheque, a wrong entry: the receipt is undone and its bills are open again */
export async function reversePayment(db: Tx, paymentId: string, associationId: string, reason: string, by: By) {
  const [p] = await db.select().from(payments).where(and(eq(payments.id, paymentId), eq(payments.associationId, associationId)));
  if (!p) throw notFound('That payment');
  if (p.reversedAt) throw conflict('already_reversed', 'This payment has already been reversed.');
  return db.transaction(async tx => {
    if (p.entryId) await reverse(tx, p.entryId, { memo: `Reversed ${p.number} — ${reason}`, by });
    const allocs = await tx.select().from(paymentAllocations).where(eq(paymentAllocations.paymentId, p.id));
    for (const a of allocs) await tx.update(bills).set({ paid: sql`${bills.paid} - ${a.amount}` }).where(eq(bills.id, a.billId));
    await tx.delete(paymentAllocations).where(eq(paymentAllocations.paymentId, p.id));
    const [u] = await tx.update(payments).set({ reversedAt: new Date(), reverseReason: reason, ...(p.mode === 'Cheque' ? { chequeStatus: 'Bounced' as const } : {}) }).where(eq(payments.id, p.id)).returning();
    return u!;
  });
}

/* ---------- expenses ---------- */
export type Expense = typeof expenses.$inferSelect;
export type ExpenseInput = { payee: string; vendorId?: string | null; accountId: string; amount: number; date?: string; description?: string; billNo?: string; receiptUrl?: string | null; issueInvoiceId?: string | null };

async function nextExpenseNumber(db: Tx, associationId: string) {
  const [{ n }] = (await db.select({ n: sql<number>`coalesce(max(substring(${expenses.number} from 5)::int), 0)` }).from(expenses).where(eq(expenses.associationId, associationId))) as [{ n: number }];
  return 'EXP-' + String(n + 1).padStart(4, '0');
}

/** approve = it becomes a cost and a debt to the vendor */
async function postApproval(db: Tx, e: Expense, by: By) {
  const chart = await chartOf(db, e.associationId);
  const entry = await post(db, { associationId: e.associationId, date: e.date, memo: `${e.number} · ${e.payee}${e.description ? ' · ' + e.description : ''}`, source: 'expense', sourceId: e.id, by,
    lines: [{ accountId: e.accountId, debit: e.amount }, { accountId: byRole(chart, 'payable').id, credit: e.amount, vendorId: e.vendorId }] });
  const [u] = await db.update(expenses).set({ status: 'Approved', entryId: entry.id, decidedByName: by.name, decidedAt: new Date() }).where(eq(expenses.id, e.id)).returning();
  return u!;
}

/** Book an expense. Small ones post at once; anything above the society's limit waits for approval. */
export async function addExpense(db: Tx, associationId: string, x: ExpenseInput, by: By, o: { approved?: boolean; chargeToOwner?: boolean } = {}) {
  const chart = await chartOf(db, associationId);
  const head = chart.find(a => a.id === x.accountId);
  if (!head || (head.kind !== 'expense' && !(o.chargeToOwner && head.role === 'owner_funds'))) throw badRequest('bad_head', 'Choose an expense head.');
  const s = await settingsOf(db, associationId);
  return db.transaction(async tx => {
    const [e] = await tx.insert(expenses).values({ associationId, number: await nextExpenseNumber(tx, associationId), vendorId: x.vendorId ?? null, payee: x.payee, accountId: x.accountId, amount: x.amount,
      date: x.date ?? today(), description: x.description ?? '', billNo: x.billNo ?? '', receiptUrl: x.receiptUrl ?? null, issueInvoiceId: x.issueInvoiceId ?? null, createdBy: by.userId, byName: by.name }).returning();
    // approvalAbove 0 = everything needs a second look; otherwise only the larger ones
    const needsApproval = !o.approved && (s.approvalAbove === 0 || x.amount > s.approvalAbove);
    return needsApproval ? e! : postApproval(tx, e!, by);
  });
}

export async function decideExpense(db: Tx, e: Expense, decision: 'approve' | 'reject', by: By) {
  if (e.status !== 'Pending approval') throw conflict('already_decided', 'This expense has already been decided.');
  if (decision === 'reject') {
    const [u] = await db.update(expenses).set({ status: 'Rejected', decidedByName: by.name, decidedAt: new Date() }).where(eq(expenses.id, e.id)).returning();
    return u!;
  }
  return db.transaction(tx => postApproval(tx, e, by));
}

export async function payExpense(db: Tx, e: Expense, o: { paidOn?: string; accountId?: string; mode: PaymentMode; reference?: string }, by: By) {
  if (e.status !== 'Approved') throw conflict('not_payable', e.status === 'Paid' ? 'This expense is already paid.' : 'Approve the expense before paying it.');
  return db.transaction(async tx => {
    const chart = await chartOf(tx, e.associationId);
    const from = o.accountId ? chart.find(a => a.id === o.accountId && (a.role === 'bank' || a.role === 'cash')) : byRole(chart, o.mode === 'Cash' ? 'cash' : 'bank');
    if (!from) throw badRequest('bad_account', 'Choose the bank or cash account it was paid from.');
    const on = o.paidOn ?? today();
    const entry = await post(tx, { associationId: e.associationId, date: on, memo: `Paid ${e.number} · ${e.payee} · ${o.mode}${o.reference ? ' ' + o.reference : ''}`, source: 'expense_payment', sourceId: e.id, by,
      lines: [{ accountId: byRole(chart, 'payable').id, debit: e.amount, vendorId: e.vendorId }, { accountId: from.id, credit: e.amount }] });
    const [u] = await tx.update(expenses).set({ status: 'Paid', paidOn: on, paidFrom: from.id, paymentMode: o.mode, reference: o.reference ?? '', payEntryId: entry.id }).where(eq(expenses.id, e.id)).returning();
    return u!;
  });
}

