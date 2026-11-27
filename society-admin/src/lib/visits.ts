import { api, LIVE } from './api';
import { association } from './live';

/* The property manager's weekly on-site visits, and the operations numbers on the dashboard
   (resolution time, resident satisfaction, vendor workload). Without a server the dashboard shows
   sample figures; the Visits page needs the server. */

const A = () => `/v1/admin/${association()}`;

export type SiteKind = 'Inspection' | 'Meeting' | 'Follow-up' | 'Request';
export type SiteStatus = 'Requested' | 'Scheduled' | 'Done' | 'Declined';
export type SiteItem = {
  id: string; date: string | null; time: string | null; title: string; location: string; kind: SiteKind; status: SiteStatus;
  extra: boolean; note: string; reply: string; ref: string | null; issueStatus: string | null;
  resident: { name: string; unit: string | null } | null; createdAt: string;
};
export type SiteDay = {
  id: string | null; date: string; start: string; end: string; status: 'Planned' | 'Done' | 'Cancelled'; note: string; startsAt: string; items: SiteItem[];
  /** the visit cycle: the manager checks in and out on the phone, and leaves a report */
  checkedInAt?: string | null; checkedOutAt?: string | null; report?: string;
};
export type SitePlan = { weekday: number; start: string; end: string };
export type SiteBoard = { manager: { id: string; name: string; phone: string | null; title: string } | null; plan: SitePlan | null; today: string; days: SiteDay[]; requests: SiteItem[] };
export type OpsStats = {
  resolution: { hours: number | null; prevHours: number | null; resolved: number };
  satisfaction: { avg: number | null; count: number; dist: { star: number; n: number }[] };
  buckets: { open: number; inProgress: number; pendingVendor: number; resolved: number };
  vendors: { id: string; name: string; category: string; open: number; inProgress: number; completed: number }[];
};

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const weekdayOf = (day: string) => new Date(day + 'T00:00:00Z').getUTCDay();
/** "Fri 28 Nov" */
export const dayLabel = (day: string) => `${WEEKDAYS[weekdayOf(day)]!.slice(0, 3)} ${Number(day.slice(8, 10))} ${MON[Number(day.slice(5, 7)) - 1]}`;
/** "09:30" → "9:30 AM" */
export const clock = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number) as [number, number]; return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
/** hours → "1.8 days" or "6.5 hrs" */
export const duration = (hours: number) => (hours >= 24 ? `${(hours / 24).toFixed(1)} days` : `${hours.toFixed(1)} hrs`);

/* ---------- sample figures for the demo console ---------- */
const IST = 330 * 60_000;
const todayIst = () => new Date(Date.now() + IST).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
const DEMO_OPS: OpsStats = {
  resolution: { hours: 43, prevHours: 50, resolved: 23 },
  satisfaction: { avg: 4.6, count: 32, dist: [{ star: 5, n: 23 }, { star: 4, n: 5 }, { star: 3, n: 2 }, { star: 2, n: 1 }, { star: 1, n: 1 }] },
  buckets: { open: 18, inProgress: 15, pendingVendor: 8, resolved: 23 },
  vendors: [
    { id: 'v1', name: 'Clean & Green Services', category: 'Housekeeping', open: 6, inProgress: 3, completed: 12 },
    { id: 'v2', name: 'SmartCare Maintenance', category: 'Electrical', open: 8, inProgress: 4, completed: 10 },
    { id: 'v3', name: 'AquaPure Solutions', category: 'Plumbing', open: 5, inProgress: 2, completed: 7 },
    { id: 'v4', name: 'SecurePlus Security', category: 'Security', open: 3, inProgress: 1, completed: 9 },
  ],
};
function demoBoard(): SiteBoard {
  let d = todayIst();
  while (weekdayOf(d) !== 5) d = addDays(d, 1);
  const item = (id: string, time: string, title: string, location: string, kind: SiteKind, status: SiteStatus): SiteItem =>
    ({ id, date: d, time, title, location, kind, status, extra: false, note: '', reply: '', ref: null, issueStatus: null, resident: null, createdAt: new Date().toISOString() });
  return {
    manager: { id: 'm', name: 'Imran Qureshi', phone: null, title: 'Property Manager' }, plan: { weekday: 5, start: '09:00', end: '12:00' }, today: todayIst(),
    days: [{ id: 'd', date: d, start: '09:00', end: '12:00', status: 'Planned', note: '', startsAt: '', items: [
      item('i1', '09:00', 'Water pressure check', 'Tower 1', 'Inspection', 'Done'),
      item('i2', '09:30', 'Common area inspection', 'Clubhouse & lobby', 'Inspection', 'Done'),
      item('i3', '10:15', 'Meeting with the committee', 'Society office', 'Meeting', 'Scheduled'),
      item('i4', '11:00', 'Pending request follow-ups', 'Across towers', 'Follow-up', 'Scheduled'),
    ] }],
    requests: [],
  };
}

/* ---------- API ---------- */
export const opsStats = () => (LIVE ? api<OpsStats>('GET', `${A()}/stats/operations`) : Promise.resolve(DEMO_OPS));
export const siteBoard = (days = 14) => (LIVE ? api<SiteBoard>('GET', `${A()}/site-visits?days=${days}`) : Promise.resolve(demoBoard()));
export const savePlan = (p: SitePlan) => api<SitePlan>('PUT', `${A()}/site-visits/plan`, p);
export const clearPlan = () => api('DELETE', `${A()}/site-visits/plan`);
export const setDay = (date: string, o: { status?: SiteDay['status']; note?: string; start?: string; end?: string }) => api('PUT', `${A()}/site-visits/days/${date}`, o);
export const addItem = (o: { date: string; time?: string; title: string; location?: string; kind: Exclude<SiteKind, 'Request'>; issueRef?: string }) => api<SiteItem>('POST', `${A()}/site-visits/items`, o);
export const updateItem = (id: string, o: { status?: 'Scheduled' | 'Done' | 'Declined'; date?: string; time?: string | null; reply?: string }) => api<SiteItem>('PUT', `${A()}/site-visits/items/${id}`, o);
export const removeItem = (id: string) => api('DELETE', `${A()}/site-visits/items/${id}`);
