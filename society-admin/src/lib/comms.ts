import { api, upload } from './api';
import { association } from './live';

/* The communication hub, from the office: compose and schedule messages, see what happened to every
   copy, and talk to residents one to one. Connected mode only. */

const A = () => `/v1/admin/${association()}`;

export const TYPES = ['Announcement', 'Reminder', 'Notice', 'Emergency', 'Offer', 'Event'] as const;
export type MessageType = (typeof TYPES)[number];
export const CHANNELS = [
  ['portal', 'Notice board', 'Shown in the app until it expires'],
  ['push', 'App alert', 'In-app alert; lock-screen push needs a push service'],
  ['email', 'Email', 'Needs a mail provider; only residents with an email'],
] as const;
export type Channel = (typeof CHANNELS)[number][0];
// messages sent before WhatsApp and SMS were taken out still say how they went
export const CHANNEL_NAME: Record<string, string> = { ...Object.fromEntries(CHANNELS.map(c => [c[0], c[1]])), whatsapp: 'WhatsApp', sms: 'SMS' };
export type Audience =
  | { kind: 'all' } | { kind: 'towers'; towers: string[] } | { kind: 'units'; unitIds: string[] }
  | { kind: 'role'; role: 'Owner' | 'Tenant' | 'Family' } | { kind: 'residents'; userIds: string[] };
export type Stats = { recipients: number; reached: number; logged: number; skipped: number; failed: number; onBoard: number; read: number };
export type Message = {
  id: string; ref: string; type: MessageType; title: string; body: string; priority: 'Normal' | 'Important' | 'Emergency'; channels: Channel[]; audience: Audience; audienceLabel: string;
  attachmentUrl: string | null; attachmentName: string | null; promotional: boolean; requiresAck: boolean; startsAt: string | null; expiresAt: string | null; pinned: boolean;
  status: 'Draft' | 'Scheduled' | 'Sent' | 'Cancelled'; scheduledAt: string | null; sentAt: string | null; source: string; announcementId: string | null; byName: string; createdAt: string;
  expired: boolean; stats: Stats;
};
export type Delivery = { userId: string; name: string; unit: string | null; channel: Channel; status: 'Delivered' | 'Sent' | 'Logged' | 'Skipped' | 'Failed'; detail: string; sentAt: string; readAt: string | null };
export type AudienceInfo = {
  total: number; towers: { name: string; residents: number }[]; roles: { role: 'Owner' | 'Tenant' | 'Family'; residents: number }[];
  units: { id: string; code: string; tower: string; residents: number }[]; residents: { id: string; name: string; unit: string; role: string; hasEmail: boolean; hasPhone: boolean }[];
  reach: { email: number; phone: number };
};
export type Draft = {
  type: MessageType; title: string; body: string; priority: Message['priority']; channels: Channel[]; audience: Audience; attachmentUrl?: string | null; attachmentName?: string | null;
  promotional: boolean; requiresAck: boolean; startsAt?: string | null; expiresAt?: string | null; pinned: boolean; action: 'send' | 'schedule' | 'draft'; scheduledAt?: string | null;
};
export type Report = {
  days: number; totals: { sent: number; scheduled: number; drafts: number }; readRate: number | null;
  byChannel: { channel: Channel; total: number; reached: number; logged: number; skipped: number; failed: number; read: number }[];
  byType: { type: string; messages: number; on_board: number; read: number }[]; byTower: { tower: string; notices: number }[];
  problems: { ref: string; title: string; name: string; channel: Channel; status: string; detail: string; sent_at: string }[];
};
export type Conversation = { id: string; subject: string; topic: string; status: 'Open' | 'Closed'; lastMessageAt: string; preview: string; lastFrom: 'resident' | 'staff' | null; unread: number; resident: string; unit: string | null; userId: string };
export type Thread = Conversation & { messages: { id: string; from: 'resident' | 'staff'; by: string; text: string; attachmentUrl: string | null; at: string; readAt: string | null }[] };
export type Filter = { status?: string; channel?: string; type?: string; q?: string };

export const audienceInfo = () => api<AudienceInfo>('GET', `${A()}/comms/audience`);
export const countAudience = (audience: Audience) => api<{ residents: number; withEmail: number; withPhone: number; label: string }>('POST', `${A()}/comms/audience/count`, { audience });
export const polish = (text: string, tone: string) => api<{ text: string; by: 'ai' | 'rules' }>('POST', `${A()}/comms/polish`, { text, tone });
export const messages = (f: Filter) => {
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
  return api<Message[]>('GET', `${A()}/comms/messages${qs ? '?' + qs : ''}`);
};
export const message = (id: string) => api<Message & { deliveries: Delivery[] }>('GET', `${A()}/comms/messages/${id}`);
export const create = (d: Draft) => api<Message>('POST', `${A()}/comms/messages`, d);
export const sendNow = (id: string) => api<Message>('POST', `${A()}/comms/messages/${id}/send`);
export const cancel = (id: string) => api<Message>('POST', `${A()}/comms/messages/${id}/cancel`);
export const board = (id: string, o: { pinned?: boolean; expireNow?: boolean }) => api<Message>('POST', `${A()}/comms/messages/${id}/board`, o);
export const report = (days = 30) => api<Report>('GET', `${A()}/comms/report?days=${days}`);
export const attach = (file: File) => upload(file);

export const conversations = (status?: 'Open' | 'Closed') => api<Conversation[]>('GET', `${A()}/conversations${status ? '?status=' + status : ''}`);
export const thread = (id: string) => api<Thread>('GET', `${A()}/conversations/${id}`);
export const reply = (id: string, text: string) => api<Thread>('POST', `${A()}/conversations/${id}/messages`, { text });
export const setStatus = (id: string, status: 'Open' | 'Closed') => api<Thread>('POST', `${A()}/conversations/${id}/status`, { status });
export const startConversation = (o: { userId: string; subject: string; topic: string; text: string }) => api<Thread>('POST', `${A()}/conversations`, o);

export function time(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso), today = d.toDateString() === new Date().toDateString();
  return d.toLocaleString('en-IN', today ? { hour: 'numeric', minute: '2-digit' } : { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}
