import { api, LIVE } from './api';

/* The society's Virtual Property Manager, as a resident sees them: who they are, the weekly on-site
   visit, and asking for something to be looked at on it. In demo mode (no API) a sample manager and
   schedule are kept in memory so the screens can be tried. */

export type ItemKind = 'Inspection' | 'Meeting' | 'Follow-up' | 'Request';
export type RequestStatus = 'Requested' | 'Scheduled' | 'Done' | 'Declined';
export type VisitItem = { id: string; time: string | null; title: string; location: string; kind: ItemKind; status: 'Scheduled' | 'Done'; mine: boolean; ref: string | null };
export type VisitDay = {
  date: string; start: string; end: string; status: 'Planned' | 'Done' | 'Cancelled'; note: string; startsAt: string;
  items: VisitItem[];
  /** other residents' requests on this visit — counted, never shown */
  others: number;
};
export type MyRequest = {
  id: string; title: string; kind: ItemKind; status: RequestStatus; extra: boolean; date: string | null; time: string | null;
  note: string; reply: string; ref: string | null; createdAt: string;
};
export type Plan = { weekday: number; start: string; end: string };
export type ManagerInfo = {
  /** `online`: they used the app in the last few minutes (false when unknown) */
  manager: { name: string; title: string; phone: string | null; online?: boolean } | null;
  plan: Plan | null;
  next: { date: string; start: string; end: string; startsAt: string } | null;
  visits: VisitDay[];
  requests: MyRequest[];
};

/* ---------- dates: visit days are IST calendar days, YYYY-MM-DD ---------- */
const IST = 330 * 60_000;
export const todayIst = () => new Date(Date.now() + IST).toISOString().slice(0, 10);
export const addDays = (day: string, n: number) => new Date(Date.parse(day + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
export const weekdayOf = (day: string) => new Date(day + 'T00:00:00Z').getUTCDay();
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "28 Nov" */
export const dayMonth = (day: string) => `${Number(day.slice(8, 10))} ${MON[Number(day.slice(5, 7)) - 1]}`;
/** "09:30" → "9:30 AM" */
export const clock = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
export const hours = (start: string, end: string) => `${clock(start)} – ${clock(end)}`;

/* ---------- demo ---------- */
const DEMO_PLAN: Plan = { weekday: 5, start: '09:00', end: '12:00' };
const instant = (day: string, hhmm: string) => new Date(Date.parse(`${day}T${hhmm}:00Z`) - IST).toISOString();
let demoRequests: MyRequest[] = [];
function demoInfo(): ManagerInfo {
  const today = todayIst();
  const dates: string[] = [];
  for (let d = today; dates.length < 4; d = addDays(d, 1)) if (weekdayOf(d) === DEMO_PLAN.weekday) dates.push(d);
  const visits: VisitDay[] = dates.map((date, i) => ({
    date, start: DEMO_PLAN.start, end: DEMO_PLAN.end, status: 'Planned', note: '', startsAt: instant(date, DEMO_PLAN.start), others: i === 0 ? 2 : 0,
    items: i === 0 ? [
      { id: 'v1', time: '09:00', title: 'Water pressure check', location: 'Tower 1', kind: 'Inspection', status: 'Scheduled', mine: false, ref: null },
      { id: 'v2', time: '09:30', title: 'Common area inspection', location: 'Clubhouse & lobby', kind: 'Inspection', status: 'Scheduled', mine: false, ref: null },
      { id: 'v3', time: '10:15', title: 'Meeting with the committee', location: 'Society office', kind: 'Meeting', status: 'Scheduled', mine: false, ref: null },
      { id: 'v4', time: '11:00', title: 'Pending request follow-ups', location: 'Across towers', kind: 'Follow-up', status: 'Scheduled', mine: false, ref: null },
      ...demoRequests.filter(r => r.date === date && r.status === 'Scheduled').map(r => ({ id: r.id, time: r.time, title: r.title, location: '', kind: r.kind, status: 'Scheduled' as const, mine: true, ref: r.ref })),
    ] : [],
  }));
  return {
    manager: { name: 'Imran Qureshi', title: 'Property Manager', phone: '9833300003', online: true },
    plan: DEMO_PLAN, next: { date: dates[0]!, start: DEMO_PLAN.start, end: DEMO_PLAN.end, startsAt: visits[0]!.startsAt },
    visits, requests: demoRequests,
  };
}

/* ---------- API ---------- */
export async function managerInfo(): Promise<ManagerInfo> {
  return LIVE ? api<ManagerInfo>('GET', '/v1/manager') : demoInfo();
}
export async function requestVisit(o: { issueRef?: string; note: string; extra: boolean; date?: string; title?: string }): Promise<MyRequest> {
  if (LIVE) return api<MyRequest>('POST', '/v1/manager/requests', { issueRef: o.issueRef, note: o.note, extra: o.extra, date: o.date });
  const r: MyRequest = {
    id: 'r' + Date.now(), title: o.title ?? o.note.slice(0, 120), kind: 'Request', status: 'Requested', extra: o.extra,
    date: o.extra ? null : o.date ?? demoInfo().next?.date ?? null, time: null, note: o.note, reply: '', ref: o.issueRef ?? null, createdAt: new Date().toISOString(),
  };
  demoRequests = [r, ...demoRequests];
  return r;
}
export async function withdrawRequest(id: string): Promise<void> {
  if (LIVE) { await api('DELETE', '/v1/manager/requests/' + id); return; }
  demoRequests = demoRequests.filter(r => r.id !== id);
}
