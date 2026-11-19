import { and, eq, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import {
  accounts, associations, DEFAULT_ACCOUNTING, journalEntries, journalLines, periodLocks,
  type AccountingSettings, type AccountKind, type AccountRole, type ChargeType, type EntrySource,
} from '../db/schema.js';
import { badRequest, conflict } from './http.js';

/* The ledger: the starting chart of accounts, posting balanced entries, and the month lock. */

type Tx = Pick<DB, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;

/** every society starts with these heads; the office can rename them and add its own */
const CHART: [string, string, AccountKind, AccountRole][] = [
  ['1000', 'Bank account', 'asset', 'bank'], ['1010', 'Cash in hand', 'asset', 'cash'], ['1100', 'Dues receivable from flats', 'asset', 'receivable'],
  ['2000', 'Vendor payables', 'liability', 'payable'], ['2100', 'Security deposits held', 'liability', 'deposit'],
  // rent collected on an owner's behalf is owed to the owner, not earned by the society
  ['2200', 'Rent held for owners', 'liability', 'owner_funds'],
  ['3000', 'General fund', 'equity', 'opening'], ['3100', 'Sinking fund', 'equity', 'fund'], ['3200', 'Repair fund', 'equity', 'fund'],
  ['4000', 'Maintenance charges', 'income', null], ['4010', 'Rent', 'income', null], ['4020', 'Parking charges', 'income', null], ['4030', 'Water charges', 'income', null],
  ['4040', 'Electricity charges', 'income', null], ['4050', 'Penalties and late fees', 'income', null], ['4060', 'Other income', 'income', null], ['4070', 'Interest income', 'income', null],
  ['4080', 'Application and screening fees', 'income', null],
  ['5000', 'Repairs and vendor bills', 'expense', null], ['5010', 'Salaries', 'expense', null], ['5020', 'AMC contracts', 'expense', null], ['5030', 'Electricity', 'expense', null],
  ['5040', 'Water', 'expense', null], ['5050', 'Housekeeping', 'expense', null], ['5060', 'Security', 'expense', null], ['5070', 'Audit and legal fees', 'expense', null],
  ['5080', 'Bank charges', 'expense', null], ['5090', 'Discounts and waivers', 'expense', 'waiver'], ['5100', 'Other expenses', 'expense', null],
];
/** which head a charge is billed to */
export const CHARGE_ACCOUNT: Record<ChargeType, string> = {
  'Monthly maintenance': '4000', Rent: '2200', Parking: '4020', Water: '4030', Electricity: '4040', 'Sinking fund': '3100', 'Repair contribution': '3200',
  Penalty: '4050', 'Security deposit': '2100', 'Custom charge': '4060',
};

export type Account = typeof accounts.$inferSelect;

/** The society's chart, created the first time accounting is used. */
export async function chartOf(db: Tx, associationId: string): Promise<Account[]> {
  let rows = await db.select().from(accounts).where(eq(accounts.associationId, associationId)).orderBy(accounts.code);
  // the first time, the whole chart; later, any head a newer version of the system has added
  const missing = CHART.filter(([code]) => !rows.some(r => r.code === code));
  if (missing.length) {
    await db.insert(accounts).values(missing.map(([code, name, kind, role]) => ({ associationId, code, name, kind, role, system: 1 }))).onConflictDoNothing();
    rows = await db.select().from(accounts).where(eq(accounts.associationId, associationId)).orderBy(accounts.code);
  }
  return rows;
}
export const byCode = (chart: Account[], code: string) => {
  const a = chart.find(x => x.code === code);
  if (!a) throw badRequest('no_account', `Account ${code} is missing from the chart.`);
  return a;
};
export const byRole = (chart: Account[], role: NonNullable<AccountRole>) => {
  const a = chart.find(x => x.role === role);
  if (!a) throw badRequest('no_account', `The chart has no ${role} account.`);
  return a;
};

export async function settingsOf(db: Tx, associationId: string): Promise<AccountingSettings> {
  const [a] = await db.select({ s: associations.accounting }).from(associations).where(eq(associations.id, associationId));
  return { ...DEFAULT_ACCOUNTING, ...a?.s, lateFee: { ...DEFAULT_ACCOUNTING.lateFee, ...a?.s?.lateFee } };
}

/* ---------- dates ---------- */
/** today in India, as "2026-11-17" */
export const today = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
export const periodOf = (ymd: string) => ymd.slice(0, 7);
export const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

export async function assertOpen(db: Tx, associationId: string, ymd: string) {
  const [lock] = await db.select().from(periodLocks).where(and(eq(periodLocks.associationId, associationId), eq(periodLocks.period, periodOf(ymd))));
  if (lock) throw conflict('period_locked', `${monthName(periodOf(ymd))} is closed (locked by ${lock.byName}). Reopen the month to change it.`);
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthName = (period: string) => `${MONTHS[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;

/* ---------- posting ---------- */
export type Line = { accountId: string; debit?: number; credit?: number; unitId?: string | null; vendorId?: string | null };

/** Post one balanced entry. Debits must equal credits, and the month must be open. */
export async function post(db: Tx, o: {
  associationId: string; date: string; memo: string; source: EntrySource; sourceId?: string | null; lines: Line[];
  by?: { userId: string | null; name: string }; reverses?: string | null;
}) {
  const lines = o.lines.filter(l => (l.debit ?? 0) !== 0 || (l.credit ?? 0) !== 0);
  const dr = lines.reduce((n, l) => n + (l.debit ?? 0), 0), cr = lines.reduce((n, l) => n + (l.credit ?? 0), 0);
  if (!lines.length || dr !== cr) throw badRequest('unbalanced', `Debits (₹${dr}) and credits (₹${cr}) must be equal.`);
  if (lines.some(l => (l.debit ?? 0) < 0 || (l.credit ?? 0) < 0)) throw badRequest('negative', 'Amounts can’t be negative.');
  await assertOpen(db, o.associationId, o.date);
  const [{ next }] = (await db.select({ next: sql<number>`coalesce(max(${journalEntries.number}), 1000) + 1` }).from(journalEntries).where(eq(journalEntries.associationId, o.associationId))) as [{ next: number }];
  const [e] = await db.insert(journalEntries).values({
    associationId: o.associationId, number: next, date: o.date, memo: o.memo, source: o.source, sourceId: o.sourceId ?? null, reverses: o.reverses ?? null,
    createdBy: o.by?.userId ?? null, byName: o.by?.name ?? 'System',
  }).returning();
  await db.insert(journalLines).values(lines.map(l => ({ entryId: e!.id, accountId: l.accountId, debit: l.debit ?? 0, credit: l.credit ?? 0, unitId: l.unitId ?? null, vendorId: l.vendorId ?? null })));
  return e!;
}

/** Undo an entry with its mirror image, dated today (or on `date`). The original stays in the books. */
export async function reverse(db: Tx, entryId: string, o: { date?: string; memo: string; by?: { userId: string | null; name: string } }) {
  const [e] = await db.select().from(journalEntries).where(eq(journalEntries.id, entryId));
  if (!e) throw badRequest('no_entry', 'That entry no longer exists.');
  if (e.reversedBy) throw conflict('already_reversed', 'That entry has already been reversed.');
  await assertOpen(db, e.associationId, e.date); // the month being corrected must be open too
  const lines = await db.select().from(journalLines).where(eq(journalLines.entryId, entryId));
  const r = await post(db, {
    associationId: e.associationId, date: o.date ?? today(), memo: o.memo, source: 'reversal', sourceId: e.sourceId, reverses: e.id, by: o.by,
    lines: lines.map(l => ({ accountId: l.accountId, debit: l.credit, credit: l.debit, unitId: l.unitId, vendorId: l.vendorId })),
  });
  await db.update(journalEntries).set({ reversedBy: r.id }).where(eq(journalEntries.id, entryId));
  return r;
}

/** balance of every account up to and including `asOf` (debit-positive), optionally from `from` */
export async function balances(db: Tx, associationId: string, o: { from?: string; to?: string } = {}) {
  const rows = ((await db.execute(sql`
    select a.id, a.code, a.name, a.kind, a.role, coalesce(sum(l.debit), 0)::int as debit, coalesce(sum(l.credit), 0)::int as credit
    from accounts a
    left join journal_lines l on l.account_id = a.id
      and exists (select 1 from journal_entries e where e.id = l.entry_id
        and (${o.from ?? null}::date is null or e.date >= ${o.from ?? null}::date) and (${o.to ?? null}::date is null or e.date <= ${o.to ?? null}::date))
    where a.association_id = ${associationId} group by a.id order by a.code`)) as unknown as { rows: { id: string; code: string; name: string; kind: AccountKind; role: AccountRole; debit: number; credit: number }[] }).rows;
  // income, liabilities and funds are "credit-natured": show them as positive when in credit
  return rows.map(r => ({ ...r, balance: r.kind === 'asset' || r.kind === 'expense' ? r.debit - r.credit : r.credit - r.debit }));
}
