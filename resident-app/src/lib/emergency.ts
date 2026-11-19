import { api } from './api';

/* SOS: raise an emergency alert to security and the society office, see who responded, and the
   numbers to call. Works for residents and for guards. Connected mode only. */

export const KINDS = ['Medical', 'Fire', 'Security', 'Lift', 'Other'] as const;
export type Kind = (typeof KINDS)[number];
export type Incident = { id: string; kind: Kind; by: string; role: 'resident' | 'guard'; unit: string | null; place: string; note: string; status: 'Open' | 'Acknowledged' | 'Resolved'; ackByName: string | null; resolution: string; createdAt: string };
export type Emergency = { contacts: { name: string; role: string; phone: string }[]; open: Incident[] };

export const emergency = () => api<Emergency>('GET', '/v1/emergency');
export const raiseSos = (kind: Kind, note: string) => api<Incident>('POST', '/v1/sos', { kind, note });
export const respond = (id: string) => api<Incident>('POST', `/v1/emergency/${id}/ack`);
export const KIND_ICON = { Medical: 'medkit', Fire: 'flame', Security: 'shield', Lift: 'swap-vertical', Other: 'alert-circle' } as const;
