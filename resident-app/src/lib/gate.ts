import { accessToken, api, API_URL, LIVE } from './api';
import { uploadPhoto } from './live';

/* Visitors and deliveries. The resident's side works in demo mode too (kept in memory); the guard's
   side exists only when the app is connected to the API, like the property manager's. */

export const VISITOR_TYPES = ['Guest', 'Delivery', 'Cab', 'Vendor', 'Staff', 'Emergency'] as const;
export type VisitorType = (typeof VISITOR_TYPES)[number];
export const DELIVERY_TYPES = ['Food', 'Courier', 'Grocery', 'Parcel', 'Medicine'] as const;
export type DeliveryType = (typeof DELIVERY_TYPES)[number];
export const PARTNERS = ['Swiggy', 'Zomato', 'Amazon', 'Flipkart', 'Blinkit', 'Zepto', 'BigBasket', 'Courier'] as const;
export type VisitStatus = 'Expected' | 'Pending' | 'Approved' | 'Rejected' | 'AtGate' | 'Inside' | 'Left' | 'Collected' | 'Cancelled' | 'Expired';

export type Visit = {
  id: string; kind: 'visitor' | 'delivery'; visitorType: VisitorType; name: string; phone: string | null; photoUrl: string | null; purpose: string;
  vehicle: string | null; people: number; deliveryType: DeliveryType | null; partner: string | null; status: VisitStatus; flagged: string | null;
  validFrom: string | null; validUntil: string | null; decidedByName: string | null; decidedVia: string | null; decidedAt: string | null;
  enteredAt: string | null; exitedAt: string | null; gate: string | null; guardName: string | null; exitGuardName: string | null;
  proofUrl: string | null; keptAt: string | null; collectedAt: string | null; collectedBy: string | null; note: string; createdAt: string;
  unit: string | null; unitLabel: string | null;
  /** the visitor scanned the gate's QR sticker and typed this themselves; `ref` is the code their phone shows */
  selfCheckIn?: boolean; ref?: string | null;
  /** the resident's copies only */
  passCode?: string | null; collectCode?: string | null;
  /** set by the gate when the number is on the block list */
  blocked?: string; residentsToAsk?: number;
};
export type MyVisits = { pending: Visit[]; expected: Visit[]; parcels: Visit[]; inside: Visit[]; history: Visit[] };
export type Frequent = { id: string; name: string; phone: string; visitorType: VisitorType; vehicle: string | null; autoApprove: boolean };
export type Decision = 'approve' | 'reject' | 'gate';
export type NewPass = { name: string; phone?: string; visitorType: Exclude<VisitorType, 'Emergency'>; vehicle?: string; people: number; validFrom: string; validUntil: string; partner?: string; deliveryType?: DeliveryType };

