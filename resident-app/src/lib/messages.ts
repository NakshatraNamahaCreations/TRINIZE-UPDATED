import { api, LIVE } from './api';

/* Direct messages between a resident and the society office. In demo mode (no API) they are kept
   in memory with one sample conversation, so the screens can be tried. */

export const TOPICS = ['General', 'Rent & dues', 'Maintenance', 'Documents', 'Complaint'] as const;
export type Topic = (typeof TOPICS)[number];
export type Conversation = { id: string; subject: string; topic: Topic; status: 'Open' | 'Closed'; lastMessageAt: string; preview: string; lastFrom: 'resident' | 'staff' | null; unread: number };
export type ChatMessage = { id: string; from: 'resident' | 'staff'; by: string; text: string; attachmentUrl: string | null; at: string; readAt: string | null };
export type Thread = Conversation & { messages: ChatMessage[] };

const ago = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
let demo: Thread[] = [{
  id: 'c1', subject: 'Receipt for October', topic: 'Rent & dues', status: 'Open', lastMessageAt: ago(20), preview: 'Attached. Let us know if anything is missing.', lastFrom: 'staff', unread: 1,
  messages: [
    { id: 'm1', from: 'resident', by: 'You', text: 'Could I get a copy of my October maintenance receipt?', attachmentUrl: null, at: ago(26), readAt: ago(22) },
    { id: 'm2', from: 'staff', by: 'Sanjana Rao (Secretary)', text: 'Of course — it has been emailed to you. Let us know if anything is missing.', attachmentUrl: null, at: ago(20), readAt: null },
  ],
}];
const head = ({ messages: _m, ...c }: Thread): Conversation => c;

export async function conversations(): Promise<Conversation[]> {
  return LIVE ? api<Conversation[]>('GET', '/v1/conversations') : demo.map(head);
}
export async function thread(id: string): Promise<Thread> {
  if (LIVE) return api<Thread>('GET', '/v1/conversations/' + id);
  const c = demo.find(x => x.id === id);
  if (!c) throw new Error('not found');
  c.unread = 0;
  return { ...c };
}
export async function startConversation(o: { subject: string; topic: Topic; text: string }): Promise<Thread> {
  if (LIVE) return api<Thread>('POST', '/v1/conversations', o);
  const now = new Date().toISOString();
  const c: Thread = { id: 'c' + Date.now(), subject: o.subject, topic: o.topic, status: 'Open', lastMessageAt: now, preview: o.text, lastFrom: 'resident', unread: 0,
    messages: [{ id: 'm' + Date.now(), from: 'resident', by: 'You', text: o.text, attachmentUrl: null, at: now, readAt: null }] };
  demo = [c, ...demo];
  return c;
}
export async function reply(id: string, text: string): Promise<Thread> {
  if (LIVE) return api<Thread>('POST', `/v1/conversations/${id}/messages`, { text });
  const c = demo.find(x => x.id === id)!;
  const now = new Date().toISOString();
  c.messages = [...c.messages, { id: 'm' + Date.now(), from: 'resident', by: 'You', text, attachmentUrl: null, at: now, readAt: null }];
  Object.assign(c, { lastMessageAt: now, preview: text, lastFrom: 'resident', status: 'Open' });
  return { ...c };
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function when(iso: string) {
  const d = new Date(iso), time = `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${d.getHours() < 12 ? 'AM' : 'PM'}`;
  return d.toDateString() === new Date().toDateString() ? time : `${d.getDate()} ${MON[d.getMonth()]}, ${time}`;
}
