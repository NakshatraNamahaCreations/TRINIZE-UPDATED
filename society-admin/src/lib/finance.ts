import { accessToken, api, API_URL, upload } from './api';
import { association } from './live';

/* Accounting, from the office: billing, payments, expenses, the bank statement and the reports.
   Everything posts to one ledger on the server; this file only asks and shows. Connected mode only. */

const F = () => `/v1/admin/${association()}/finance`;

export const CHARGE_TYPES = ['Monthly maintenance', 'Rent', 'Parking', 'Water', 'Electricity', 'Sinking fund', 'Repair contribution', 'Penalty', 'Security deposit', 'Custom charge'] as const;
export const PAYMENT_MODES = ['UPI', 'Payment gateway', 'Bank transfer', 'Cash', 'Cheque', 'Card'] as const;
export type Dashboard = {
  month: string; collected: number; pendingDues: number; flatsWithDues: number; advances: number; overdue: number; overdueBills: number;
  income: { name: string; amount: number }[]; expenses: { name: string; amount: number }[]; bank: number; cash: number;
  cashFlow: { month: string; money_in: number; money_out: number }[]; reconciliation: { unmatched: number; matched: number };
  toApprove: { n: number; amount: number }; toPay: { n: number; amount: number };
  /** this month's bills: how many, what was asked for (after waivers) and how much of it has been paid */
  flats: number; billsThisMonth: number; billedThisMonth: number; paidOfBilled: number;
  topDues: { unitId: string; unit: string; amount: number }[];
  recentPayments: { id: string; number: string; unit: string; amount: number; mode: string; receivedOn: string }[];
};
export type Account = { id: string; code: string; name: string; kind: 'asset' | 'liability' | 'equity' | 'income' | 'expense'; role: string | null; balance: number };
export type Settings = { allowPartial: boolean; lateFee: { kind: 'none' | 'flat' | 'percent'; value: number; graceDays: number }; approvalAbove: number; upiId: string; bankDetails: string };
export type Flat = { id: string; code: string; tower: string; area: number; flatType: string; balance: number; owner: string | null };
export type Bill = { id: string; number: string; unitId: string; unit?: string; period: string; chargeType: string; description: string; amount: number; paid: number; waived: number; due: number; dueDate: string; status: string };
export type Run = { period: string; chargeType: string; method: 'flat' | 'sqft' | 'type' | 'custom'; dueDate: string; amount?: number; rate?: number; byType?: Record<string, number>; byUnit?: Record<string, number> };
export type Preview = { rows: { unitId: string; unit: string; area: number; flatType: string; amount: number; skip: string | null }[]; bills: number; total: number };
export type Payment = { id: string; number: string; unit: string; amount: number; mode: string; reference: string; chequeNo: string | null; chequeStatus: string | null; receivedOn: string; payerName: string; source: string; byName: string; reversed: boolean; reverseReason: string | null };
export type Receipt = Payment & { unitLabel: string; society: string; depositedTo: string; note: string; settled: { number: string; chargeType: string; period: string; amount: number }[]; advance: number };
export type Ledger = { unit: string; label: string; opening: number; closing: number; lines: { date: string; ref: string; what: string; kind: string; charge: number; payment: number; balance: number }[] };
export type Expense = { id: string; number: string; payee: string; head: string; accountId: string; amount: number; date: string; description: string; billNo: string; receiptUrl: string | null; status: 'Pending approval' | 'Approved' | 'Paid' | 'Rejected';
  decidedByName: string | null; paidOn: string | null; paymentMode: string | null; reference: string; byName: string; fromMaintenance: boolean };
export type Entry = { id: string; ref: string; date: string; memo: string; source: string; byName: string; reversed: boolean; isReversal: boolean; lines: { account: string; code: string; debit: number; credit: number; unit: string | null }[] };
export type BankLine = { id: string; date: string; description: string; reference: string; moneyOut: number; moneyIn: number; balance: number | null; status: 'Unmatched' | 'Matched' | 'Ignored'; matchedHow: string | null; matchedTo: string | null;
  suggestions: { type: 'payment' | 'expense'; id: string; label: string }[] };
export type Month = { period: string; name: string; entries: number; unmatched: number; locked: boolean; lockedBy: string | null };
export type Report = { name: string; title: string; from: string; to: string; head: string[]; rows: (string | number | null)[][] } & Record<string, unknown>;
export const REPORTS = [
  ['collection', 'Collection'], ['defaulters', 'Pending dues'], ['income', 'Income'], ['expense', 'Expenses'], ['vendors', 'Vendor payments'], ['pnl', 'Income & expenditure'],
  ['balance-sheet', 'Balance sheet'], ['cash-flow', 'Cash flow'], ['trial-balance', 'Trial balance'], ['reconciliation', 'Bank reconciliation'], ['daybook', 'Day book (for Tally / auditor)'], ['audit', 'Audit trail'],
] as const;

