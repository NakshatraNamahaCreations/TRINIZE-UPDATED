import { api } from './api';
import { uploadPhoto } from './live';

/* The Virtual Property Manager's side of the API. A VPM is created by the operator and assigned to
   societies; in each of those they do the society office's job, from the app. */

export type Society = {
  id: string; name: string; short: string; city: string; open: number; fresh: number; emergencies: number; overdue: number;
  /** estimates waiting for a yes, requests resolved in the last 7 days, and the size of the place */
  approvals: number; resolvedWeek: number; homes: number; residents: number;
  /** residents' unread messages, and requests for the on-site visit waiting for an answer */
  unread?: number; visitRequests?: number;
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

/* ---------- the weekly on-site visit ---------- */
export type SiteKind = 'Inspection' | 'Meeting' | 'Follow-up' | 'Request';
export type SiteItem = {
  id: string; date: string | null; time: string | null; title: string; location: string; kind: SiteKind; status: 'Requested' | 'Scheduled' | 'Done' | 'Declined';
  extra: boolean; note: string; reply: string; ref: string | null; issueStatus: Status | null; resident: { name: string; unit: string | null } | null; createdAt: string;
};
export type SiteDay = { id: string | null; date: string; start: string; end: string; status: 'Planned' | 'Done' | 'Cancelled'; note: string; startsAt: string; items: SiteItem[] };
export type SitePlan = { weekday: number; start: string; end: string };
export type SiteBoard = { plan: SitePlan | null; today: string; days: SiteDay[]; requests: SiteItem[] };

const SV = (aid: string) => `${A(aid)}/site-visits`;
export const siteBoard = (aid: string) => api<SiteBoard>('GET', `${SV(aid)}?days=21`);
export const savePlan = (aid: string, p: SitePlan) => api<SitePlan>('PUT', `${SV(aid)}/plan`, p);
export const setDay = (aid: string, date: string, o: { status?: 'Planned' | 'Done' | 'Cancelled'; note?: string; start?: string; end?: string }) => api('PUT', `${SV(aid)}/days/${date}`, o);
export const addSiteItem = (aid: string, o: { date: string; time?: string; title: string; location?: string; kind: Exclude<SiteKind, 'Request'> }) => api<SiteItem>('POST', `${SV(aid)}/items`, o);
export const updateSiteItem = (aid: string, id: string, o: { status?: 'Scheduled' | 'Done' | 'Declined'; date?: string; time?: string | null; reply?: string }) => api<SiteItem>('PUT', `${SV(aid)}/items/${id}`, o);
export const removeSiteItem = (aid: string, id: string) => api('DELETE', `${SV(aid)}/items/${id}`);

/* ---------- residents' messages to the office ---------- */
export type Convo = { id: string; subject: string; topic: string; status: 'Open' | 'Closed'; lastMessageAt: string; preview: string; lastFrom: 'resident' | 'staff' | null; unread: number; resident: string; unit: string | null };
export type ConvoMsg = { id: string; from: 'resident' | 'staff'; by: string; text: string; attachmentUrl: string | null; at: string; readAt: string | null };
export const inbox = (aid: string) => api<Convo[]>('GET', `${A(aid)}/conversations`);
export const convo = (aid: string, id: string) => api<Convo & { messages: ConvoMsg[] }>('GET', `${A(aid)}/conversations/${id}`);
export const replyConvo = (aid: string, id: string, text: string) => api<Convo & { messages: ConvoMsg[] }>('POST', `${A(aid)}/conversations/${id}/messages`, { text });
export const setConvoStatus = (aid: string, id: string, status: 'Open' | 'Closed') => api<Convo & { messages: ConvoMsg[] }>('POST', `${A(aid)}/conversations/${id}/status`, { status });

/* ---------- the society dashboard ---------- */
export type OpsStats = {
  totals: { all: number; week: number; prevWeek: number };
  timeline: { date: string; created: number; resolved: number }[];
  categories: { category: string; n: number }[];
  resolution: { hours: number | null; prevHours: number | null; resolved: number };
  satisfaction: { avg: number | null; count: number; dist: { star: number; n: number }[] };
  buckets: { open: number; inProgress: number; pendingVendor: number; resolved: number };
  vendors: { id: string; name: string; category: string; open: number; inProgress: number; completed: number }[];
};
export const opsStats = (aid: string) => api<OpsStats>('GET', `${A(aid)}/stats/operations`);

/** the staff assistant: a question answered from the society's records, with the rows it used */
export type AiCard = { key: string; title: string; headline: string; columns: string[]; rows: string[][] };
export const askAssistant = (aid: string, text: string) => api<{ text: string; cards: AiCard[]; refused?: boolean }>('POST', `${A(aid)}/assistant/ask`, { text });
export const draftNotice = (aid: string, details: string) => api<{ title: string; body: string }>('POST', `${A(aid)}/assistant/draft`, { kind: 'Maintenance notice', details });

export const addVendor = (aid: string, v: { name: string; category: string; phone: string }) => api<Vendor>('POST', `${A(aid)}/vendor-list`, v);

/** my own to-do notes for this society */
export type Note = { id: string; text: string; done: boolean; createdAt: string };
export const notes = (aid: string) => api<Note[]>('GET', `${A(aid)}/my-notes`);
export const addMyNote = (aid: string, text: string) => api<Note>('POST', `${A(aid)}/my-notes`, { text });
export const setNote = (aid: string, id: string, done: boolean) => api<Note>('PUT', `${A(aid)}/my-notes/${id}`, { done });
export const removeNote = (aid: string, id: string) => api('DELETE', `${A(aid)}/my-notes/${id}`);

/** a message to every resident, on the channels chosen (the app's notice board, its alert, email), with how it went */
export type BroadcastResult = { ref: string; stats: { recipients: number; reached: number; logged: number; skipped: number; failed: number } };
export const broadcast = (aid: string, m: { title: string; body: string; channels: ('portal' | 'push' | 'email')[]; important: boolean }) =>
  api<BroadcastResult>('POST', `${A(aid)}/comms/messages`, { type: 'Notice', title: m.title, body: m.body, channels: m.channels, priority: m.important ? 'Important' : 'Normal', audience: { kind: 'all' }, action: 'send' });
