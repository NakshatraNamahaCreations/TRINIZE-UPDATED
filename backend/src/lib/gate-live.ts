import { EventEmitter } from 'node:events';

/**
 * "Something at the gate just changed" — so an open screen hears about it at once instead of asking again.
 * Whoever changes a visit calls `visitChanged`; the WebSocket routes listen and push to the phones that care:
 * the visitor who made a self check-in (by their ticket) and the guards of that society.
 *
 * Only the fact of a change travels here, never the data: each listener re-reads what it is allowed to see.
 * In-process, so it reaches sockets held by this server process. Run more than one instance and this needs
 * a shared channel (Postgres LISTEN/NOTIFY or Redis) — the screens keep a slow poll as a net either way.
 */
const bus = new EventEmitter();
bus.setMaxListeners(0);

export function visitChanged(v: { associationId: string; selfToken?: string | null }) {
  bus.emit('gate:' + v.associationId);
  if (v.selfToken) bus.emit('ticket:' + v.selfToken);
}

const listen = (topic: string, fn: () => void) => { bus.on(topic, fn); return () => { bus.off(topic, fn); }; };
export const onGate = (associationId: string, fn: () => void) => listen('gate:' + associationId, fn);
export const onTicket = (ticket: string, fn: () => void) => listen('ticket:' + ticket, fn);
export const ticketWatchers = (ticket: string) => bus.listenerCount('ticket:' + ticket);