/** what to call it on a card: the guest, or "Amazon · parcel" */
export const titleOf = (v: Pick<Visit, 'kind' | 'name' | 'partner'>) => (v.kind === 'delivery' ? v.partner || v.name : v.name);
export const ICON = { Guest: 'person', Delivery: 'cube', Cab: 'car', Vendor: 'construct', Staff: 'briefcase', Emergency: 'medkit' } as const;
export const TONE: Record<VisitStatus, 'acc' | 'good' | 'warn' | 'bad' | 'dim'> = {
  Expected: 'acc', Pending: 'warn', Approved: 'good', Inside: 'good', AtGate: 'warn', Rejected: 'bad', Left: 'dim', Collected: 'dim', Cancelled: 'dim', Expired: 'dim',
};

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "19 Nov, 10:05 AM" — or just the time when it is today */
export function when(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso), time = `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
  return d.toDateString() === new Date().toDateString() ? time : `${d.getDate()} ${MON[d.getMonth()]}, ${time}`;
}

/* ---------------- demo records (no API): one flat's gate, in memory ---------------- */
const hoursAgo = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
const blank = { phone: null, photoUrl: null, purpose: '', vehicle: null, people: 1, deliveryType: null, partner: null, flagged: null, validFrom: null, validUntil: null, decidedByName: null, decidedVia: null,
  decidedAt: null, enteredAt: null, exitedAt: null, gate: 'Main gate', guardName: 'Ramesh Kumar', exitGuardName: null, proofUrl: null, keptAt: null, collectedAt: null, collectedBy: null, note: '', unit: 'T4-1108', unitLabel: 'Tower 4, Flat 1108' };
let demo: Visit[] = [
  { ...blank, id: 'd1', kind: 'delivery', visitorType: 'Delivery', name: 'Courier', partner: 'Amazon', deliveryType: 'Parcel', status: 'AtGate', decidedVia: 'resident', decidedAt: hoursAgo(3), keptAt: hoursAgo(2.9), collectCode: '4821', createdAt: hoursAgo(3.1) },
  { ...blank, id: 'd2', kind: 'visitor', visitorType: 'Staff', name: 'Lakshmi Devi', phone: '9812300001', purpose: 'Housekeeping', status: 'Left', decidedVia: 'frequent', enteredAt: hoursAgo(6), exitedAt: hoursAgo(4), exitGuardName: 'Ramesh Kumar', createdAt: hoursAgo(6) },
  { ...blank, id: 'd3', kind: 'delivery', visitorType: 'Delivery', name: 'Delivery rider', partner: 'Swiggy', deliveryType: 'Food', status: 'Left', decidedVia: 'resident', enteredAt: hoursAgo(20), exitedAt: hoursAgo(19.8), createdAt: hoursAgo(20) },
  { ...blank, id: 'd4', kind: 'visitor', visitorType: 'Guest', name: 'Meera Krishnan', phone: '9886011223', purpose: 'Family visit', people: 2, status: 'Left', decidedVia: 'resident', enteredAt: hoursAgo(27), exitedAt: hoursAgo(24), createdAt: hoursAgo(27) },
];
let demoFrequent: Frequent[] = [{ id: 'f1', name: 'Lakshmi Devi', phone: '9812300001', visitorType: 'Staff', vehicle: null, autoApprove: true }];
const expire = (v: Visit): Visit => (v.status === 'Expected' && v.validUntil && new Date(v.validUntil).getTime() < Date.now() ? { ...v, status: 'Expired' } : v);
const patchDemo = (id: string, p: Partial<Visit>) => { demo = demo.map(v => (v.id === id ? { ...v, ...p } : v)); return demo.find(v => v.id === id)!; };

/* ---------------- the resident ---------------- */
export async function myVisits(): Promise<MyVisits> {
  if (LIVE) return api<MyVisits>('GET', '/v1/visits');
  const rows = demo.map(expire).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    pending: rows.filter(v => v.status === 'Pending'), expected: rows.filter(v => v.status === 'Expected'), parcels: rows.filter(v => v.status === 'AtGate'),
    inside: rows.filter(v => v.status === 'Inside' || v.status === 'Approved'), history: rows.filter(v => ['Left', 'Collected', 'Rejected', 'Cancelled', 'Expired'].includes(v.status)),
  };
}
export async function visit(id: string): Promise<Visit> {
  if (LIVE) return api<Visit>('GET', '/v1/visits/' + id);
  const v = demo.find(x => x.id === id);
  if (!v) throw new Error('not found');
  return expire(v);
}
export async function createPass(p: NewPass): Promise<Visit> {
  if (LIVE) return api<Visit>('POST', '/v1/visits', p);
  const delivery = p.visitorType === 'Delivery';
  const v: Visit = { ...blank, id: 'd' + Date.now(), kind: delivery ? 'delivery' : 'visitor', visitorType: p.visitorType, name: p.name, phone: p.phone ?? null, vehicle: p.vehicle ?? null, people: p.people,
    partner: p.partner ?? null, deliveryType: delivery ? p.deliveryType ?? 'Parcel' : null, status: 'Expected', validFrom: p.validFrom, validUntil: p.validUntil, gate: null, guardName: null,
    passCode: String(Math.floor(100000 + Math.random() * 900000)), createdAt: new Date().toISOString() };
  demo = [v, ...demo];
  return v;
}
export async function decide(id: string, decision: Decision): Promise<Visit> {
  if (LIVE) return api<Visit>('POST', `/v1/visits/${id}/decision`, { decision });
  return patchDemo(id, { status: decision === 'approve' ? 'Approved' : decision === 'reject' ? 'Rejected' : 'AtGate', decidedVia: 'resident', decidedAt: new Date().toISOString(), collectCode: decision === 'gate' ? '5310' : null });
}
export async function cancelPass(id: string): Promise<Visit> {
  if (LIVE) return api<Visit>('POST', `/v1/visits/${id}/cancel`);
  return patchDemo(id, { status: 'Cancelled' });
}
export async function frequentList(): Promise<Frequent[]> {
  return LIVE ? api<Frequent[]>('GET', '/v1/frequent-visitors') : demoFrequent;
}
export async function saveFrequent(f: Omit<Frequent, 'id' | 'vehicle'> & { vehicle?: string }): Promise<Frequent> {
  if (LIVE) return api<Frequent>('POST', '/v1/frequent-visitors', f);
  const row: Frequent = { ...f, vehicle: f.vehicle ?? null, id: 'f' + Date.now() };
  demoFrequent = [...demoFrequent.filter(x => x.phone !== f.phone), row];
  return row;
}
export async function removeFrequent(id: string) {
  if (LIVE) return api('DELETE', '/v1/frequent-visitors/' + id);
  demoFrequent = demoFrequent.filter(x => x.id !== id);
}

/* ---------------- the guard (connected only) ---------------- */
export type Post = { user: { id: string; name: string }; society: string; gate: string; waiting: number; inside: number; parcels: number };
export type Flat = { id: string; code: string; label: string; residents: string[] };
export type Lookup = {
  /** their last entry, with the newest photo the gate holds of them */
  last: { name: string; vehicle: string | null; photoUrl: string | null; visitorType: VisitorType; purpose: string; partner: string | null; deliveryType: DeliveryType | null; at: string } | null; visits: number;
  /** the flats they went to before, newest first */
  flats: Flat[];
  regular: { unitId: string; unit: string; name: string; visitorType: VisitorType; vehicle: string | null; autoApprove: boolean }[];
  watch: { level: 'block' | 'watch'; reason: string; name: string } | null;
};
export type GateTab = 'waiting' | 'inside' | 'parcels' | 'today';
export type Arrival = { visitorType: VisitorType; name: string; phone?: string; unitId?: string; purpose?: string; vehicle?: string; people?: number; deliveryType?: DeliveryType; partner?: string; photo?: string };

export const post = () => api<Post>('GET', '/v1/gate/me');
/**
 * The gate, live: `onChange` runs the moment anything changes at this society's gate — a visitor checks in
 * by QR, a flat answers — so the guard's lists are re-read at once. Reconnects by itself; returns how to stop.
 * The screen's own timer stays as the net under it.
 */
export function watchGate(onChange: () => void) {
  let ws: WebSocket | null = null, timer: ReturnType<typeof setTimeout> | undefined, tries = 0, stopped = false;
  const open = async () => {
    if (stopped) return;
    // any signed-in call renews an expired token first, so the socket is opened with one that works
    try { await post(); } catch { /* offline: the retry below comes round again */ }
    const token = accessToken();
    if (stopped) return;
    if (!token) { timer = setTimeout(open, 5000); return; }
    const sock = new WebSocket(API_URL.replace(/^http/, 'ws') + '/v1/gate/live');
    ws = sock;
    sock.onopen = () => { tries = 0; sock.send(JSON.stringify({ token })); };
    sock.onmessage = e => { if (typeof e.data === 'string' && e.data.includes('"changed"')) onChange(); };
    sock.onerror = () => {};
    sock.onclose = () => { if (ws === sock) ws = null; if (!stopped) timer = setTimeout(open, Math.min(15000, 1000 * 2 ** tries++)); };
  };
  void open();
  return () => { stopped = true; clearTimeout(timer); ws?.close(); };
}
export const findFlats = (q: string) => api<Flat[]>('GET', '/v1/gate/units?q=' + encodeURIComponent(q));
export const lookup = (phone: string) => api<Lookup>('GET', '/v1/gate/lookup?phone=' + phone);
export const gateList = (tab: GateTab) => api<Visit[]>('GET', '/v1/gate/visits?tab=' + tab);
export async function arrive({ photo, ...a }: Arrival) {
  const photoUrl = photo ? await uploadPhoto(photo) : undefined;
  return api<Visit>('POST', '/v1/gate/visits', { ...a, photoUrl });
}
export const checkPass = (code: string) => api<Visit>('POST', '/v1/gate/pass', { code });
export const guardDecide = (id: string, decision: Decision) => api<Visit>('POST', `/v1/gate/visits/${id}/decision`, { decision });
export const letIn = (id: string) => api<Visit>('POST', `/v1/gate/visits/${id}/enter`, {});
export async function markExit(id: string, photo?: string) {
  return api<Visit>('POST', `/v1/gate/visits/${id}/exit`, { proofUrl: photo ? await uploadPhoto(photo) : undefined });
}
export async function keepParcel(id: string, photo?: string) {
  return api<Visit>('POST', `/v1/gate/visits/${id}/keep`, { proofUrl: photo ? await uploadPhoto(photo) : undefined });
}
export const handOver = (id: string, proof: { code?: string; collectedBy?: string }) => api<Visit>('POST', `/v1/gate/visits/${id}/collect`, proof);
