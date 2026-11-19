import type { IconName } from '@/components/Icon';
import { ME, SOCIETY, type Contact, type Discussion, type Gratitude, type Member, type Notif, type NotifPrefs, type NotifTarget, type PrivacyPrefs, type Reply, type Suggestion, type Tone } from '@/store/data';
import { api } from './api';

/* The community side of the API (profile, discussions, gratitude, notifications, household, settings),
   translated into the shapes the screens already draw. Server ids the screens don't show are kept here. */

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function ago(iso: string) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return 'Just now';
  if (mins < 60) return mins + 'm ago';
  if (mins < 1440) return Math.floor(mins / 60) + 'h ago';
  const days = Math.floor(mins / 1440);
  const d = new Date(iso);
  return days === 1 ? 'Yesterday' : days < 7 ? days + ' days ago' : `${d.getDate()} ${MON[d.getMonth()]}`;
}

/* ---------- who is signed in ---------- */
type ApiMe = { user: { id: string; name: string }; unit: { code: string; label: string }; role: 'Owner' | 'Tenant' | 'Family'; society: { name: string; short: string; city: string } };
let myId = '';
/** The app was built around one demo resident; signed in, ME and SOCIETY become the real person and society. */
export async function fetchMe() {
  const m = await api<ApiMe>('GET', '/v1/me');
  myId = m.user.id;
  Object.assign(ME, { name: m.user.name, first: m.user.name.split(' ')[0], unit: m.unit.code, role: m.role, flat: m.unit.label });
  Object.assign(SOCIETY, m.society);
}

/* ---------- discussions ---------- */
type ApiReply = { id: string; text: string; state: 'published' | 'held' | 'hidden'; createdAt: string; authorId: string | null; by: string; unit: string | null; mine: boolean };
type ApiPost = {
  id: string; ref: string; title: string; body: string; state: 'published' | 'held' | 'hidden'; pinned: boolean; createdAt: string; authorId: string | null;
  by: string; unit: string | null; comments: number; reactions: Record<string, number>; myReaction: string | null; mine: boolean; replies?: ApiReply[];
};
const postIds = new Map<string, string>(); // D-232 → server id
const people = new Map<string, string>(); // name → user id, for blocking and thanking by name

const toReply = (r: ApiReply): Reply => {
  if (r.authorId) people.set(r.by, r.authorId);
  return { id: r.id, by: r.by, unit: r.unit ?? '', text: r.text, when: ago(r.createdAt), held: r.state === 'held' };
};
function toPost(p: ApiPost): Discussion {
  postIds.set(p.ref, p.id);
  if (p.authorId) people.set(p.by, p.authorId);
  const likes = Object.values(p.reactions).reduce((a, b) => a + b, 0);
  return {
    id: p.ref, title: p.title, body: p.body, by: p.by, unit: p.unit ?? '', when: ago(p.createdAt), comments: p.comments, likes,
    state: p.state, pinned: p.pinned, myReact: p.myReaction, reacts: p.reactions,
    ...(p.replies ? { thread: p.replies.map(toReply) } : {}),
  };
}

export const fetchPosts = async () => (await api<ApiPost[]>('GET', '/v1/posts')).map(toPost);
export const fetchPost = async (ref: string) => toPost(await api<ApiPost>('GET', `/v1/posts/${ref}`));
export const createPost = async (text: string, confirm: boolean) => toPost(await api<ApiPost>('POST', '/v1/posts', { text, confirm }));
export const deletePost = (ref: string) => api('DELETE', `/v1/posts/${ref}`);
export const createReply = async (ref: string, text: string) => toReply(await api<ApiReply>('POST', `/v1/posts/${ref}/replies`, { text }));
export const deleteReply = (id: string) => api('DELETE', `/v1/replies/${id}`);
export const setReaction = (ref: string, kind: string | null) => api('PUT', `/v1/posts/${ref}/reaction`, { kind });
export const reportItem = (kind: 'post' | 'reply', id: string) => api('POST', '/v1/reports', { targetType: kind, targetId: kind === 'post' ? postIds.get(id) ?? id : id });

