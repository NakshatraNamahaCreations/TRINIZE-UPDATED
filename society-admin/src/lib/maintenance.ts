import { api } from './api';
import { association } from './live';

/* The work-order side of the API for the console: estimates and approvals, the two conversations inside
   a ticket, vendors, invoices and the maintenance report. Connected mode only. */

const A = () => `/v1/admin/${association()}`;

export type WorkOrder = {
  ref: string; status: string; priority: string; scope: 'unit' | 'common'; asset: string | null;
  vendor: string | null; vendorState: 'Assigned' | 'Accepted' | 'Scheduled' | 'Visited' | 'Completed' | null;
  scheduledAt: string | null; dueAt: string | null; costEstimate: number | null; costActual: number | null;
  approval: 'none' | 'pending' | 'approved' | 'rejected'; accessNote: string | null; escalated: boolean; rating: number | null;
};
export type Msg = { id: string; from: 'resident' | 'staff' | 'vendor'; by: string | null; text: string; at: string };
export type Vendor = { id: string; name: string; category: string; contact: string; phone: string; email: string; serviceArea: string; active: boolean; openJobs: number; rating: number | null };
export type Invoice = { id: string; issue: string; title: string; vendor: string; amount: number; fileUrl: string | null; note: string; status: 'Pending' | 'Approved' | 'Paid' | 'Rejected'; createdAt: string };
export type Report = {
  totals: { total: number; open: number; completed: number; emergency: number; on_hold: number; sla_met: number; sla_missed: number };
  byCategory: { category: string; total: number; open: number }[];
  byPlace: { place: string; total: number }[];
  byVendor: { vendor: string; jobs: number; completed: number; avg_hours: number | null; rating: number | null; spent: number }[];
  expenseByCategory: { category: string; amount: number }[];
};

export const workOrder = (ref: string) => api<WorkOrder>('GET', `${A()}/issues/${ref}`);
/** the conversation with the resident */
export const threads = (ref: string) => api<Msg[]>('GET', `${A()}/issues/${ref}/messages`);
export const sendMessage = (ref: string, text: string) => api<Msg[]>('POST', `${A()}/issues/${ref}/messages`, { text });
/** vendors don't use the app: the manager records where the vendor is with the job */
export const vendorProgress = (ref: string, state: 'Accepted' | 'Scheduled' | 'Visited' | 'Completed', o: { note?: string; scheduledAt?: string } = {}) =>
  api<WorkOrder>('POST', `${A()}/issues/${ref}/vendor-progress`, { state, ...o });
export const recordInvoice = (ref: string, amount: number, note: string) => api('POST', `${A()}/issues/${ref}/invoices`, { amount, note });
export const setEstimate = (ref: string, amount: number) => api<WorkOrder>('PUT', `${A()}/issues/${ref}/estimate`, { amount });
export const decideEstimate = (ref: string, decision: 'approved' | 'rejected') => api<WorkOrder>('POST', `${A()}/issues/${ref}/approval`, { decision });
export const moveTo = (ref: string, to: string, note?: string) => api<WorkOrder>('POST', `${A()}/issues/${ref}/status`, { to, note });

export const vendorList = () => api<Vendor[]>('GET', `${A()}/vendor-list`);
export const addVendor = (v: { name: string; category: string; contact: string; phone: string; serviceArea: string }) => api<Vendor>('POST', `${A()}/vendor-list`, v);
export const saveVendor = (id: string, v: Partial<Pick<Vendor, 'name' | 'category' | 'contact' | 'phone' | 'email' | 'serviceArea'>>) => api<Vendor>('PUT', `${A()}/vendor-list/${id}`, v);
export const setVendorActive = (id: string, active: boolean) => api('PUT', `${A()}/vendor-list/${id}`, { active });
export const invoiceList = () => api<Invoice[]>('GET', `${A()}/invoices`);
export const setInvoice = (id: string, status: 'Approved' | 'Paid' | 'Rejected') => api('POST', `${A()}/invoices/${id}/status`, { status });
export const report = () => api<Report>('GET', `${A()}/reports/maintenance`);
export const logRequest = (r: { title: string; category: string; location: string; priority: string; asset?: string }) =>
  api<{ ref: string }>('POST', `${A()}/issues`, { ...r, scope: 'common' });

export const rupees = (n: number) => '₹' + n.toLocaleString('en-IN');
export function when(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}
