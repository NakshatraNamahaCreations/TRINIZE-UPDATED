import { api } from './api';
import { uploadPhoto } from './live';

/* The Virtual Property Manager's side of the API. A VPM is created by the operator and assigned to
   societies; in each of those they do the society office's job, from the app. */

export type Society = {
  id: string; name: string; short: string; city: string; open: number; fresh: number; emergencies: number; overdue: number;
  /** estimates waiting for a yes, requests resolved in the last 7 days, and the size of the place */
  approvals: number; resolvedWeek: number; homes: number; residents: number;
};
/** a request that needs the manager first, from any of their societies */
export type Attention = { aid: string; society: string; ref: string; title: string; category: string; priority: 'Low' | 'Medium' | 'High' | 'Emergency'; status: Status; slaDueAt: string; overdue: boolean };
export type Status = 'Submitted' | 'Acknowledged' | 'Assigned' | 'In Progress' | 'On Hold' | 'Resolved' | 'Closed';
export type VendorState = 'Assigned' | 'Accepted' | 'Scheduled' | 'Visited' | 'Completed';
export type Ticket = {
  ref: string; title: string; category: string; location: string; priority: 'Low' | 'Medium' | 'High' | 'Emergency'; status: Status;
  reporter: string | null; unit: string | null; vendor: string | null; scope: 'unit' | 'common'; asset: string | null;
  vendorState: VendorState | null; scheduledAt: string | null; costEstimate: number | null; costActual: number | null;
  approval: 'none' | 'pending' | 'approved' | 'rejected'; accessNote: string | null; escalated: boolean; rating: number | null;
  slaDueAt: string; slaState: 'ok' | 'over' | 'met'; createdAt: string;
  timeline: { status: Status; note: string | null; at: string }[];
  updates: { text: string; photoUrl: string | null; at: string }[];
  internalNotes: { text: string; at: string; by: string | null }[];
};
export type Vendor = { id: string; name: string; category: string; phone: string; active: boolean };
export type Message = { id: string; from: 'resident' | 'staff' | 'vendor'; by: string | null; text: string; at: string };
export type Invoice = { id: string; issue: string; vendor: string; amount: number; note: string; status: 'Pending' | 'Approved' | 'Paid' | 'Rejected' };

export const vpmMe = () => api<{ user: { name: string }; societies: Society[]; attention: Attention[] }>('GET', '/v1/vpm/me');
const A = (aid: string) => `/v1/admin/${aid}`;

export const tickets = (aid: string) => api<Ticket[]>('GET', `${A(aid)}/issues`);
export const ticket = (aid: string, ref: string) => api<Ticket>('GET', `${A(aid)}/issues/${ref}`);
export const vendors = async (aid: string) => (await api<Vendor[]>('GET', `${A(aid)}/vendor-list`)).filter(v => v.active);
export const move = (aid: string, ref: string, to: Status, o: { note?: string; vendorId?: string; accessNote?: string } = {}) =>
  api<Ticket>('POST', `${A(aid)}/issues/${ref}/status`, { to, ...o });
export const vendorProgress = (aid: string, ref: string, state: Exclude<VendorState, 'Assigned'>, o: { note?: string; scheduledAt?: string } = {}) =>
  api<Ticket>('POST', `${A(aid)}/issues/${ref}/vendor-progress`, { state, ...o });
export const setEstimate = (aid: string, ref: string, amount: number) => api<Ticket>('PUT', `${A(aid)}/issues/${ref}/estimate`, { amount });
export const decideEstimate = (aid: string, ref: string, decision: 'approved' | 'rejected') => api<Ticket>('POST', `${A(aid)}/issues/${ref}/approval`, { decision });
export const addNote = (aid: string, ref: string, text: string) => api<Ticket>('POST', `${A(aid)}/issues/${ref}/notes`, { text });
export const messages = (aid: string, ref: string) => api<Message[]>('GET', `${A(aid)}/issues/${ref}/messages`);
export const sendMessage = (aid: string, ref: string, text: string) => api<Message[]>('POST', `${A(aid)}/issues/${ref}/messages`, { text });
export const invoicesFor = async (aid: string, ref: string) => (await api<Invoice[]>('GET', `${A(aid)}/invoices`)).filter(i => i.issue === ref);
export async function addInvoice(aid: string, ref: string, amount: number, note: string, photo?: string) {
  const fileUrl = photo ? await uploadPhoto(photo) : undefined;
  return api('POST', `${A(aid)}/issues/${ref}/invoices`, { amount, note, fileUrl });
}
export const setInvoice = (aid: string, id: string, status: 'Approved' | 'Paid' | 'Rejected') => api('POST', `${A(aid)}/invoices/${id}/status`, { status });
export const publishNotice = (aid: string, n: { title: string; body: string; priority: 'High' | 'Normal' }) =>
  api('POST', `${A(aid)}/announcements`, { ...n, requiresAck: n.priority === 'High' });

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** "Thu 19 Nov, 10:00 AM" */
export function when(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}, ${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
}
export const rupees = (n: number) => '₹' + n.toLocaleString('en-IN');