export async function fetchBlocked(): Promise<string[]> {
  const rows = await api<{ userId: string; name: string }[]>('GET', '/v1/blocks');
  rows.forEach(b => people.set(b.name, b.userId));
  return rows.map(b => b.name);
}
const idOf = (name: string) => { const id = people.get(name); if (!id) throw new Error('unknown resident'); return id; };
export const blockPerson = (name: string) => api('POST', '/v1/blocks', { userId: idOf(name) });
export const unblockPerson = (name: string) => api('DELETE', `/v1/blocks/${idOf(name)}`);

/* ---------- gratitude ---------- */
let neighbourList: string[] = [];
/** "Arjun Mehta (T1-1503)" for everyone else in the society — who a thank-you can be addressed to */
export const neighbourLabels = () => neighbourList;
type ApiGrat = { by: string; to: string; category: string; text: string; createdAt: string; mine: boolean };
export async function fetchGratitudes(): Promise<Gratitude[]> {
  const [list, neighbours] = await Promise.all([api<ApiGrat[]>('GET', '/v1/gratitudes'), api<{ id: string; name: string; unit: string }[]>('GET', '/v1/neighbours')]);
  neighbours.forEach(n => people.set(n.name, n.id));
  neighbourList = neighbours.map(n => `${n.name} (${n.unit})`);
  return list.map(g => ({ by: g.by, to: g.to, cat: g.category, text: g.text, when: ago(g.createdAt) }));
}
/** "Arjun Mehta (T1-1503)" thanks that resident privately; a label like "Security team" has no person behind it */
export function sendGratitudeLive(text: string, cat: string, to: string) {
  const toUserId = people.get(to.replace(/\s*\(.*\)$/, ''));
  return api<{ state: 'sent' | 'held' }>('POST', '/v1/gratitudes', { text, category: cat, toLabel: to, toUserId });
}

/* ---------- notifications ---------- */
type ApiNotif = { id: string; kind: 'announcements' | 'events' | 'polls' | 'discussions' | 'gratitude' | 'issues'; title: string; body: string; href: string | null; read: boolean; createdAt: string };
const LOOK: Record<ApiNotif['kind'], [IconName, string, string, NotifTarget]> = {
  announcements: ['megaphone-outline', '#E3F3FC', '#0369A1', 'home'],
  events: ['calendar-outline', '#E4F7EE', '#067647', 'events'],
  polls: ['bar-chart-outline', '#EEF0FE', '#4F46E5', 'polls'],
  discussions: ['chatbubbles-outline', '#F1ECFE', '#7C55F7', 'home'],
  gratitude: ['heart-outline', '#F1ECFE', '#7C55F7', 'home'],
  issues: ['construct-outline', '#FEF0DC', '#B54708', 'issues'],
};
/** server notifications get ids from here up, clear of the ones the app raises itself */
export const SERVER_NOTIF_BASE = 100_000;
const notifIds = new Map<number, string>();
export async function fetchNotifs(): Promise<Notif[]> {
  const list = await api<ApiNotif[]>('GET', '/v1/notifications');
  notifIds.clear();
  return list.map((n, i) => {
    const id = SERVER_NOTIF_BASE + i;
    notifIds.set(id, n.id);
    const [icon, c, tc, goTo] = LOOK[n.kind];
    return { id, icon, c, tc, t: n.title, s: n.body, when: ago(n.createdAt), unread: !n.read, goTo, href: n.href ?? undefined };
  });
}
export const readNotifLive = (id: number) => { const sid = notifIds.get(id); return sid ? api('POST', `/v1/notifications/${sid}/read`) : Promise.resolve(); };
export const readAllNotifsLive = () => api('POST', '/v1/notifications/read-all');

