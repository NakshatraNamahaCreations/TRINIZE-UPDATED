import { Platform } from 'react-native';
import type { IconName } from '@/components/Icon';
import type { Announcement, CommunityEvent, Issue, IssueStatus, PastEvent, Poll, Priority } from '@/store/data';
import { fmtDay } from '@/store/dates';
import { api, API_URL, ApiError, currentAccess } from './api';

/* The server's records, translated into the shapes the screens already draw. The store keeps using
   the short refs the app shows (AN-118, ISS-1043); the server ids needed for writes are remembered here. */

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const time = (d: Date) => `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
const dm = (d: Date) => `${d.getDate()} ${MON[d.getMonth()]}`;
const stamp = (iso: string) => { const d = new Date(iso); return `${dm(d)}, ${time(d)}`; };
/** "Just now", "2h ago", "Yesterday", "3 days ago", then the date */
function ago(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return 'Just now';
  if (mins < 60) return mins + 'm ago';
  if (mins < 1440) return Math.floor(mins / 60) + 'h ago';
  const days = Math.floor(mins / 1440);
  return days === 1 ? 'Yesterday' : days < 7 ? days + ' days ago' : dm(new Date(iso));
}
const localIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/* ---------- issues ---------- */
type ApiIssue = {
  ref: string; title: string; category: string; location: string; priority: Priority; status: IssueStatus; slaDueAt: string; createdAt: string;
  reporter: string | null; unit: string | null; vendor: string | null; mine?: boolean; slaState: 'ok' | 'over' | 'met';
  timeline: { status: IssueStatus; note: string | null; at: string }[]; updates: { text: string; photoUrl: string | null; at: string }[];
};

function toIssue(i: ApiIssue): Issue {
  const due = new Date(i.slaDueAt);
  return {
    id: i.ref, title: i.title, cat: i.category, loc: i.location, pri: i.priority, by: i.reporter ?? '—', unit: i.unit ?? '—', mine: i.mine ?? true,
    when: ago(i.createdAt), status: i.status, vendor: i.vendor ?? '—',
    sla: i.slaState === 'met' ? 'Resolved' : i.slaState === 'over' ? 'Past the response time' : `Response due ${dm(due)}, ${time(due)}`,
    slaState: i.slaState,
    tl: i.timeline.map(e => ({ s: e.status, w: stamp(e.at), n: e.note ?? undefined })),
    internal: [],
    updates: i.updates.map(u => ({ text: u.text, when: ago(u.at), photo: u.photoUrl ?? undefined })),
  };
}

export const fetchIssues = async () => (await api<ApiIssue[]>('GET', '/v1/issues')).map(toIssue);

/** A picked photo lives on the phone; the ticket needs it on the server. */
export async function uploadPhoto(uri: string): Promise<string> {
  if (uri.startsWith(API_URL + '/files/')) return uri; // already uploaded
  const form = new FormData();
  if (Platform.OS === 'web') form.append('file', await (await fetch(uri)).blob(), 'photo.jpg');
  else form.append('file', { uri, name: 'photo.jpg', type: 'image/jpeg' } as unknown as Blob);
  // FormData can't go through api(): fetch must set the multipart boundary itself
  // a cheap authenticated call first, so an expired token is refreshed before the upload — one every role may make
  // (residents, property managers and guards all upload photos)
  await api('GET', '/v1/notifications');
  const accessToken = currentAccess();
  const res = await fetch(API_URL + '/v1/uploads', { method: 'POST', headers: { authorization: 'Bearer ' + accessToken }, body: form }).catch(() => null);
  const j = res ? await res.json().catch(() => null) : null;
  if (!res?.ok) throw new ApiError(res?.status ?? 0, j?.error?.code ?? 'upload_failed', j?.error?.message ?? 'The photo couldn’t be uploaded. Try again.');
  return j.url as string;
}
export async function createIssueLive(o: { title: string; desc?: string; cat: string; loc: string; pri: Priority; via: 'chat' | 'form'; photo?: string }): Promise<Issue> {
  const photoUrl = o.photo ? await uploadPhoto(o.photo) : undefined;
  return toIssue(await api<ApiIssue>('POST', '/v1/issues', {
    title: o.title.trim().slice(0, 120), details: o.desc?.trim() || undefined, category: o.cat, location: o.loc, priority: o.pri, via: o.via, photoUrl,
  }));
}
export async function addIssueUpdateLive(ref: string, text: string, photo?: string): Promise<Issue> {
  const photoUrl = photo ? await uploadPhoto(photo) : undefined;
  return toIssue(await api<ApiIssue>('POST', `/v1/issues/${ref}/updates`, { text, photoUrl }));
}
export const reopenIssueLive = async (ref: string, reason: string) => toIssue(await api<ApiIssue>('POST', `/v1/issues/${ref}/reopen`, { reason }));
export const rateIssueLive = (ref: string, stars: number) => api('POST', `/v1/issues/${ref}/rating`, { stars });
/** "yes, it's fixed": Resolved → Closed */
export const confirmIssueLive = async (ref: string) => toIssue(await api<ApiIssue>('POST', `/v1/issues/${ref}/confirm`));
/** a request about shared equipment or space (lift, STP, generator…) — it belongs to no flat */
export async function createCommonIssueLive(o: { title: string; desc?: string; cat: string; asset: string; loc?: string; pri: Priority; photo?: string }): Promise<Issue> {
  const photoUrl = o.photo ? await uploadPhoto(o.photo) : undefined;
  return toIssue(await api<ApiIssue>('POST', '/v1/issues/common', { title: o.title.trim().slice(0, 120), details: o.desc?.trim() || undefined, category: o.cat, asset: o.asset, location: o.loc || undefined, priority: o.pri, photoUrl }));
}
export type IssueMessage = { id: string; from: 'resident' | 'staff' | 'vendor'; text: string; at: string };
export const fetchIssueMessages = (ref: string) => api<IssueMessage[]>('GET', `/v1/issues/${ref}/messages`);
export const sendIssueMessage = (ref: string, text: string) => api<IssueMessage[]>('POST', `/v1/issues/${ref}/messages`, { text });

/* ---------- notices ---------- */
type ApiAnn = { id: string; ref: string; title: string; body: string; priority: 'High' | 'Normal'; audience: string; requiresAck: boolean; by: string; icon: string; publishedAt: string; acked: boolean;
  pinned?: boolean; expiresAt?: string | null; attachmentUrl?: string | null; attachmentName?: string | null };
const annIds = new Map<string, string>();

export async function fetchAnnouncements(): Promise<Announcement[]> {
  const list = await api<ApiAnn[]>('GET', '/v1/announcements');
  return list.map(a => {
    annIds.set(a.ref, a.id);
    return { id: a.ref, title: a.title, body: a.body, pri: a.priority, aud: a.audience, when: ago(a.publishedAt), by: a.by, ack: a.requiresAck, acked: a.acked, read: 0, icon: a.icon as IconName,
      pinned: !!a.pinned, until: a.expiresAt ? new Date(a.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : undefined,
      attach: a.attachmentUrl ? { url: a.attachmentUrl, name: a.attachmentName || '' } : undefined };
  });
}
/** the resident opened the notice — what the office's read report counts */
export const seenLive = (ref: string) => { const id = annIds.get(ref); return id ? api('POST', `/v1/announcements/${id}/seen`).catch(() => {}) : Promise.resolve(); };
export const ackLive = (ref: string) => api('POST', `/v1/announcements/${annIds.get(ref) ?? ref}/ack`);

/* ---------- events ---------- */
type ApiEvent = { id: string; title: string; description: string; location: string; startsAt: string; minutes: number; capacity: number; icon: string; going: number; mine: 'Going' | 'Waitlist' | null };
const whenOf = (iso: string) => { const d = new Date(iso); return `${fmtDay(d)} · ${time(d)}`; };

export async function fetchEvents(): Promise<{ events: CommunityEvent[]; pastEvents: PastEvent[] }> {
  const [up, past] = await Promise.all([api<ApiEvent[]>('GET', '/v1/events'), api<ApiEvent[]>('GET', '/v1/events?scope=past')]);
  return {
    events: up.map(e => ({ id: e.id, title: e.title, when: whenOf(e.startsAt), where: e.location, cap: e.capacity, going: e.going, mine: e.mine, icon: e.icon as IconName, desc: e.description, at: localIso(new Date(e.startsAt)), mins: e.minutes })),
    pastEvents: past.map(e => ({ id: e.id, title: e.title, when: whenOf(e.startsAt), where: e.location, attended: e.going, icon: e.icon as IconName })),
  };
}
export const rsvpLive = (id: string) => api<{ status: 'Going' | 'Waitlist' }>('POST', `/v1/events/${id}/rsvp`);
export const unrsvpLive = (id: string) => api('DELETE', `/v1/events/${id}/rsvp`);

/* ---------- polls ---------- */
type ApiPoll = { id: string; question: string; eligibility: 'all' | 'owners'; closesAt: string; closed: boolean; options: { id: string; label: string; votes: number }[]; myOptionId: string | null };
const optionIds = new Map<string, string[]>();

export async function fetchPolls(): Promise<Poll[]> {
  const list = await api<ApiPoll[]>('GET', '/v1/polls');
  return list.map(p => {
    optionIds.set(p.id, p.options.map(o => o.id));
    return {
      id: p.id, q: p.question, opts: p.options.map(o => ({ t: o.label, v: o.votes })),
      mine: p.options.find(o => o.id === p.myOptionId)?.label ?? null,
      closes: (p.closed ? 'Closed ' : 'Closes ') + dm(new Date(p.closesAt)),
      elig: p.eligibility === 'owners' ? 'Owners only · one vote per unit' : 'All residents · one vote per unit',
      closed: p.closed, closesAt: localIso(new Date(p.closesAt)),
    };
  });
}
export const voteLive = (pollId: string, index: number) => api('POST', `/v1/polls/${pollId}/vote`, { optionId: optionIds.get(pollId)?.[index] });

/* ---------- assistant ---------- */
export type AssistantReply = {
  text: string; source: string | null; chips?: string[]; calls?: [string, string][]; link?: { label: string; href: string }; offer?: 'ask_office';
  /** the server's safety check found it rude: not answered, not kept — hand it back to be rephrased */
  flagged?: { level: 'warn' | 'block'; words: string[] };
};
/** the assistant could not answer: pass the question to the society office as a message */
export const askOffice = (text: string) => api<{ conversationId: string }>('POST', '/v1/assistant/ask-office', { text });
export const askAssistant = (text: string) => api<AssistantReply>('POST', '/v1/assistant/chat', { text });
export const clearAssistantHistory = () => api('DELETE', '/v1/assistant/history');
export type HistoryTurn = { role: 'user' | 'assistant'; text: string };
export type HistoryItem = HistoryTurn & { id: string; source: string | null; createdAt: string };
/** one page of the stored conversation, newest first; `cursor` (from the page before) wins over `before` */
export const fetchAssistantHistory = (at: { cursor: string } | { before: string }, limit = 20) =>
  api<{ items: HistoryItem[]; nextCursor: string | null }>('GET', `/v1/assistant/history?limit=${limit}&` +
    ('cursor' in at ? 'cursor=' + encodeURIComponent(at.cursor) : 'before=' + encodeURIComponent(at.before)));
/** turns of the in-app issue-report conversation, so the server's history is the whole chat */
export const logAssistantTurns = (messages: HistoryTurn[]) => api('POST', '/v1/assistant/history', { messages });

/** Everything the server owns, in one go — on sign-in, app start and pull-to-refresh. */
export async function fetchAll() {
  const [issues, announcements, ev, polls] = await Promise.all([fetchIssues(), fetchAnnouncements(), fetchEvents(), fetchPolls()]);
  return { issues, announcements, ...ev, polls };
}
