import { api, API_URL, currentAccess } from './api';

/* The owner portal: what my flats earned and cost, the repairs on them, and the documents the society
   shared. Read-only apart from approving a repair estimate and leaving a note. Connected mode only. */

export type Access = { enabled: boolean; reports: { statement: boolean; transactions: boolean; expenses: boolean; societyAccounts: boolean }; showRequests: boolean; showMessages: boolean; showCosts: boolean; approveAbove: number };
export type Property = { unitId: string; unit: string; label: string; associationId: string; society: string; occupancy: 'Owner-occupied' | 'Rented' | 'Vacant'; monthlyRent: number; leaseEnd: string | null; tenant: string | null; access: Access };
export type FlatFigures = { unitId: string; unit: string; society: string; occupancy: string; rentBilled: number; rentCollected: number; rentPending: number; chargesBilled: number; chargesPaid: number; chargesPending: number;
  repairs: number; repairsDeducted: number; net: number; paidOut: number; heldForOwner: number };
export type Dashboard = {
  month: string; flats: number; income: number; expenses: number; repairs: number; net: number; pendingRent: number; societyChargesPending: number; upcomingPayout: number;
  occupancy: { rented: number; ownerOccupied: number; vacant: number }; openRequests: number; approvalsWaiting: number; leaseExpiring: { unit: string; leaseEnd: string }[];
  latestDocuments: { id: string; title: string; kind: string; createdAt: string }[]; summary: string; byFlat: FlatFigures[];
};
export type Statement = { from: string; to: string; flats: FlatFigures[]; totals: Record<string, number> };
export type Txn = { date: string; unit: string; kind: 'bill' | 'payment' | 'repair' | 'payout'; what: string; ref: string; moneyIn: number; moneyOut: number; billed: number; status: string };
export type Request = { ref: string; unit: string; title: string; category: string; priority: string; status: string; vendor: string | null; createdAt: string; costEstimate?: number | null; costActual?: number | null;
  ownerApproval: 'none' | 'pending' | 'approved' | 'rejected'; canApprove: boolean };
export type RequestDetail = Request & { location: string; invoices: { amount: number; status: string; note: string; fileUrl: string | null; at: string }[]; messages: { from: string; text: string; at: string }[] | null };
export type Doc = { id: string; title: string; kind: string; fileUrl: string; unit: string | null; society: string; createdAt: string };

const q = (o: Record<string, string | undefined>) => { const s = new URLSearchParams(Object.entries(o).filter(([, v]) => v) as [string, string][]).toString(); return s ? '?' + s : ''; };

/** someone the office has approved for one of my flats — the outcome and the lease, never their documents */
export const me = () => api<{ name: string; properties: Property[] }>('GET', '/v1/owner/me');
export const dashboard = (unitId?: string) => api<Dashboard>('GET', '/v1/owner/dashboard' + q({ unitId }));
export const statement = (o: { unitId?: string; from?: string; to?: string }) => api<Statement>('GET', '/v1/owner/statement' + q(o));
export const transactions = (o: { unitId?: string; from?: string; to?: string }) => api<{ rows: Txn[] }>('GET', '/v1/owner/transactions' + q(o));
export const requests = (unitId?: string) => api<Request[]>('GET', '/v1/owner/requests' + q({ unitId }));
export const request = (ref: string) => api<RequestDetail>('GET', '/v1/owner/requests/' + ref);
export const decide = (ref: string, decision: 'approved' | 'rejected', note?: string) => api<Request>('POST', `/v1/owner/requests/${ref}/approval`, { decision, note });
export const comment = (ref: string, text: string) => api('POST', `/v1/owner/requests/${ref}/comment`, { text });
export const documents = () => api<Doc[]>('GET', '/v1/owner/documents');
export const opened = (id: string) => api('POST', `/v1/owner/documents/${id}/opened`).catch(() => {});

/** the statement as spreadsheet text, for sharing with an accountant */
export async function statementCsv(o: { unitId?: string; from?: string; to?: string }) {
  await me(); // refreshes an expired sign-in before the plain fetch below
  const res = await fetch(API_URL + '/v1/owner/statement' + q({ ...o, format: 'csv' }), { headers: { authorization: 'Bearer ' + currentAccess() } });
  if (!res.ok) throw new Error('export failed');
  return (await res.text()).replace(/^﻿/, '');
}

export const rupees = (n: number) => (n < 0 ? '− ' : '') + '₹' + Math.abs(n).toLocaleString('en-IN');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const nice = (s: string) => `${Number(s.slice(8, 10))} ${MON[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}`;
const ymd = (d: Date) => new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
/** the periods an owner asks for: this month, last month, this quarter, the financial year so far */
export function periodOf(k: 'month' | 'last' | 'quarter' | 'year'): { from: string; to: string } {
  const now = new Date(Date.now() + 5.5 * 3600e3), y = now.getUTCFullYear(), m = now.getUTCMonth();
  const first = (yy: number, mm: number) => ymd(new Date(Date.UTC(yy, mm, 1) - 5.5 * 3600e3)), last = (yy: number, mm: number) => ymd(new Date(Date.UTC(yy, mm + 1, 0) - 5.5 * 3600e3));
  if (k === 'month') return { from: first(y, m), to: ymd(new Date()) };
  if (k === 'last') return { from: first(y, m - 1), to: last(y, m - 1) };
  if (k === 'quarter') return { from: first(y, m - (m % 3)), to: ymd(new Date()) };
  return { from: first(m < 3 ? y - 1 : y, 3), to: ymd(new Date()) };
}
