import { randomBytes } from 'node:crypto';
import { and, eq, gte, ilike, inArray, isNotNull, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../app.js';
import { associations, DELIVERY_TYPES, gateStickers, unitMembers, units, visits, watchlist } from '../db/schema.js';
import { expireSelfCheckins, SELF_CHECKIN_TTL_MS, selfCheckinExpiresAt, selfCheckinLapsed } from '../lib/checkin-expiry.js';
import { checkinPage } from '../lib/checkin-page.js';
import { notify } from '../lib/community.js';
import { onTicket, ticketWatchers, visitChanged } from '../lib/gate-live.js';
import { conflict, notFound, parse } from '../lib/http.js';
import { accessOf } from '../lib/plans.js';
import { refOf } from './gate.js';

/**
 * Self check-in. A visitor scans the QR sticker at the gate, types their own entry, and watches the
 * flat's answer on their phone; the guard sees the same entry — and the same answer — in the app.
 *
 * Nobody here is signed in, so everything is deliberately narrow:
 *   - the sticker's token names the society; without a working one nothing answers
 *   - a flat is found by its number only — residents' names and phones are never sent
 *   - the visitor's number is not verified, so nothing is decided on it: standing permissions and
 *     the photo on file are for entries a guard makes. The flat is always asked. (The block list
 *     still applies: it only ever refuses.)
 *   - only the visitor's own phone holds the ticket that reads the answer back
 *   - requests are rate-limited, and a flat can only have a few unanswered at a time
 */
const Token = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/) });
const Phone = z.string().regex(/^[6-9]\d{9}$/, 'Mobile numbers have 10 digits and start with 6, 7, 8 or 9');
/** staff and emergency services are let in by the guard, not by a form anyone can fill */
const SELF_TYPES = ['Guest', 'Delivery', 'Cab', 'Vendor'] as const;
const MAX_WAITING_PER_FLAT = 5;
const Ticket = z.object({ ticket: z.string().regex(/^[A-Za-z0-9_-]{32}$/) });
/** one phone, perhaps a second tab: more than that listening to one ticket is not a visitor */
const MAX_SOCKETS_PER_TICKET = 4;