/* ---------- settings ---------- */
export const fetchSettings = () => api<{ notif: NotifPrefs; privacy: PrivacyPrefs }>('GET', '/v1/settings');
export const saveSettings = (patch: { notif?: Partial<NotifPrefs>; privacy?: Partial<PrivacyPrefs> }) => api('PUT', '/v1/settings', patch);

/* ---------- household ---------- */
type ApiMember = { id: string; name: string; phone: string | null; role: 'Owner' | 'Tenant' | 'Family'; status: 'active' | 'pending'; you: boolean };
const toMember = (m: ApiMember): Member => ({ id: m.id, name: m.name, rel: m.role === 'Owner' ? 'Owner' : m.role === 'Tenant' ? 'Tenant' : 'Other', phone: m.phone ? m.phone.slice(0, 5) + ' ' + m.phone.slice(5) : '', you: m.you, pending: m.status === 'pending' });
export const fetchFamily = async () => (await api<ApiMember[]>('GET', '/v1/family')).map(toMember);
export const addMemberLive = async (m: Pick<Member, 'name' | 'rel' | 'phone'>) =>
  toMember(await api<ApiMember>('POST', '/v1/family', { name: m.name, phone: m.phone.replace(/\D/g, ''), role: m.rel === 'Tenant' ? 'Tenant' : 'Family' }));
export const removeMemberLive = (id: string) => api('DELETE', `/v1/family/${id}`);

/* ---------- event ideas ---------- */
type ApiSug = { id: string; title: string; when: string; where: string; note: string; status: 'pending' | 'approved' | 'declined' };
export const fetchSuggestions = async () => (await api<ApiSug[]>('GET', '/v1/event-suggestions')).map(s => s as unknown as Suggestion);
export const suggestLive = async (s: Omit<Suggestion, 'id' | 'status'>) => (await api<ApiSug>('POST', '/v1/event-suggestions', s)) as unknown as Suggestion;

/* ---------- directory ---------- */
type ApiContact = { name: string; role: string; phone: string };
const TINTS: [string, string][] = [['#E3F3FC', '#0369A1'], ['#EEF0FE', '#4F46E5'], ['#E4F7EE', '#067647'], ['#FEF0DC', '#B54708']];
export async function fetchDirectory() {
  const d = await api<{ committee: ApiContact[]; emergency: ApiContact[]; vendors: ApiContact[] }>('GET', '/v1/directory');
  const tint = (list: ApiContact[], fixed?: [string, string]): Contact[] =>
    list.map((c, i) => { const [bg, fg] = fixed ?? TINTS[i % TINTS.length]; return { n: c.name, r: c.role, ph: c.phone, c: bg, tc: fg }; });
  return { committee: tint(d.committee), emergency: tint(d.emergency, ['#FDE9E7', '#B42318']), vendors: tint(d.vendors) };
}

/* ---------- composer & account ---------- */
export const rewriteLive = async (text: string, tone: Tone) => (await api<{ text: string }>('POST', '/v1/assistant/rewrite', { text, tone })).text;
export const exportLive = () => api<Record<string, unknown>>('GET', '/v1/me/export');
export const deleteAccountLive = () => api('DELETE', '/v1/me');
export const isMe = (id: string) => id === myId;

export type Impact = { days: number; streak: number; best: number; last14: boolean[]; chats: number; recentQuestions: string[] };

/** The community side, in one go — joins fetchAll() from live.ts on every sync. */
export async function fetchCommunity() {
  await fetchMe(); // first: "mine" checks across the screens compare against ME
  const [discussions, gratitudes, notifs, settings, family, suggestions, directory, blocked, impact] = await Promise.all([
    fetchPosts(), fetchGratitudes(), fetchNotifs(), fetchSettings(), fetchFamily(), fetchSuggestions(), fetchDirectory(), fetchBlocked(),
    // asking also marks today as a day the app was opened
    api<Impact>('POST', '/v1/me/impact').catch(() => null),
  ]);
  return { discussions, gratitudes, notifs, settings, family, suggestions, directory, blocked, impact, who: { me: { ...ME }, society: { ...SOCIETY } } };
}
