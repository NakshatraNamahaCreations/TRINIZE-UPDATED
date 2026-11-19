import { api } from './api';
import { association } from './live';

/* The gate, from the office: the society-wide visitor and delivery register, the guards who run it,
   and the block / watch list. Connected mode only. */

const A = () => `/v1/admin/${association()}`;

export type VisitStatus = 'Expected' | 'Pending' | 'Approved' | 'Rejected' | 'AtGate' | 'Inside' | 'Left' | 'Collected' | 'Cancelled' | 'Expired';
export type Visit = {
  id: string; kind: 'visitor' | 'delivery'; visitorType: string; name: string; phone: string | null; photoUrl: string | null; purpose: string;
  vehicle: string | null; people: number; deliveryType: string | null; partner: string | null; status: VisitStatus; flagged: string | null;
  decidedByName: string | null; decidedVia: string | null; enteredAt: string | null; exitedAt: string | null; gate: string | null; guardName: string | null;
  proofUrl: string | null; keptAt: string | null; collectedAt: string | null; collectedBy: string | null; note: string; createdAt: string; unit: string | null;
  /** the visitor scanned a gate QR sticker and typed the entry themselves */
  selfCheckIn: boolean; ref: string | null;
};
export type Summary = {
  entries_today: number; inside_now: number; waiting: number; parcels_at_gate: number; rejected_today: number; deliveries_today: number; expected: number;
  byType: { type: string; n: number }[];
};
export type Guard = { id: string; name: string; phone: string; gate: string | null };
export type Watch = { id: string; name: string; phone: string | null; vehicle: string | null; reason: string; level: 'block' | 'watch'; addedBy: string; createdAt: string };
/** a QR sticker for a gate: `url` is what the QR carries — the visitor's own check-in page */
export type Sticker = { id: string; gate: string; society: string; url: string; createdAt: string };
export type Filter = { from?: string; to?: string; unit?: string; kind?: string; status?: string; q?: string };

export const visits = (f: Filter) => {
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
  return api<Visit[]>('GET', `${A()}/visits${qs ? '?' + qs : ''}`);
};
/** one page of the register, newest first, with how many entries match */
export const visitsPage = (f: Filter, page: number, limit: number) => {
  const qs = new URLSearchParams({ ...(Object.fromEntries(Object.entries(f).filter(([, v]) => v)) as Record<string, string>), page: String(page), limit: String(limit) }).toString();
  return api<{ items: Visit[]; total: number }>('GET', `${A()}/visits?${qs}`);
};
export const summary = () => api<Summary>('GET', `${A()}/visits/summary`);
export const decide = (id: string, decision: 'approve' | 'reject' | 'gate', note = '') => api<Visit>('POST', `${A()}/visits/${id}/decision`, { decision, note });
export const guards = () => api<Guard[]>('GET', `${A()}/guards`);
export const addGuard = (g: { name: string; phone: string; gate: string }) => api<Guard>('POST', `${A()}/guards`, g);
export const moveGuard = (id: string, gate: string) => api<Guard>('PUT', `${A()}/guards/${id}`, { gate });
export const removeGuard = (id: string) => api('DELETE', `${A()}/guards/${id}`);
export const watchlist = () => api<Watch[]>('GET', `${A()}/watchlist`);
export const addWatch = (w: { name: string; phone?: string; vehicle?: string; reason: string; level: 'block' | 'watch' }) => api<Watch>('POST', `${A()}/watchlist`, w);
export const removeWatch = (id: string) => api('DELETE', `${A()}/watchlist/${id}`);
export const stickers = () => api<Sticker[]>('GET', `${A()}/gate-codes`);
export const addSticker = (gate: string) => api<Sticker>('POST', `${A()}/gate-codes`, { gate });
export const removeSticker = (id: string) => api('DELETE', `${A()}/gate-codes/${id}`);

/** an SOS raised from the app by a resident or a guard */
export type Incident = { id: string; kind: string; by: string; role: string; unit: string | null; place: string; note: string; status: 'Open' | 'Acknowledged' | 'Resolved'; ackByName: string | null; resolvedByName: string | null; resolution: string; createdAt: string };
export const incidents = () => api<Incident[]>('GET', `${A()}/incidents`);
export const ackIncident = (id: string) => api<Incident>('POST', `${A()}/incidents/${id}/ack`, {});
export const resolveIncident = (id: string, resolution: string) => api<Incident>('POST', `${A()}/incidents/${id}/resolve`, { resolution });

export const STATUS_LABEL: Record<VisitStatus, string> = {
  Expected: 'Expected', Pending: 'Waiting', Approved: 'Approved', Rejected: 'Turned away', AtGate: 'At gate', Inside: 'Inside', Left: 'Left', Collected: 'Collected', Cancelled: 'Cancelled', Expired: 'Expired',
};
export const STATUS_TONE: Record<VisitStatus, 'good' | 'warn' | 'bad' | 'acc' | 'dim'> = {
  Expected: 'acc', Pending: 'warn', Approved: 'good', Rejected: 'bad', AtGate: 'warn', Inside: 'good', Left: 'dim', Collected: 'dim', Cancelled: 'dim', Expired: 'dim',
};
export const VIA: Record<string, string> = {
  resident: 'Flat answered', admin: 'Office decided', guard: 'Guard, by phone', pass: 'Pass code', frequent: 'Standing permission', emergency: 'Emergency', watchlist: 'Block list',
};
export function time(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso), today = d.toDateString() === new Date().toDateString();
  return d.toLocaleString('en-IN', today ? { hour: 'numeric', minute: '2-digit' } : { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}