export const checkinRoutes = ({ db }: Deps): FastifyPluginAsync => async app => {
  // unanswered requests are closed when their ten minutes are up; the watching screens are told as it happens
  const sweep = setInterval(() => { void expireSelfCheckins(db).catch(err => app.log.error(err)); }, 15_000);
  sweep.unref();
  app.addHook('onClose', async () => { clearInterval(sweep); });

  const stickerOf = async (params: unknown) => {
    const { token } = parse(Token, params);
    const [s] = await db.select({ associationId: gateStickers.associationId, gate: gateStickers.gate, society: associations.name })
      .from(gateStickers).innerJoin(associations, eq(associations.id, gateStickers.associationId)).where(eq(gateStickers.token, token));
    if (!s) throw notFound('This QR code'); // unknown and cancelled stickers look the same
    const a = await accessOf(db, s.associationId);
    if (a.suspended || !a.features.gate) throw notFound('This QR code');
    return s;
  };

  /** what the visitor's phone may know about its own entry — never who answered, or why */
  const ticketView = (v: typeof visits.$inferSelect, unit: string | null, society: string) => ({
    ref: refOf(v), status: selfCheckinLapsed(v) ? 'Expired' as const : v.status,
    // how long the flat still has to answer — as a duration, so a phone with the wrong time still counts down correctly
    expiresInMs: v.status === 'Pending' ? Math.max(0, selfCheckinExpiresAt(v).getTime() - Date.now()) : null, name: v.name, visitorType: v.visitorType, unit, society, gate: v.gate, people: v.people, vehicle: v.vehicle,
    createdAt: v.createdAt, decidedAt: v.decidedAt, enteredAt: v.enteredAt,
  });

  /** a ticket is for the visit it was made for: it stops answering a day later */
  const readTicket = async (ticket: string) => {
    const [r] = await db.select({ v: visits, unit: units.code, society: associations.name }).from(visits)
      .innerJoin(associations, eq(associations.id, visits.associationId)).leftJoin(units, eq(units.id, visits.unitId))
      .where(and(eq(visits.selfToken, ticket), sql`${visits.createdAt} > now() - interval '24 hours'`));
    return r ? ticketView(r.v, r.unit, r.society) : null;
  };

  /** the page the QR opens */
  app.get('/visit/:token', async (req, reply) => {
    parse(Token, req.params);
    const nonce = randomBytes(16).toString('base64');
    return reply
      .header('content-type', 'text/html; charset=utf-8')
      .header('cache-control', 'no-store')
      // the page's live connection goes to this same host; named outright because not every browser reads 'self' as covering ws://
      .header('content-security-policy', `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'${/^[A-Za-z0-9.-]+(:\d+)?$/.test(req.host) ? ` ws://${req.host} wss://${req.host}` : ''}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`)
      .send(checkinPage(nonce));
  });

  app.get('/v1/checkin/:token', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async req => {
    const s = await stickerOf(req.params);
    return { society: s.society, gate: s.gate, visitorTypes: SELF_TYPES, deliveryTypes: DELIVERY_TYPES };
  });

  /** find the flat by its number; a few matches at most, and nothing about who lives there */
  app.get('/v1/checkin/:token/units', { config: { rateLimit: { max: 40, timeWindow: '1 minute' } } }, async req => {
    const s = await stickerOf(req.params);
    const { q } = parse(z.object({ q: z.string().trim().min(2).max(20) }), req.query);
    const like = '%' + q.replace(/[%_]/g, '') + '%';
    return db.select({ id: units.id, code: units.code, label: units.label }).from(units)
      .where(and(eq(units.associationId, s.associationId), or(ilike(units.code, like), ilike(units.label, like)))).orderBy(units.code).limit(8);
  });

  app.post('/v1/checkin/:token/visits', { config: { rateLimit: { max: 8, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const s = await stickerOf(req.params);
    const b = parse(z.object({
      visitorType: z.enum(SELF_TYPES).default('Guest'), name: z.string().trim().min(2).max(80), phone: Phone, unitId: z.uuid(),
      purpose: z.string().trim().max(200).default(''), people: z.number().int().min(1).max(20).default(1),
      vehicle: z.string().trim().max(20).transform(v => v.toUpperCase().replace(/[^A-Z0-9]/g, '')).optional(),
      deliveryType: z.enum(DELIVERY_TYPES).optional(), partner: z.string().trim().max(40).optional(),
    }), req.body);
    const [unit] = await db.select({ id: units.id, code: units.code }).from(units).where(and(eq(units.id, b.unitId), eq(units.associationId, s.associationId)));
    if (!unit) throw notFound('That flat');

    // one flat cannot be flooded: a few unanswered self check-ins at a time, and one per number
    const waiting = await db.select({ phone: visits.phone }).from(visits)
      .where(and(eq(visits.unitId, unit.id), eq(visits.status, 'Pending'), isNotNull(visits.selfToken), gte(visits.createdAt, new Date(Date.now() - SELF_CHECKIN_TTL_MS))));
    if (waiting.some(w => w.phone === b.phone)) throw conflict('already_waiting', 'A request from this number is already waiting for this flat. Please ask the security guard.');
    if (waiting.length >= MAX_WAITING_PER_FLAT) throw conflict('flat_busy', 'This flat already has several requests waiting. Please ask the security guard.');

    const marks = [eq(watchlist.phone, b.phone), b.vehicle ? eq(watchlist.vehicle, b.vehicle) : undefined].filter(Boolean);
    const [w] = await db.select().from(watchlist).where(and(eq(watchlist.associationId, s.associationId), or(...marks))).orderBy(watchlist.level);
    const kind = b.visitorType === 'Delivery' ? 'delivery' as const : 'visitor' as const;
    const [v] = await db.insert(visits).values({
      associationId: s.associationId, unitId: unit.id, kind, visitorType: b.visitorType, name: b.name, phone: b.phone, purpose: b.purpose, vehicle: b.vehicle || null, people: b.people,
      deliveryType: kind === 'delivery' ? b.deliveryType ?? 'Parcel' : null, partner: b.partner || null, gate: s.gate,
      selfToken: randomBytes(24).toString('base64url'),
      ...(w?.level === 'block'
        ? { status: 'Rejected' as const, decidedVia: 'watchlist' as const, decidedAt: new Date(), decidedByName: 'Watch list', note: 'Blocked: ' + w.reason }
        : { status: 'Pending' as const, flagged: w ? w.reason : null }),
    }).returning();

    if (v!.status === 'Pending') {
      const members = (await db.select({ userId: unitMembers.userId }).from(unitMembers).where(and(eq(unitMembers.unitId, unit.id), eq(unitMembers.status, 'active')))).map(m => m.userId);
      const who = kind === 'delivery' ? `${v!.partner || v!.name} delivery` : v!.name;
      await notify(db, members, {
        kind: 'visitors', href: '/gate/' + v!.id, title: `${who} is at the gate`,
        body: `${b.visitorType}${kind !== 'delivery' && v!.partner ? ' · ' + v!.partner : ''}${b.purpose ? ' · ' + b.purpose : ''}. Checked in by scanning the QR at ${s.gate} — these details are as the visitor typed them. `
          + (kind === 'delivery' ? 'Allow it in, leave it at the gate, or turn it away.' : 'Approve or reject.') + (v!.flagged ? ` Security note: ${v!.flagged}.` : ''),
      });
    }
    visitChanged(v!); // the guards' waiting list shows it at once
    return reply.status(201).header('cache-control', 'no-store').send({ ticket: v!.selfToken, ...ticketView(v!, unit.code, s.society) });
  });

  /** the visitor's phone asks: has the flat answered? */
  app.get('/v1/checkin-status/:ticket', { config: { rateLimit: { max: 40, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { ticket } = parse(Ticket, req.params);
    const view = await readTicket(ticket);
    if (!view) throw notFound('This request');
    reply.header('cache-control', 'no-store');
    return view;
  });

  /**
   * The same answer, pushed: the visitor's page holds this open and is sent the ticket again the moment
   * the flat answers or the guard lets them in — nobody has to refresh. The ticket in the path is the
   * only credential, exactly as for the request above, and the socket only ever sends.
   */
  app.get('/v1/checkin-status/:ticket/live', { websocket: true }, async (socket, req) => {
    let off = () => {};
    const beat = setInterval(() => socket.ping(), 30_000);
    socket.on('error', () => {});
    socket.on('close', () => { off(); clearInterval(beat); });
    const p = Ticket.safeParse(req.params);
    const push = async () => {
      const view = p.success ? await readTicket(p.data.ticket) : null;
      if (view && socket.readyState === socket.OPEN) socket.send(JSON.stringify(view));
      return view;
    };
    try {
      if (!p.success || ticketWatchers(p.data.ticket) >= MAX_SOCKETS_PER_TICKET) return socket.close(4404, 'not found');
      // listen first, then send where things stand: an answer that lands in between is not missed
      off = onTicket(p.data.ticket, () => { void push().catch(() => {}); });
      if (!(await push())) socket.close(4404, 'not found');
    } catch {
      socket.close(1011, 'error');
    }
  });

  /** submitted by mistake, or not coming after all: the visitor withdraws it — until the guard has let them in */
  app.post('/v1/checkin-status/:ticket/cancel', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { ticket } = parse(Ticket, req.params);
    const [v] = await db.update(visits).set({ status: 'Cancelled', note: 'Cancelled by the visitor' })
      .where(and(eq(visits.selfToken, ticket), inArray(visits.status, ['Pending', 'Approved']), sql`${visits.createdAt} > now() - interval '24 hours'`,
        // an unanswered request that has already run out is expired, not cancelled
        sql`(${visits.status} = 'Approved' or ${visits.createdAt} > now() - interval '10 minutes')`)).returning();
    if (!v) throw conflict('not_cancellable', 'This request can no longer be cancelled.');
    visitChanged(v);
    if (v.unitId) {
      // the flat was asked, so it is told there is nothing left to answer
      const members = (await db.select({ userId: unitMembers.userId }).from(unitMembers).where(and(eq(unitMembers.unitId, v.unitId), eq(unitMembers.status, 'active')))).map(m => m.userId);
      await notify(db, members, { kind: 'visitors', href: '/gate/' + v.id, title: `${v.name} cancelled their request`, body: 'They withdrew the gate request themselves. Nothing more to do.' });
    }
    const [r] = await db.select({ unit: units.code, society: associations.name }).from(visits)
      .innerJoin(associations, eq(associations.id, visits.associationId)).leftJoin(units, eq(units.id, visits.unitId)).where(eq(visits.id, v.id));
    reply.header('cache-control', 'no-store');
    return ticketView(v, r?.unit ?? null, r?.society ?? '');
  });
};
