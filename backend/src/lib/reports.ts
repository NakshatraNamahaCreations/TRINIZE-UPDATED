import { sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import type { Ai } from './ai.js';
import { rupees, unitBalances } from './finance.js';
import { balances, chartOf, monthName, today } from './ledger.js';
import { maintenanceReport } from './maintenance.js';

/* The monthly report the staff assistant writes: figures worked out from the books and the tickets,
   with a paragraph on top — written by a model when one is connected, by rule when not. */

type Reader = Pick<DB, 'select' | 'execute' | 'insert'>;
const rowsOf = async <T>(db: Pick<DB, 'execute'>, q: ReturnType<typeof sql>) => ((await db.execute(q)) as unknown as { rows: T[] }).rows;
const lastDay = (period: string) => new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).toISOString().slice(0, 10);
export const isPeriod = (s: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
/** the month before, as YYYY-MM */
export const prevPeriod = (period: string, back = 1) => { const d = new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)) - 1 - back, 1)); return d.toISOString().slice(0, 7); };

export async function monthlyReport(db: Reader, ai: Ai, associationId: string, period: string, o: { narrative?: boolean } = {}) {
  const from = period + '-01', to = lastDay(period);
  await chartOf(db as DB, associationId);
  const month = await balances(db as DB, associationId, { from, to });
  const income = month.filter(a => a.kind === 'income' && a.balance).map(a => ({ name: a.name, amount: a.balance }));
  const expenses = month.filter(a => a.kind === 'expense' && a.balance).map(a => ({ name: a.name, amount: a.balance })).sort((a, b) => b.amount - a.amount);
  const sum = (xs: { amount: number }[]) => xs.reduce((n, x) => n + x.amount, 0);

  const byMode = await rowsOf<{ mode: string; n: number; amount: number }>(db, sql`
    select mode, count(*)::int n, coalesce(sum(amount), 0)::int amount from payments
    where association_id = ${associationId} and reversed_at is null and received_on >= ${from}::date and received_on <= ${to}::date group by mode order by amount desc`);
  const [billed] = await rowsOf<{ billed: number; settled: number; bills: number }>(db, sql`
    select coalesce(sum(amount), 0)::int billed, coalesce(sum(paid + waived), 0)::int settled, count(*)::int bills
    from bills where association_id = ${associationId} and period = ${period} and cancelled_at is null`);
  const due = [...(await unitBalances(db as DB, associationId, to)).values()].filter(n => n > 0);
  const [flow] = await rowsOf<{ money_in: number; money_out: number }>(db, sql`
    select coalesce(sum(l.debit), 0)::int money_in, coalesce(sum(l.credit), 0)::int money_out
    from journal_lines l join journal_entries e on e.id = l.entry_id join accounts a on a.id = l.account_id
    where e.association_id = ${associationId} and a.role in ('bank', 'cash') and e.date >= ${from}::date and e.date <= ${to}::date`);
  const occupancy = await rowsOf<{ occupancy: string; n: number }>(db, sql`select occupancy, count(*)::int n from units where association_id = ${associationId} group by occupancy order by n desc`);
  const m = await maintenanceReport(db, associationId, new Date(from + 'T00:00:00+05:30'), new Date(to + 'T23:59:59+05:30'));

  const flats = occupancy.reduce((n, x) => n + x.n, 0), vacant = occupancy.find(x => x.occupancy === 'Vacant')?.n ?? 0;
  const r = {
    period, month: monthName(period), from, to,
    income: { total: sum(income), heads: income }, expense: { total: sum(expenses), heads: expenses }, net: sum(income) - sum(expenses),
    collection: { collected: sum(byMode), byMode, billed: billed!.billed, settled: billed!.settled, bills: billed!.bills, rate: billed!.billed ? Math.round((billed!.settled / billed!.billed) * 100) : null },
    pendingDues: { amount: due.reduce((a, n) => a + n, 0), flats: due.length },
    maintenance: { ...m.totals, cost: m.expenseByCategory.reduce((n, x) => n + x.amount, 0), byCategory: m.byCategory, costByCategory: m.expenseByCategory },
    vendors: m.byVendor,
    occupancy: { flats, occupied: flats - vacant, rate: flats ? Math.round(((flats - vacant) / flats) * 100) : null, byKind: occupancy },
    cashFlow: { moneyIn: flow!.money_in, moneyOut: flow!.money_out, net: flow!.money_in - flow!.money_out },
  };
  const rule = `${r.month}: ${rupees(r.collection.collected)} collected${r.collection.rate !== null ? ` (${r.collection.rate}% of the month's ${rupees(r.collection.billed)} billed is settled)` : ''}; income ${rupees(r.income.total)}, expenses ${rupees(r.expense.total)}, net ${rupees(r.net)}. `
    + `${rupees(r.pendingDues.amount)} is still owed by ${r.pendingDues.flats} flat${r.pendingDues.flats === 1 ? '' : 's'}. `
    + `Maintenance: ${r.maintenance.total} request${r.maintenance.total === 1 ? '' : 's'} received, ${r.maintenance.completed} completed, ${r.maintenance.open} open, ${r.maintenance.emergency} emergency; repairs cost ${rupees(r.maintenance.cost)}. `
    + (r.expense.heads[0] ? `Largest expense: ${r.expense.heads[0].name} (${rupees(r.expense.heads[0].amount)}). ` : '')
    + (r.occupancy.rate !== null ? `Occupancy ${r.occupancy.rate}%.` : '');
  let summary = rule, summaryBy: 'ai' | 'rules' = 'rules';
  if (o.narrative !== false && ai.enabled) {
    const text = await ai.compose(
      'You write the summary of a housing society\'s monthly report for its managing committee in India. Four to six plain sentences, no markdown, rupee amounts as given. Say how the month went, what stands out, and what the committee should look at. Use only the figures given; never invent a number or a cause.',
      JSON.stringify(r));
    if (text) { summary = text; summaryBy = 'ai'; }
  }
  return { ...r, summary, summaryBy };
}
