import type { Announcement, AuditEntry, CommunityEvent, Issue, IssueStatus, KnowledgeDoc, ModAction, ModItem, Poll, Priority, ResolvedMod, State, Tone, User } from '../store/data';
import { api, ApiError } from './api';

/* The server's records, translated into the shapes the console's pages already draw. The pages keep
   using the short refs they show (ISS-1043, MOD-89); the server ids needed for writes are kept here. */

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const time = (d: Date) => `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
const dm = (d: Date) => `${d.getDate()} ${MON[d.getMonth()]}`;
const stamp = (iso: string) => { const d = new Date(iso); return `${dm(d)}, ${time(d)}`; };
/** how an event's start is written everywhere: "Sun 6 Sep · 7:00 AM" */
export const eventWhen = (d: Date) => `${DOW[d.getDay()]} ${dm(d)} · ${time(d)}`;
function ago(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return 'Just now';
  if (mins < 60) return mins + 'm ago';
  if (mins < 1440) return Math.floor(mins / 60) + 'h ago';
  const days = Math.floor(mins / 1440);
  return days === 1 ? 'Yesterday' : days < 7 ? days + ' days ago' : dm(new Date(iso));
}

let aid = '';
/** the association this admin runs — every admin route is scoped to it */
export const setAssociation = (id: string) => { aid = id; };
export const association = () => aid;
const A = () => `/v1/admin/${aid}`;

/* ---------- issues ---------- */
type ApiIssue = {
  ref: string; title: string; category: string; location: string; priority: Priority; status: IssueStatus; slaDueAt: string; createdAt: string;
  reporter: string | null; unit: string | null; vendor: string | null; slaState: 'ok' | 'over' | 'met';
  timeline: { status: IssueStatus; note: string | null; at: string }[]; internalNotes?: { text: string; at: string; by: string | null }[];
};
function toIssue(i: ApiIssue): Issue {
  const due = new Date(i.slaDueAt);
  const late = Math.round((Date.now() - due.getTime()) / 3600e3);
  return {
    id: i.ref, title: i.title, cat: i.category, loc: i.location, pri: i.priority, by: i.reporter ?? 'Former resident', unit: i.unit ?? '—',
    when: dm(new Date(i.createdAt)), status: i.status, vendor: i.vendor ?? '—',
    sla: i.slaState === 'met' ? 'Met' : i.slaState === 'over' ? `${late}h over SLA` : `Due ${dm(due)}, ${time(due)}`, slaState: i.slaState,
    tl: i.timeline.map(e => ({ s: e.status, w: stamp(e.at), n: e.note ?? undefined })),
    internal: (i.internalNotes ?? []).map(n => ({ w: stamp(n.at), n: n.text })),
  };
}

const vendorIds = new Map<string, string>();
let vendorNames: string[] = [];
export const liveVendors = () => vendorNames;

/** 14 days of tickets opened vs resolved, from the tickets themselves */
function trendOf(list: ApiIssue[]): State['trend'] {
  const days: string[] = [], created: number[] = [], resolved: number[] = [];
  for (let back = 13; back >= 0; back--) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - back);
    const next = d.getTime() + 864e5;
    const within = (iso: string) => { const t = new Date(iso).getTime(); return t >= d.getTime() && t < next; };
    days.push(String(d.getDate()));
    created.push(list.filter(i => within(i.createdAt)).length);
    resolved.push(list.filter(i => i.timeline.some(e => e.status === 'Resolved' && within(e.at))).length);
  }
  return { days, created, resolved };
}

/* ---------- moderation ---------- */
type ApiMod = { id: string; ref: string; kind: string; text: string; category: string; severity: 'Low' | 'Medium' | 'High'; reason: string; context: string; state: 'open' | 'done'; action: ModAction | null; createdAt: string; by: string; unit: string | null };
const modIds = new Map<string, string>();
/** the action the console pre-selects: reports are usually hidden or allowed; held text usually earns a warning */
const recommend = (m: ApiMod): ModAction => (m.category === 'Abusive' ? 'Hidden' : m.kind.startsWith('Reported') ? 'Allowed' : m.kind === 'Gratitude note' ? 'Rewrite suggested' : 'Warned author');

/* ---------- people ---------- */
type ApiUser = { userId: string; name: string; unit: string; role: 'Owner' | 'Tenant' | 'Family'; memberStatus: 'active' | 'pending'; status: User['status']; warnings: number };
const userIds = new Map<string, string>();

type ApiAi = { qna: boolean; issueCreate: boolean; toneRewrite: boolean; summaries: boolean; tones: Record<Tone, boolean>; threshold: State['ai']['threshold']; autoHold?: State['ai']['autoHold'] };

/** the sections the signed-in person may use, once known (see lib/access.tsx) — so the sync does not ask for the others */
// undefined = not asked yet; null = no limit
let mine: string[] | null | undefined;
export const setMySections = (keys: string[] | null | undefined) => { mine = keys; };

/** Everything the console shows, in one go — on sign-in and then every 20 seconds. */
export async function fetchAll(keep: State): Promise<State> {
  // someone with limited access is refused the sections they were not given: those read as empty, the rest still load
  const soft = <T,>(p: Promise<T>, empty: T) => p.catch(e => { if (e instanceof ApiError && e.code === 'no_access') return empty; throw e; });
  // the first sync after sign-in can run before the menu has asked; find out here, so it never requests a closed section
  if (mine === undefined) await api<{ full: boolean; permissions: string[] }>('GET', `${A()}/staff/me`).then(a => { mine = a.full ? null : a.permissions; }).catch(() => {});
  const has = (...sections: string[]) => !mine || sections.some(k => mine!.includes(k));
  const list = <T,>(path: string, ...sections: string[]) => (has(...sections) ? soft(api<T[]>('GET', `${A()}/${path}`), [] as T[]) : Promise.resolve([] as T[]));
  const [issues, vendors, anns, open, done, users, audit, events, polls, ai, docs, stats] = await Promise.all([
    list<ApiIssue>('issues', 'issues', 'maintenance'),
    list<{ id: string; name: string }>('vendors', 'issues', 'maintenance'),
    list<{ ref: string; title: string; body: string; by: string; priority: 'High' | 'Normal'; audience: string; requiresAck: boolean; publishedAt: string; acks: number }>('announcements', 'announcements'),
    list<ApiMod>('moderation?state=open', 'moderation'),
    list<ApiMod>('moderation?state=done', 'moderation'),
    list<ApiUser>('users', 'users'),
    list<{ actor: string; action: string; at: string }>('audit', 'audit'),
    list<{ id: string; title: string; description: string; location: string; startsAt: string; minutes: number; capacity: number; going: number; waitlist: number }>('events', 'events'),
    list<{ id: string; question: string; eligibility: 'all' | 'owners'; closesAt: string; closed: boolean; options: { label: string; votes: number }[] }>('polls', 'events'),
    has('ai') ? soft(api<ApiAi | null>('GET', `${A()}/ai-settings`), null) : null,
    list<{ id: string; title: string; section: string; body: string; createdAt: string }>('knowledge', 'ai'),
    // a count no list carries; an older server without it simply reads as none
    api<{ gratitudes: number }>('GET', `${A()}/stats`).catch(() => ({ gratitudes: 0 })),
  ]);
  vendorIds.clear(); vendors.forEach(v => vendorIds.set(v.name, v.id)); vendorNames = vendors.map(v => v.name);
  modIds.clear(); [...open, ...done].forEach(m => modIds.set(m.ref, m.id));
  userIds.clear(); users.forEach(u => userIds.set(u.name, u.userId));
  // acknowledgements are counted per resident, so the rate is measured against the residents on the app
  const residents = new Set(users.filter(u => u.memberStatus === 'active').map(u => u.userId)).size;

  return {
    ...keep,
    gratitudes: stats.gratitudes,
    issues: issues.map(toIssue),
    trend: trendOf(issues),
    announcements: anns.map((a): Announcement => ({ id: a.ref, title: a.title, body: a.body, pri: a.priority, aud: a.audience, when: ago(a.publishedAt), by: a.by, ack: a.requiresAck, read: residents ? Math.min(100, Math.round((a.acks / residents) * 100)) : 0, acks: a.acks })),
    modqueue: open.map((m): ModItem => ({ id: m.ref, kind: m.kind, by: m.by, unit: m.unit ?? '—', when: ago(m.createdAt), text: m.text, cat: m.category, sev: m.severity, state: 'open', rec: recommend(m), ai: m.reason, ctx: m.context })),
    resolvedMods: done.map((m): ResolvedMod => ({ id: m.ref, by: m.by, when: ago(m.createdAt), text: '“' + m.text.slice(0, 80) + (m.text.length > 80 ? '…' : '') + '”', action: m.action ?? 'Reviewed', admin: '' })),
    users: users.filter(u => u.memberStatus === 'active').map((u): User => ({ n: u.name, unit: u.unit, role: u.role === 'Owner' ? 'Owner' : 'Tenant', status: u.status, warns: u.warnings })),
    audit: audit.map((a): AuditEntry => ({ who: a.actor, what: a.action, when: ago(a.at), at: a.at })),
    events: events.map((e): CommunityEvent => ({ id: e.id, title: e.title, when: eventWhen(new Date(e.startsAt)), where: e.location, cap: e.capacity, going: e.going, wait: e.waitlist, mins: e.minutes, at: e.startsAt, desc: e.description })),
    polls: polls.map((p): Poll => ({ id: p.id, q: p.question, opts: p.options.map(o => ({ t: o.label, v: o.votes })), elig: p.eligibility === 'owners' ? 'Owners only · one vote per unit' : 'All residents · one vote per unit', closed: p.closed, closesAt: p.closesAt, owners: p.eligibility === 'owners' })),
    ai: {
      ...keep.ai, ...(ai ? { qna: ai.qna, issueCreate: ai.issueCreate, toneRewrite: ai.toneRewrite, summaries: ai.summaries, tones: { ...keep.ai.tones, ...ai.tones }, threshold: ai.threshold, autoHold: ai.autoHold ?? keep.ai.autoHold } : {}),
      docs: docs.map((d): KnowledgeDoc => ({ n: d.title, t: d.section || 'Text', d: dm(new Date(d.createdAt)), id: d.id, body: d.body })),
    },
  };
}

/* ---------- writes ---------- */
export const moveIssueLive = (ref: string, to: IssueStatus, note: string | undefined, vendor?: string) =>
  api('POST', `${A()}/issues/${ref}/status`, { to, note: note || undefined, vendorId: vendor ? vendorIds.get(vendor) : undefined });
export const internalNoteLive = (ref: string, text: string) => api('POST', `${A()}/issues/${ref}/notes`, { text });
export const publicUpdateLive = (ref: string, text: string) => api('POST', `${A()}/issues/${ref}/updates`, { text });
export const moderateLive = (ref: string, action: ModAction) => api('POST', `${A()}/moderation/${modIds.get(ref) ?? ref}/action`, { action });
export const publishLive = (a: { title: string; body: string; aud: string; pri: 'Normal' | 'High' }) =>
  api('POST', `${A()}/announcements`, { title: a.title, body: a.body, audience: a.aud, priority: a.pri, requiresAck: a.pri === 'High' });
export const editAnnouncementLive = (ref: string, a: { title: string; body: string; pri: 'Normal' | 'High' }) =>
  api('PUT', `${A()}/announcements/${ref}`, { title: a.title, body: a.body, priority: a.pri });
export const deleteAnnouncementLive = (ref: string) => api('DELETE', `${A()}/announcements/${ref}`);
export type NewEvent ={ title: string; description: string; location: string; startsAt: string; minutes: number; capacity: number };
export type NewPoll = { question: string; options: string[]; owners: boolean; closesAt: string };
export const createEventLive = (e: NewEvent) => api('POST', `${A()}/events`, e);
export const createPollLive = (p: NewPoll) => api('POST', `${A()}/polls`, { question: p.question, options: p.options, eligibility: p.owners ? 'owners' : 'all', closesAt: p.closesAt });
export const closePollLive = (id: string) => api('POST', `${A()}/polls/${id}/close`);
export const editEventLive = (id: string, e: NewEvent) => api('PUT', `${A()}/events/${id}`, e);
export const deleteEventLive = (id: string) => api('DELETE', `${A()}/events/${id}`);
export const editPollLive = (id: string, p: NewPoll) => api('PUT', `${A()}/polls/${id}`, { question: p.question, options: p.options, eligibility: p.owners ? 'owners' : 'all', closesAt: p.closesAt });
export const deletePollLive = (id: string) => api('DELETE', `${A()}/polls/${id}`);

/* ---------- flats, households, residents' event ideas (read by their own pages) ---------- */
export type Flat = {
  id: string; code: string; tower: string; label: string; area: number; flatType: string; occupancy: 'Owner-occupied' | 'Rented' | 'Vacant'; monthlyRent: number; leaseEnd: string | null;
  members: { memberId: string; name: string; phone: string | null; role: 'Owner' | 'Tenant' | 'Family'; status: 'active' | 'pending' }[];
};
export type Member = ApiUser & { memberId: string };
export type Idea = { id: string; title: string; when: string; where: string; note: string; status: 'pending' | 'approved' | 'declined'; by: string | null; createdAt: string };
export type NewFlat = { code: string; tower: string; label: string; area: number; flatType: string; occupancy: Flat['occupancy'] };
export const addFlatsLive = (units: NewFlat[]) => api<{ added: number; skipped: number }>('POST', `${A()}/units`, { units });
export const removeFlatLive = (id: string) => api('DELETE', `${A()}/units/${id}`);
/** the office registers a resident in a flat; they can sign in on the app with this number at once */
export const addResidentLive = (flatId: string, r: { name: string; phone: string; role: 'Owner' | 'Tenant' | 'Family' }) => api('POST', `${A()}/units/${flatId}/members`, r);
/** erase a resident's account for good — no undo */
export const deleteResidentLive = (userId: string) => api('DELETE', `${A()}/users/${userId}`);
export const removeResidentLive = (flatId: string, memberId: string) => api('DELETE', `${A()}/units/${flatId}/members/${memberId}`);
/** the towers in the order the office arranged them */
export const towerOrderLive = () => api<{ order: string[] }>('GET', `${A()}/towers`).then(r => r.order);
export const saveTowerOrderLive = (towers: string[]) => api<{ order: string[] }>('PUT', `${A()}/towers/order`, { towers }).then(r => r.order);
export const flatsLive =() => api<Flat[]>('GET', `${A()}/units`);
export const membersLive = () => api<Member[]>('GET', `${A()}/users`);
export const verifyMemberLive = (memberId: string) => api('POST', `${A()}/members/${memberId}/verify`);
export const ideasLive = () => api<Idea[]>('GET', `${A()}/event-suggestions`);
export const decideIdeaLive = (id: string, decision: 'approved' | 'declined') => api('POST', `${A()}/event-suggestions/${id}/decision`, { decision });

export const standingLive =(name: string, status: User['status']) => api('PUT', `${A()}/users/${userIds.get(name)}/standing`, { status });
export const aiSettingsLive = (patch: Partial<Pick<ApiAi, 'qna' | 'issueCreate' | 'toneRewrite' | 'summaries' | 'autoHold'>> & { tones?: Partial<Record<Tone, boolean>> }) => api('PUT', `${A()}/ai-settings`, patch);
export const thresholdLive = (threshold: State['ai']['threshold']) => api('PUT', `${A()}/moderation-threshold`, { threshold });

/* ---------- the team: who signs in to this console, and what each may use (read by the Team & access page) ---------- */
export type TeamMember = {
  id: string; userId: string; name: string; email: string; phone: string | null; role: string; title: string | null; twoStep: boolean; since: string; you: boolean;
  /** full = the whole console; limited = the listed sections; role = an older built-in role with no list yet */
  access: 'full' | 'limited' | 'role'; permissions: string[];
};
export type TeamAccess = { full: boolean; permissions: string[] };
export const teamLive = () => api<TeamMember[]>('GET', `${A()}/staff`);
export const addTeamLive = (m: { name: string; email: string; password: string; title: string } & TeamAccess) => api<TeamMember>('POST', `${A()}/staff`, m);
export const editTeamLive = (id: string, m: { name: string; title: string } & TeamAccess) => api<TeamMember>('PUT', `${A()}/staff/${id}`, m);
export const teamPasswordLive = (id: string, password: string) => api('PUT', `${A()}/staff/${id}/password`, { password });
export const removeTeamLive = (id: string) => api('DELETE', `${A()}/staff/${id}`);

/* ---------- what the assistant may answer from, and a new society's first steps ---------- */
export const addKnowledgeLive = (d: { title: string; section: string; body: string }) => api('POST', `${A()}/knowledge`, d);
export const removeKnowledgeLive = (id: string) => api('DELETE', `${A()}/knowledge/${id}`);
export type SetupStep = { key: string; title: string; body: string; to: string; count: number; done: boolean };
export const setupLive = () => api<{ steps: SetupStep[]; done: number; total: number }>('GET', `${A()}/setup`);

/** the timings and rules residents ask about most — the same list Trinize can fill in while onboarding */
export type Fact = { key: string; section: string; label: string; hint: string; value: string };
export const factsLive = () => api<Fact[]>('GET', `${A()}/facts`);
export const saveFactsLive = (facts: Record<string, string>) => api<Fact[]>('PUT', `${A()}/facts`, facts);

/* ---------- the residents' Directory: committee, emergency numbers, approved vendors ---------- */
export type DirGroup = 'committee' | 'emergency' | 'vendors';
export type DirContact = { id: string; group: DirGroup; name: string; role: string; phone: string; position: number };
export const directoryLive = () => api<DirContact[]>('GET', `${A()}/directory`);
export const addContactLive = (c: Omit<DirContact, 'id' | 'position'>) => api<DirContact>('POST', `${A()}/directory`, c);
export const editContactLive = (id: string, c: { name: string; role: string; phone: string }) => api<DirContact>('PUT', `${A()}/directory/${id}`, c);
export const moveContactLive = (id: string, dir: 'up' | 'down') => api<DirContact[]>('POST', `${A()}/directory/${id}/move`, { dir });
export const removeContactLive = (id: string) => api('DELETE', `${A()}/directory/${id}`);
export const importVendorsLive = () => api<{ added: number; contacts: DirContact[] }>('POST', `${A()}/directory/import-vendors`);