export const dashboard = () => api<Dashboard>('GET', `${F()}/dashboard`);
export const accounts = () => api<Account[]>('GET', `${F()}/accounts`);
export const renameAccount = (id: string, name: string) => api<Account>('PUT', `${F()}/accounts/${id}`, { name });
export const addAccount = (a: { code: string; name: string; kind: Account['kind']; bank?: boolean }) => api<Account>('POST', `${F()}/accounts`, a);
export const settings = () => api<Settings>('GET', `${F()}/settings`);
export const saveSettings = (s: Partial<Settings>) => api<Settings>('PUT', `${F()}/settings`, s);
export const flats = () => api<Flat[]>('GET', `${F()}/units`);
export const saveFlat = (id: string, f: { area?: number; flatType?: string }) => api('PUT', `${F()}/units/${id}`, f);
export const setOpening = (id: string, amount: number) => api('POST', `${F()}/units/${id}/opening`, { amount });
export const preview = (r: Run) => api<Preview>('POST', `${F()}/bills/preview`, r);
export const runBills = (r: Run & { tell: boolean }) => api<{ bills: number; total: number; skipped: { unit: string; why: string }[]; residentsTold: number }>('POST', `${F()}/bills/run`, r);
export const billOne = (b: { unitId: string; chargeType: string; amount: number; dueDate: string; description?: string }) => api<Bill>('POST', `${F()}/bills`, b);
export const bills = (f: { period?: string; status?: string; unitId?: string }) => api<Bill[]>('GET', `${F()}/bills?` + new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]));
export const waive = (id: string, amount: number, reason: string) => api<Bill>('POST', `${F()}/bills/${id}/waive`, { amount, reason });
export const cancelBill = (id: string, reason: string) => api<Bill>('POST', `${F()}/bills/${id}/cancel`, { reason });
export const lateFees = () => api<{ charged: number; total: number }>('POST', `${F()}/late-fees/run`);
export const remind = () => api<{ flats: number; residents: number }>('POST', `${F()}/reminders`);
export const pay = (p: { unitId: string; amount: number; mode: string; reference?: string; chequeNo?: string; chequeDate?: string; receivedOn?: string; payerName?: string; note?: string }) => api<Receipt>('POST', `${F()}/payments`, p);
export const payments = () => api<Payment[]>('GET', `${F()}/payments`);
export const receipt = (id: string) => api<Receipt>('GET', `${F()}/payments/${id}`);
export const reversePayment = (id: string, reason: string) => api<Receipt>('POST', `${F()}/payments/${id}/reverse`, { reason });
export const cheque = (id: string, status: 'Cleared' | 'Bounced') => api<Receipt>('POST', `${F()}/payments/${id}/cheque`, { status });
export const ledger = (unitId: string) => api<Ledger>('GET', `${F()}/ledger/${unitId}`);
export const expenses = () => api<Expense[]>('GET', `${F()}/expenses`);
export const addExpense = (e: { payee: string; accountId: string; amount: number; date?: string; description?: string; billNo?: string; receiptUrl?: string; paid?: { mode: string } }) => api<Expense>('POST', `${F()}/expenses`, e);
export const decideExpense = (id: string, decision: 'approve' | 'reject') => api<Expense>('POST', `${F()}/expenses/${id}/decision`, { decision });
export const payExpense = (id: string, mode: string, reference?: string) => api<Expense>('POST', `${F()}/expenses/${id}/pay`, { mode, reference });
export const journal = () => api<Entry[]>('GET', `${F()}/journal`);
export const postJournal = (j: { date: string; memo: string; lines: { accountId: string; debit: number; credit: number }[] }) => api<Entry>('POST', `${F()}/journal`, j);
export const reverseEntry = (id: string, reason: string) => api('POST', `${F()}/journal/${id}/reverse`, { reason });
export const importBank = (csv: string) => api<{ read: number; imported: number; duplicates: number; matched: number; unmatched: number }>('POST', `${F()}/bank/import`, { csv });
export const bank = (status?: string) => api<BankLine[]>('GET', `${F()}/bank${status ? '?status=' + status : ''}`);
export const matchLine = (id: string, type: 'payment' | 'expense', target: string) => api('POST', `${F()}/bank/${id}/match`, { type, id: target });
export const unmatchLine = (id: string) => api('POST', `${F()}/bank/${id}/unmatch`);
export const categorize = (id: string, accountId: string) => api('POST', `${F()}/bank/${id}/categorize`, { accountId });
export const ignoreLine = (id: string) => api('POST', `${F()}/bank/${id}/ignore`);
export const months = () => api<Month[]>('GET', `${F()}/periods`);
export const lockMonth = (period: string) => api('POST', `${F()}/periods/${period}/lock`);
export const unlockMonth = (period: string) => api('DELETE', `${F()}/periods/${period}/lock`);
export const report = (name: string, from?: string, to?: string) => api<Report>('GET', `${F()}/reports/${name}?` + new URLSearchParams(Object.entries({ from, to }).filter(([, v]) => v) as [string, string][]));
export const auditors = () => api<{ id: string; name: string; email: string }[]>('GET', `${F()}/auditors`);
export const addAuditor = (a: { name: string; email: string; password: string }) => api('POST', `${F()}/auditors`, a);
export const removeAuditor = (id: string) => api('DELETE', `${F()}/auditors/${id}`);
export const attach = (f: File) => upload(f);

/** Reports and ledgers download as a spreadsheet file; the request carries the sign-in, so it is fetched and then saved. */
export async function download(path: string, filename: string) {
  await api('GET', `${F()}/settings`); // refreshes an expired sign-in first
  const res = await fetch(`${API_URL}${F()}${path}`, { headers: { authorization: 'Bearer ' + accessToken() } });
  if (!res.ok) throw new Error('The file couldn’t be prepared.');
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

export const rupees = (n: number) => (n < 0 ? '−' : '') + '₹' + Math.abs(n).toLocaleString('en-IN');
export const thisMonth = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 7);
export const inDays = (n: number) => new Date(Date.now() + 5.5 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
