import { and, desc, eq, gte, ilike, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../app.js';
import type { DB } from '../db/client.js';
import {
  associations, DELIVERY_TYPES, frequentVisitors, gateStickers, refreshTokens, staffRoles, unitMembers, units, users, visits, VISITOR_TYPES, watchlist,
  type DecidedVia, type VisitStatus,
} from '../db/schema.js';
import { audit } from '../lib/audit.js';
import { residentOf, staffOf, userIdFrom } from '../lib/auth.js';
import { notify } from '../lib/community.js';
import { expireSelfCheckins, selfCheckinLapsed } from '../lib/checkin-expiry.js';
import { onGate, visitChanged } from '../lib/gate-live.js';
import { randomBytes } from 'node:crypto';
import { sixDigits } from '../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound, parse } from '../lib/http.js';
import { likeOf, offsetOf, paged, PageQuery } from '../lib/paging.js';

const Id = z.object({ id: z.uuid() });
const Phone = z.string().regex(/^[6-9]\d{9}$/, 'Mobile numbers have 10 digits and start with 6, 7, 8 or 9');
const Vehicle = z.string().trim().max(20).transform(v => v.toUpperCase().replace(/[^A-Z0-9]/g, '')).optional();
const DAY = 864e5;
const fourDigits = () => sixDigits().slice(0, 4);

type Visit = typeof visits.$inferSelect;
type Viewer = 'resident' | 'guard' | 'admin';

/** the short code on a self check-in: the visitor's screen and the guard's list both show it, so the guard can match the phone to the entry */
export const refOf = (v: { id: string }) => v.id.replace(/-/g, '').slice(-4).toUpperCase();

/** What each side may see. The guard never sees the codes a resident shows them; the office sees neither. Nobody is sent the visitor's own ticket. */
function out(v: Visit, unit: { code: string; label: string } | null, viewer: Viewer) {
  // a pass past its time, or a self check-in nobody answered in time (the sweep stores that within seconds; this covers the gap)
  const expired = (v.status === 'Expected' && !!v.validUntil && v.validUntil.getTime() < Date.now()) || selfCheckinLapsed(v);
  const { passCode, collectCode, selfToken, associationId: _a, createdBy: _c, decidedBy: _d, guardId: _g, ...rest } = v;
  return {
    ...rest, status: (expired ? 'Expired' : v.status) as VisitStatus, unit: unit?.code ?? null, unitLabel: unit?.label ?? null,
    selfCheckIn: !!selfToken, ref: selfToken ? refOf(v) : null,
    ...(viewer === 'resident' ? { passCode, collectCode } : {}),
  };
}

/**
 * Visitor & delivery management.
 *   /v1/gate/*            the guard at the gate (mobile app; created by the society office)
 *   /v1/visits, /v1/frequent-visitors   the resident
 *   /v1/admin/:aid/visits|guards|watchlist   the society office (admin or VPM)
 */
export const gateRoutes = ({ config, db }: Deps): FastifyPluginAsync => async app => {
  const uid = (req: FastifyRequest) => userIdFrom(req, config.JWT_SECRET);

  /** the guard's post: which society, which gate */
  const guardOf = async (req: FastifyRequest) => {
    const userId = await uid(req);
    const [g] = await db.select({ userId: users.id, name: users.name, associationId: staffRoles.associationId, gate: staffRoles.title })
      .from(staffRoles).innerJoin(users, eq(users.id, staffRoles.userId))
      .where(and(eq(staffRoles.userId, userId), eq(staffRoles.role, 'guard'), isNull(users.deletedAt)));
    if (!g?.associationId) throw forbidden('This number isn’t set up as a security guard.');
    return { userId: g.userId, name: g.name, associationId: g.associationId, gate: g.gate ?? 'Main gate' };
  };

  const withUnit = (where: ReturnType<typeof and>, limit = 200) =>
    db.select({ v: visits, code: units.code, label: units.label }).from(visits).leftJoin(units, eq(units.id, visits.unitId)).where(where).orderBy(desc(visits.createdAt)).limit(limit);
  const shape = (rows: { v: Visit; code: string | null; label: string | null }[], viewer: Viewer) =>
    rows.map(r => out(r.v, r.code ? { code: r.code, label: r.label! } : null, viewer));
  const one = async (id: string, associationId: string) => {
    const [r] = await withUnit(and(eq(visits.id, id), eq(visits.associationId, associationId)), 1);
    if (!r) throw notFound('That entry');
    return r;
  };
  const membersOf = async (unitId: string) =>
    (await db.select({ userId: unitMembers.userId }).from(unitMembers).where(and(eq(unitMembers.unitId, unitId), eq(unitMembers.status, 'active')))).map(m => m.userId);
  const tell = async (v: Visit, title: string, body: string) => {
    if (v.unitId) await notify(db, await membersOf(v.unitId), { kind: 'visitors', title, body, href: '/gate/' + v.id });
  };
  const what = (v: Pick<Visit, 'kind' | 'name' | 'partner' | 'deliveryType'>) =>
    v.kind === 'delivery' ? `${v.partner || v.name}${v.deliveryType ? ' · ' + v.deliveryType.toLowerCase() : ''} delivery` : v.name;

  /** approve / reject / leave at gate — the same rule whoever decides */
  const decide = async (v: Visit, decision: 'approve' | 'reject' | 'gate', by: { userId: string; name: string }, via: DecidedVia, note = '') => {
    if (selfCheckinLapsed(v)) {
      await expireSelfCheckins(db);
      throw conflict('request_expired', 'This request has expired — it waited more than 10 minutes. The visitor needs to ask again.');
    }
    if (v.status === 'Expired') throw conflict('request_expired', 'This request has expired. The visitor needs to ask again.');
    if (v.status !== 'Pending') throw conflict('already_decided', v.status === 'Expected' ? 'This visitor already has a pass.' : 'This request has already been answered.');
    if (decision === 'gate' && v.kind !== 'delivery') throw badRequest('not_a_delivery', 'Only a delivery can be left at the gate.');
    const status: VisitStatus = decision === 'approve' ? 'Approved' : decision === 'reject' ? 'Rejected' : 'AtGate';
    const [u] = await db.update(visits).set({
      status, decidedBy: by.userId, decidedByName: by.name, decidedVia: via, decidedAt: new Date(),
      collectCode: status === 'AtGate' ? fourDigits() : null, note: note || v.note,
    }).where(and(eq(visits.id, v.id), eq(visits.status, 'Pending'))).returning();
    if (!u) throw conflict('already_decided', 'This request has already been answered.');
    visitChanged(u); // the visitor's phone and the guards' screens hear at once
    return u;
  };

  /** the newest photo the gate has taken of whoever uses this number */
  const photoOnFile = async (associationId: string, phone: string) => (await db.select({ photoUrl: visits.photoUrl }).from(visits)
    .where(and(eq(visits.associationId, associationId), eq(visits.phone, phone), sql`${visits.photoUrl} is not null`)).orderBy(desc(visits.createdAt)).limit(1))[0]?.photoUrl ?? null;

  /* ======================= the guard ======================= */
  app.get('/gate/me', async req => {
    const g = await guardOf(req);
    // a parcel the flat asked to be left counts as waiting until security has actually taken it
    const counts = await db.select({ status: sql<string>`case when ${visits.status} = 'AtGate' and ${visits.keptAt} is null then 'Handover' else ${visits.status} end`, n: sql<number>`count(*)::int` }).from(visits)
      .where(and(eq(visits.associationId, g.associationId), inArray(visits.status, ['Pending', 'Approved', 'Inside', 'AtGate']))).groupBy(sql`1`);
    const n = (s: VisitStatus | 'Handover') => counts.find(c => c.status === s)?.n ?? 0;
    const [a] = await db.select({ name: associations.name }).from(associations).where(eq(associations.id, g.associationId));
    return { user: { id: g.userId, name: g.name }, society: a?.name ?? '', gate: g.gate, waiting: n('Pending') + n('Approved') + n('Handover'), inside: n('Inside'), parcels: n('AtGate') };
  });

  /** find the flat: by number ("T4-1108", "1108") or by a resident's name */
  app.get('/gate/units', async req => {
    const g = await guardOf(req);
    const { q } = parse(z.object({ q: z.string().trim().min(1).max(40) }), req.query);
    const like = '%' + q.replace(/[%_]/g, '') + '%';
    const rows = await db.selectDistinct({ id: units.id, code: units.code, label: units.label }).from(units)
      .leftJoin(unitMembers, and(eq(unitMembers.unitId, units.id), eq(unitMembers.status, 'active')))
      .leftJoin(users, eq(users.id, unitMembers.userId))
      .where(and(eq(units.associationId, g.associationId), or(ilike(units.code, like), ilike(units.label, like), ilike(users.name, like)))).limit(20);
    if (!rows.length) return [];
    const people = await db.select({ unitId: unitMembers.unitId, name: users.name }).from(unitMembers).innerJoin(users, eq(users.id, unitMembers.userId))
      .where(and(inArray(unitMembers.unitId, rows.map(r => r.id)), eq(unitMembers.status, 'active'), isNull(users.deletedAt)));
    // names only — a guard has no need for residents' phone numbers
    return rows.map(r => ({ ...r, residents: people.filter(p => p.unitId === r.id).map(p => p.name) }));
  });

  /** before typing everything again: has this number been here, is it someone's regular, is it on the watch list */
  app.get('/gate/lookup', async req => {
    const g = await guardOf(req);
    const { phone } = parse(z.object({ phone: Phone }), req.query);
    const theirs = and(eq(visits.associationId, g.associationId), eq(visits.phone, phone));
    const [seen] = await db.select({ name: visits.name, vehicle: visits.vehicle, visitorType: visits.visitorType, purpose: visits.purpose, partner: visits.partner, deliveryType: visits.deliveryType, at: visits.createdAt })
      .from(visits).where(theirs).orderBy(desc(visits.createdAt)).limit(1);
    // the photo on file is the newest one taken of them — the last visit may have been logged without one
    const last = seen ? { ...seen, photoUrl: await photoOnFile(g.associationId, phone) } : null;
    // where they have been going, newest first — the guard taps one instead of searching for the flat again
    const went = await db.select({ id: units.id, code: units.code, label: units.label, at: sql<string>`max(${visits.createdAt})` }).from(visits).innerJoin(units, eq(units.id, visits.unitId))
      .where(theirs).groupBy(units.id, units.code, units.label).orderBy(desc(sql`max(${visits.createdAt})`)).limit(4);
    const people = went.length ? await db.select({ unitId: unitMembers.unitId, name: users.name }).from(unitMembers).innerJoin(users, eq(users.id, unitMembers.userId))
      .where(and(inArray(unitMembers.unitId, went.map(r => r.id)), eq(unitMembers.status, 'active'), isNull(users.deletedAt))) : [];
    const flats = went.map(({ at: _at, ...r }) => ({ ...r, residents: people.filter(p => p.unitId === r.id).map(p => p.name) }));
    const regular = await db.select({ unitId: frequentVisitors.unitId, unit: units.code, name: frequentVisitors.name, visitorType: frequentVisitors.visitorType, vehicle: frequentVisitors.vehicle, autoApprove: frequentVisitors.autoApprove })
      .from(frequentVisitors).innerJoin(units, eq(units.id, frequentVisitors.unitId)).where(and(eq(frequentVisitors.associationId, g.associationId), eq(frequentVisitors.phone, phone)));
    const [w] = await db.select({ level: watchlist.level, reason: watchlist.reason, name: watchlist.name }).from(watchlist).where(and(eq(watchlist.associationId, g.associationId), eq(watchlist.phone, phone)));
    const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(visits).where(and(eq(visits.associationId, g.associationId), eq(visits.phone, phone)))) as [{ n: number }];
    return { last, visits: n, regular, watch: w ?? null, flats };
  });

  /** A visitor or a delivery arrives. The flat is asked unless a rule already answers. */
  app.post('/gate/visits', async (req, reply) => {
    const g = await guardOf(req);
    const b = parse(z.object({
      visitorType: z.enum(VISITOR_TYPES), name: z.string().trim().min(2).max(80), phone: Phone.optional(), unitId: z.uuid().optional(),
      purpose: z.string().trim().max(200).default(''), vehicle: Vehicle, people: z.number().int().min(1).max(20).default(1), photoUrl: z.url().optional(),
      deliveryType: z.enum(DELIVERY_TYPES).optional(), partner: z.string().trim().max(40).optional(),
    }), req.body);
    const kind = b.visitorType === 'Delivery' ? 'delivery' as const : 'visitor' as const;
    const societyLevel = b.visitorType === 'Emergency' || b.visitorType === 'Staff';
    if (!b.unitId && !societyLevel) throw badRequest('unit_needed', 'Choose the flat they are visiting.');
    if (b.unitId) {
      const [u] = await db.select({ id: units.id }).from(units).where(and(eq(units.id, b.unitId), eq(units.associationId, g.associationId)));
      if (!u) throw notFound('That flat');
    }
    const marks = [b.phone ? eq(watchlist.phone, b.phone) : undefined, b.vehicle ? eq(watchlist.vehicle, b.vehicle) : undefined].filter(Boolean);
    const [w] = marks.length ? await db.select().from(watchlist).where(and(eq(watchlist.associationId, g.associationId), or(...marks))).orderBy(watchlist.level) : [];
    const [regular] = b.phone && b.unitId ? await db.select().from(frequentVisitors).where(and(eq(frequentVisitors.unitId, b.unitId), eq(frequentVisitors.phone, b.phone))) : [];

    const base = { associationId: g.associationId, unitId: b.unitId ?? null, kind, visitorType: b.visitorType, name: b.name, phone: b.phone ?? null, photoUrl: b.photoUrl ?? (b.phone ? await photoOnFile(g.associationId, b.phone) : null),
      purpose: b.purpose, vehicle: b.vehicle || null, people: b.people, deliveryType: kind === 'delivery' ? b.deliveryType ?? 'Parcel' : null, partner: b.partner || null, createdBy: g.userId, gate: g.gate };
    const settled = (via: DecidedVia, status: VisitStatus, note = '') => ({ status, decidedVia: via, decidedAt: new Date(), decidedByName: via === 'frequent' ? 'Standing permission' : via === 'watchlist' ? 'Watch list' : g.name, note });

    if (w?.level === 'block') {
      const [v] = await db.insert(visits).values({ ...base, ...settled('watchlist', 'Rejected', 'Blocked: ' + w.reason) }).returning();
      await audit(db, g.associationId, g.userId, g.name, `turned away ${b.name} at ${g.gate} — on the block list (${w.reason})`);
      visitChanged(v!);
      return reply.status(201).send({ ...out(v!, null, 'guard'), blocked: w.reason });
    }
    const flagged = w ? w.reason : null;
    const [v] = await db.insert(visits).values({
      ...base, flagged,
      ...(b.visitorType === 'Emergency' ? settled('emergency', 'Approved')
        : !b.unitId ? settled('guard', 'Approved')
        : regular?.autoApprove && !flagged ? settled('frequent', 'Approved')
        : { status: 'Pending' as const }),
    }).returning();
    if (v!.status === 'Pending') {
      await tell(v!, kind === 'delivery' ? `${what(v!)} at the gate` : `${v!.name} is at the gate`,
        (kind === 'delivery' ? 'Allow it in, leave it at the gate, or turn it away.' : `${b.visitorType}${b.purpose ? ' · ' + b.purpose : ''}. Approve or reject.`) + (flagged ? ` Security note: ${flagged}.` : ''));
    } else if (v!.decidedVia === 'frequent') {
      await tell(v!, `${v!.name} is coming up`, 'Let in on your standing permission.');
    }
    visitChanged(v!);
    const [r] = await withUnit(eq(visits.id, v!.id), 1);
    return reply.status(201).send({ ...shape([r!], 'guard')[0], residentsToAsk: b.unitId ? (await membersOf(b.unitId)).length : 0 });
  });

  /** the guard's lists: who is waiting, who is inside, which parcels are on the desk, and today's log */
  app.get('/gate/visits', async req => {
    const g = await guardOf(req);
    const { tab } = parse(z.object({ tab: z.enum(['waiting', 'inside', 'parcels', 'today']).default('waiting') }), req.query);
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const where = tab === 'waiting' ? or(inArray(visits.status, ['Pending', 'Approved']), and(eq(visits.status, 'AtGate'), isNull(visits.keptAt)))
      : tab === 'inside' ? eq(visits.status, 'Inside')
      : tab === 'parcels' ? and(eq(visits.status, 'AtGate'), sql`${visits.keptAt} is not null`)
      : and(gte(visits.createdAt, start), sql`${visits.status} <> 'Expected'`);
    return shape(await withUnit(and(eq(visits.associationId, g.associationId), where)), 'guard');
  });

  /** a pre-approved visitor shows their pass */
  app.post('/gate/pass', async req => {
    const g = await guardOf(req);
    const { code } = parse(z.object({ code: z.string().regex(/^\d{6}$/, 'A pass code has 6 digits') }), req.body);
    const [r] = await withUnit(and(eq(visits.associationId, g.associationId), eq(visits.passCode, code), eq(visits.status, 'Expected')), 1);
    if (!r) throw notFound('A valid pass with that code');
    const now = Date.now();
    if (r.v.validUntil && r.v.validUntil.getTime() < now) throw conflict('pass_expired', 'This pass has expired. Ask the resident for a new one.');
    if (r.v.validFrom && r.v.validFrom.getTime() - 30 * 60_000 > now) throw conflict('pass_early', `This pass starts ${r.v.validFrom.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}.`);
    return shape([r], 'guard')[0];
  });

  /** the guard phoned the flat (or the intercom answered) and records what they said */
  app.post('/gate/visits/:id/decision', async req => {
    const g = await guardOf(req);
    const { id } = parse(Id, req.params);
    const b = parse(z.object({ decision: z.enum(['approve', 'reject', 'gate']), note: z.string().trim().max(200).default('') }), req.body);
    const { v } = await one(id, g.associationId);
    const u = await decide(v, b.decision, { userId: g.userId, name: g.name }, 'guard', b.note || 'Confirmed with the flat by phone');
    await tell(u, `${what(u)}: ${b.decision === 'approve' ? 'let in' : b.decision === 'reject' ? 'turned away' : 'left at the gate'}`, `Recorded by ${g.name} at ${g.gate} after speaking to your flat.` + (u.collectCode ? ` Collection code ${u.collectCode}.` : ''));
    await audit(db, g.associationId, g.userId, g.name, `${b.decision === 'approve' ? 'approved' : b.decision === 'reject' ? 'rejected' : 'kept at gate'} ${what(u)} on the flat's word`);
    return shape([await one(id, g.associationId)], 'guard')[0];
  });

  app.post('/gate/visits/:id/enter', async req => {
    const g = await guardOf(req);
    const { id } = parse(Id, req.params);
    const b = parse(z.object({ photoUrl: z.url().optional() }), req.body ?? {});
    const { v } = await one(id, g.associationId);
    const pass = v.status === 'Expected';
    if (pass && v.validUntil && v.validUntil.getTime() < Date.now()) throw conflict('pass_expired', 'This pass has expired.');
    if (!pass && v.status !== 'Approved') throw conflict('not_approved', v.status === 'Pending' ? 'The flat hasn’t answered yet.' : 'This entry can’t be let in.');
    const [u] = await db.update(visits).set({
      status: 'Inside', enteredAt: new Date(), gate: g.gate, guardId: g.userId, guardName: g.name, photoUrl: b.photoUrl ?? v.photoUrl,
      ...(pass ? { decidedVia: 'pass' as const, decidedAt: new Date() } : {}),
    }).where(and(eq(visits.id, id), eq(visits.status, v.status))).returning();
    if (!u) throw conflict('changed', 'This entry just changed. Refresh and try again.');
    visitChanged(u);
    if (pass || v.kind === 'delivery') await tell(u, `${what(u)} has come in`, `Let in at ${g.gate}.`);
    return shape([await one(id, g.associationId)], 'guard')[0];
  });

  /** leaving: for a delivery this is "delivered", with an optional photo as proof */
  app.post('/gate/visits/:id/exit', async req => {
    const g = await guardOf(req);
    const { id } = parse(Id, req.params);
    const b = parse(z.object({ proofUrl: z.url().optional() }), req.body ?? {});
    const [u] = await db.update(visits).set({ status: 'Left', exitedAt: new Date(), exitGuardName: g.name, ...(b.proofUrl ? { proofUrl: b.proofUrl } : {}) })
      .where(and(eq(visits.id, id), eq(visits.associationId, g.associationId), eq(visits.status, 'Inside'))).returning();
    if (!u) throw conflict('not_inside', 'This visitor isn’t marked as inside.');
    visitChanged(u);
    return shape([await one(id, g.associationId)], 'guard')[0];
  });

  /** leave at gate: security has taken the parcel */
  app.post('/gate/visits/:id/keep', async req => {
    const g = await guardOf(req);
    const { id } = parse(Id, req.params);
    const b = parse(z.object({ proofUrl: z.url().optional() }), req.body ?? {});
    const [u] = await db.update(visits).set({ keptAt: new Date(), gate: g.gate, guardId: g.userId, guardName: g.name, ...(b.proofUrl ? { proofUrl: b.proofUrl } : {}) })
      .where(and(eq(visits.id, id), eq(visits.associationId, g.associationId), eq(visits.status, 'AtGate'), isNull(visits.keptAt))).returning();
    if (!u) throw conflict('not_at_gate', 'This parcel isn’t waiting to be kept.');
    visitChanged(u);
    await tell(u, `Your ${what(u)} is at ${g.gate}`, `Show code ${u.collectCode} to collect it.`);
    return shape([await one(id, g.associationId)], 'guard')[0];
  });

  /** handover: the resident's code, or — when they don't have the app to hand — the name of whoever took it */
  app.post('/gate/visits/:id/collect', async req => {
    const g = await guardOf(req);
    const { id } = parse(Id, req.params);
    const b = parse(z.object({ code: z.string().regex(/^\d{4}$/).optional(), collectedBy: z.string().trim().min(2).max(80).optional() }), req.body);
    const { v } = await one(id, g.associationId);
    if (v.status !== 'AtGate' || !v.keptAt) throw conflict('not_at_gate', 'This parcel isn’t on the desk.');
    if (b.code) { if (b.code !== v.collectCode) throw badRequest('wrong_code', 'That code doesn’t match this parcel.'); }
    else if (!b.collectedBy) throw badRequest('proof_needed', 'Enter the resident’s code, or the name of the person collecting.');
    const [u] = await db.update(visits).set({ status: 'Collected', collectedAt: new Date(), collectedBy: b.collectedBy ?? (b.code ? 'Code shown' : null), exitGuardName: g.name })
      .where(and(eq(visits.id, id), eq(visits.status, 'AtGate'))).returning();
    if (!u) throw conflict('changed', 'This entry just changed. Refresh and try again.');
    visitChanged(u);
    await tell(u, `Your ${what(u)} was collected`, b.code ? `Handed over at ${g.gate}.` : `Handed to ${b.collectedBy} at ${g.gate} without a code. Tell the office if that wasn’t you.`);
    return shape([await one(id, g.associationId)], 'guard')[0];
  });

  /**
   * The guard's screen, live: a line arrives whenever anything at this society's gate changes, and the app re-reads its lists.
   * A socket cannot carry the usual header from every client, so the first message is the access token — nothing is sent
   * before it checks out as a guard's. The socket is closed after a while so a signed-out guard does not keep listening;
   * the app reconnects with its current token.
   */
  app.get('/gate/live', { websocket: true }, socket => {
    let off = () => {};
    const hello = setTimeout(() => socket.close(4401, 'sign in'), 5000);
    const renew = setTimeout(() => socket.close(4408, 'renew'), 10 * 60_000);
    const beat = setInterval(() => socket.ping(), 30_000); // keeps proxies from dropping a quiet connection
    socket.on('error', () => {});
    socket.on('close', () => { off(); clearTimeout(hello); clearTimeout(renew); clearInterval(beat); });
    socket.once('message', async raw => {
      clearTimeout(hello);
      try {
        const { token } = z.object({ token: z.string().min(10).max(2000) }).parse(JSON.parse(String(raw)));
        const g = await guardOf({ headers: { authorization: 'Bearer ' + token } } as FastifyRequest);
        if (socket.readyState !== socket.OPEN) return;
        off = onGate(g.associationId, () => { if (socket.readyState === socket.OPEN) socket.send('{"type":"changed"}'); });
        socket.send('{"type":"ready"}');
      } catch {
        socket.close(4401, 'sign in');
      }
    });
  });

  /* ======================= the resident ======================= */
  app.get('/visits', async req => {
    const me = await residentOf(db, await uid(req));
    const rows = shape(await withUnit(and(eq(visits.unitId, me.unitId), gte(visits.createdAt, new Date(Date.now() - 90 * DAY))), 300), 'resident');
    return {
      pending: rows.filter(v => v.status === 'Pending'),
      expected: rows.filter(v => v.status === 'Expected'),
      parcels: rows.filter(v => v.status === 'AtGate'),
      inside: rows.filter(v => v.status === 'Inside' || v.status === 'Approved'),
      history: rows.filter(v => ['Left', 'Collected', 'Rejected', 'Cancelled', 'Expired'].includes(v.status)).slice(0, 80),
    };
  });

  app.get('/visits/:id', async req => {
    const me = await residentOf(db, await uid(req));
    const { id } = parse(Id, req.params);
    const r = await one(id, me.associationId);
    if (r.v.unitId !== me.unitId) throw notFound('That entry');
    return shape([r], 'resident')[0];
  });

  /** Pre-approve someone: they get a pass code (and QR) that works at the gate inside the time window. */
  app.post('/visits', async (req, reply) => {
    const me = await residentOf(db, await uid(req));
    const b = parse(z.object({
      visitorType: z.enum(['Guest', 'Delivery', 'Cab', 'Vendor', 'Staff']).default('Guest'), name: z.string().trim().min(2).max(80), phone: Phone.optional(),
      vehicle: Vehicle, people: z.number().int().min(1).max(20).default(1), purpose: z.string().trim().max(200).default(''),
      deliveryType: z.enum(DELIVERY_TYPES).optional(), partner: z.string().trim().max(40).optional(),
      validFrom: z.iso.datetime({ offset: true }).optional(), validUntil: z.iso.datetime({ offset: true }).optional(),
    }), req.body);
    const from = b.validFrom ? new Date(b.validFrom) : new Date();
    const until = b.validUntil ? new Date(b.validUntil) : new Date(from.getTime() + DAY);
    if (until.getTime() <= Date.now()) throw badRequest('in_the_past', 'Choose a time that hasn’t passed.');
    if (until.getTime() <= from.getTime()) throw badRequest('bad_window', 'The pass must end after it starts.');
    if (until.getTime() - from.getTime() > 30 * DAY) throw badRequest('too_long', 'A pass can last at most 30 days. For regular visitors, save them as a frequent visitor.');
    if (b.phone) {
      const [w] = await db.select({ level: watchlist.level }).from(watchlist).where(and(eq(watchlist.associationId, me.associationId), eq(watchlist.phone, b.phone), eq(watchlist.level, 'block')));
      if (w) throw conflict('blocked', 'This person is on the society’s block list. Speak to the society office.');
    }
    let passCode = sixDigits();
    for (let i = 0; i < 5; i++) { // unique among the passes still waiting in this society
      const [taken] = await db.select({ id: visits.id }).from(visits).where(and(eq(visits.associationId, me.associationId), eq(visits.passCode, passCode), eq(visits.status, 'Expected')));
      if (!taken) break;
      passCode = sixDigits();
    }
    const kind = b.visitorType === 'Delivery' ? 'delivery' as const : 'visitor' as const;
    const [v] = await db.insert(visits).values({
      associationId: me.associationId, unitId: me.unitId, kind, visitorType: b.visitorType, name: b.name, phone: b.phone ?? null, vehicle: b.vehicle || null, people: b.people, purpose: b.purpose,
      deliveryType: kind === 'delivery' ? b.deliveryType ?? 'Parcel' : null, partner: b.partner || null,
      status: 'Expected', passCode, validFrom: from, validUntil: until, decidedBy: me.userId, decidedByName: me.name, createdBy: me.userId,
    }).returning();
    return reply.status(201).send(out(v!, { code: me.unitCode, label: me.unitLabel }, 'resident'));
  });

  app.post('/visits/:id/decision', async req => {
    const me = await residentOf(db, await uid(req));
    const { id } = parse(Id, req.params);
    const { decision } = parse(z.object({ decision: z.enum(['approve', 'reject', 'gate']) }), req.body);
    const r = await one(id, me.associationId);
    if (r.v.unitId !== me.unitId) throw notFound('That entry');
    const u = await decide(r.v, decision, { userId: me.userId, name: me.name }, 'resident');
    return out(u, { code: me.unitCode, label: me.unitLabel }, 'resident');
  });

  app.post('/visits/:id/cancel', async req => {
    const me = await residentOf(db, await uid(req));
    const { id } = parse(Id, req.params);
    const [u] = await db.update(visits).set({ status: 'Cancelled' }).where(and(eq(visits.id, id), eq(visits.unitId, me.unitId), eq(visits.status, 'Expected'))).returning();
    if (!u) throw conflict('not_cancellable', 'Only a pass that hasn’t been used can be cancelled.');
    visitChanged(u);
    return out(u, { code: me.unitCode, label: me.unitLabel }, 'resident');
  });

  app.get('/frequent-visitors', async req => {
    const me = await residentOf(db, await uid(req));
    return db.select({ id: frequentVisitors.id, name: frequentVisitors.name, phone: frequentVisitors.phone, visitorType: frequentVisitors.visitorType, vehicle: frequentVisitors.vehicle, autoApprove: frequentVisitors.autoApprove })
      .from(frequentVisitors).where(eq(frequentVisitors.unitId, me.unitId)).orderBy(frequentVisitors.name);
  });

  app.post('/frequent-visitors', async (req, reply) => {
    const me = await residentOf(db, await uid(req));
    const b = parse(z.object({ name: z.string().trim().min(2).max(80), phone: Phone, visitorType: z.enum(['Guest', 'Delivery', 'Cab', 'Vendor', 'Staff']).default('Guest'), vehicle: Vehicle, autoApprove: z.boolean().default(false) }), req.body);
    const [w] = await db.select({ id: watchlist.id }).from(watchlist).where(and(eq(watchlist.associationId, me.associationId), eq(watchlist.phone, b.phone), eq(watchlist.level, 'block')));
    if (w) throw conflict('blocked', 'This person is on the society’s block list. Speak to the society office.');
    const [f] = await db.insert(frequentVisitors).values({ associationId: me.associationId, unitId: me.unitId, name: b.name, phone: b.phone, visitorType: b.visitorType, vehicle: b.vehicle || null, autoApprove: b.autoApprove, createdBy: me.userId })
      .onConflictDoUpdate({ target: [frequentVisitors.unitId, frequentVisitors.phone], set: { name: b.name, visitorType: b.visitorType, vehicle: b.vehicle || null, autoApprove: b.autoApprove } }).returning();
    return reply.status(201).send({ id: f!.id, name: f!.name, phone: f!.phone, visitorType: f!.visitorType, vehicle: f!.vehicle, autoApprove: f!.autoApprove });
  });

  app.delete('/frequent-visitors/:id', async (req, reply) => {
    const me = await residentOf(db, await uid(req));
    const { id } = parse(Id, req.params);
    const gone = await db.delete(frequentVisitors).where(and(eq(frequentVisitors.id, id), eq(frequentVisitors.unitId, me.unitId))).returning();
    if (!gone.length) throw notFound('That visitor');
    return reply.status(204).send();
  });

  /* ======================= the society office ======================= */
  const Aid = z.object({ aid: z.uuid() });
  const office = async (req: FastifyRequest) => {
    const { aid } = parse(Aid, req.params);
    return { aid, staff: await staffOf(db, await uid(req), aid, ['admin', 'committee']) };
  };

  /** the society-wide register, newest first; filter by flat, kind, status, dates or a name / phone / vehicle */
  app.get('/admin/:aid/visits', async req => {
    const { aid } = await office(req);
    const f = parse(PageQuery.omit({ q: true }).extend({
      from: z.iso.date().optional(), to: z.iso.date().optional(), unit: z.string().trim().max(20).optional(), kind: z.enum(['visitor', 'delivery']).optional(),
      status: z.enum(['Expected', 'Pending', 'Approved', 'Rejected', 'AtGate', 'Inside', 'Left', 'Collected', 'Cancelled', 'Expired']).optional(), q: z.string().trim().max(40).optional(),
    }), req.query);
    const like = f.q ? likeOf(f.q) : null;
    const where = and(

      eq(visits.associationId, aid),
      f.from ? gte(visits.createdAt, new Date(f.from + 'T00:00:00+05:30')) : undefined,
      f.to ? lte(visits.createdAt, new Date(f.to + 'T23:59:59+05:30')) : undefined,
      f.unit ? ilike(units.code, '%' + f.unit.replace(/[%_]/g, '') + '%') : undefined,
      f.kind ? eq(visits.kind, f.kind) : undefined, f.status ? eq(visits.status, f.status) : undefined,
      like ? or(ilike(visits.name, like), ilike(visits.phone, like), ilike(visits.vehicle, like), ilike(visits.partner, like)) : undefined,
    );
    // the whole register (up to 500) when no page is asked for; otherwise one page of it and how many there are
    if (f.page === undefined) return shape(await withUnit(where, 500), 'admin');
    const page = { page: f.page, limit: f.limit };
    const [[n], list] = await Promise.all([
      db.select({ n: sql<number>`count(*)::int` }).from(visits).leftJoin(units, eq(units.id, visits.unitId)).where(where),
      db.select({ v: visits, code: units.code, label: units.label }).from(visits).leftJoin(units, eq(units.id, visits.unitId)).where(where).orderBy(desc(visits.createdAt), desc(visits.id)).limit(page.limit).offset(offsetOf(page)),
    ]);
    return paged(shape(list, 'admin'), n?.n ?? 0, page);
  });

  app.get('/admin/:aid/visits/summary', async req => {
    const { aid } = await office(req);
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const rows = async <T>(q: ReturnType<typeof sql>) => ((await db.execute(q)) as unknown as { rows: T[] }).rows;
    const since = new Date(Date.now() - 30 * DAY).toISOString(), today = start.toISOString();
    const [t] = await rows<Record<string, number>>(sql`
      select count(*) filter (where entered_at >= ${today}::timestamptz)::int as entries_today,
        count(*) filter (where status = 'Inside')::int as inside_now,
        count(*) filter (where status = 'Pending')::int as waiting,
        count(*) filter (where status = 'AtGate')::int as parcels_at_gate,
        count(*) filter (where status = 'Rejected' and created_at >= ${today}::timestamptz)::int as rejected_today,
        count(*) filter (where kind = 'delivery' and created_at >= ${today}::timestamptz)::int as deliveries_today,
        count(*) filter (where status = 'Expected' and valid_until > now())::int as expected
      from visits where association_id = ${aid}`);
    const byType = await rows<{ type: string; n: number }>(sql`select visitor_type as type, count(*)::int as n from visits where association_id = ${aid} and created_at >= ${since}::timestamptz and status <> 'Expected' group by 1 order by 2 desc`);
    return { ...t, byType };
  });

  /** the office can answer for a flat (nobody home, resident phoned the office) */
  app.post('/admin/:aid/visits/:id/decision', async req => {
    const { aid, staff } = await office(req);
    const { id } = parse(Id, req.params);
    const b = parse(z.object({ decision: z.enum(['approve', 'reject', 'gate']), note: z.string().trim().max(200).default('') }), req.body);
    const { v } = await one(id, aid);
    const u = await decide(v, b.decision, { userId: staff.userId, name: staff.name }, 'admin', b.note);
    await tell(u, `${what(u)}: ${b.decision === 'approve' ? 'let in' : b.decision === 'reject' ? 'turned away' : 'left at the gate'}`, `Decided by the society office (${staff.name}).` + (u.collectCode ? ` Collection code ${u.collectCode}.` : ''));
    await audit(db, aid, staff.userId, staff.name, `${b.decision === 'approve' ? 'approved' : b.decision === 'reject' ? 'rejected' : 'kept at gate'} ${what(u)} for a flat`);
    return shape([await one(id, aid)], 'admin')[0];
  });

  /* ---- guards: created by the office, they sign in to the app with their mobile number ---- */
  const guards = (aid: string) => db.select({ id: users.id, name: users.name, phone: users.phone, gate: staffRoles.title })
    .from(staffRoles).innerJoin(users, eq(users.id, staffRoles.userId)).where(and(eq(staffRoles.associationId, aid), eq(staffRoles.role, 'guard'), isNull(users.deletedAt))).orderBy(users.name);

  app.get('/admin/:aid/guards', async req => { const { aid } = await office(req); return guards(aid); });

  app.post('/admin/:aid/guards', async (req, reply) => {
    const { aid, staff } = await office(req);
    const b = parse(z.object({ name: z.string().trim().min(2).max(80), phone: Phone, gate: z.string().trim().min(2).max(40).default('Main gate') }), req.body);
    const id = await db.transaction(async tx => {
      let [u] = await tx.select().from(users).where(eq(users.phone, b.phone));
      if (u?.deletedAt) throw conflict('number_unavailable', 'That number can’t be used.');
      if (u) {
        const [already] = await tx.select({ id: staffRoles.id }).from(staffRoles).where(and(eq(staffRoles.userId, u.id), eq(staffRoles.role, 'guard')));
        if (already) throw conflict('already_guard', 'That number already belongs to a guard.');
      } else {
        [u] = await tx.insert(users).values({ name: b.name, phone: b.phone }).returning();
      }
      await tx.insert(staffRoles).values({ userId: u!.id, associationId: aid, role: 'guard', title: b.gate });
      await audit(tx, aid, staff.userId, staff.name, `added guard ${b.name} · ${b.gate}`);
      return u!.id;
    });
    return reply.status(201).send((await guards(aid)).find(g => g.id === id));
  });

  app.put('/admin/:aid/guards/:id', async req => {
    const { aid } = await office(req);
    const { id } = parse(Id, req.params);
    const { gate } = parse(z.object({ gate: z.string().trim().min(2).max(40) }), req.body);
    const done = await db.update(staffRoles).set({ title: gate }).where(and(eq(staffRoles.userId, id), eq(staffRoles.associationId, aid), eq(staffRoles.role, 'guard'))).returning();
    if (!done.length) throw notFound('That guard');
    return (await guards(aid)).find(g => g.id === id);
  });

  /** remove a guard: access ends and they are signed out */
  app.delete('/admin/:aid/guards/:id', async (req, reply) => {
    const { aid, staff } = await office(req);
    const { id } = parse(Id, req.params);
    const gone = await db.delete(staffRoles).where(and(eq(staffRoles.userId, id), eq(staffRoles.associationId, aid), eq(staffRoles.role, 'guard'))).returning();
    if (!gone.length) throw notFound('That guard');
    await db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.userId, id), isNull(refreshTokens.revokedAt)));
    await audit(db, aid, staff.userId, staff.name, 'removed a guard');
    return reply.status(204).send();
  });

  /* ---- QR stickers: a visitor scans one at the gate and fills in their own entry ---- */
  const stickers = async (aid: string) => {
    const [a] = await db.select({ name: associations.name }).from(associations).where(eq(associations.id, aid));
    const rows = await db.select({ id: gateStickers.id, gate: gateStickers.gate, token: gateStickers.token, createdAt: gateStickers.createdAt }).from(gateStickers).where(eq(gateStickers.associationId, aid)).orderBy(gateStickers.createdAt);
    return rows.map(({ token, ...r }) => ({ ...r, society: a?.name ?? '', url: `${config.PUBLIC_URL.replace(/\/+$/, '')}/visit/${token}` }));
  };

  app.get('/admin/:aid/gate-codes', async req => { const { aid } = await office(req); return stickers(aid); });

  app.post('/admin/:aid/gate-codes', async (req, reply) => {
    const { aid, staff } = await office(req);
    const { gate } = parse(z.object({ gate: z.string().trim().min(2).max(40).default('Main gate') }), req.body);
    const [s] = await db.insert(gateStickers).values({ associationId: aid, gate, token: randomBytes(12).toString('base64url'), createdBy: staff.userId }).returning();
    await audit(db, aid, staff.userId, staff.name, `made a visitor QR sticker for ${gate}`);
    return reply.status(201).send((await stickers(aid)).find(x => x.id === s!.id));
  });

  /** a sticker that was torn off, copied or misused: it stops working at once */
  app.delete('/admin/:aid/gate-codes/:id', async (req, reply) => {
    const { aid, staff } = await office(req);
    const { id } = parse(Id, req.params);
    const gone = await db.delete(gateStickers).where(and(eq(gateStickers.id, id), eq(gateStickers.associationId, aid))).returning();
    if (!gone.length) throw notFound('That sticker');
    await audit(db, aid, staff.userId, staff.name, `cancelled the visitor QR sticker for ${gone[0]!.gate}`);
    return reply.status(204).send();
  });

  /* ---- block / watch list ---- */
  const listWatch = (db2: DB, aid: string) => db2.select({ id: watchlist.id, name: watchlist.name, phone: watchlist.phone, vehicle: watchlist.vehicle, reason: watchlist.reason, level: watchlist.level, addedBy: watchlist.addedByName, createdAt: watchlist.createdAt })
    .from(watchlist).where(eq(watchlist.associationId, aid)).orderBy(desc(watchlist.createdAt));

  app.get('/admin/:aid/watchlist', async req => { const { aid } = await office(req); return listWatch(db, aid); });

  app.post('/admin/:aid/watchlist', async (req, reply) => {
    const { aid, staff } = await office(req);
    const b = parse(z.object({ name: z.string().trim().min(2).max(80), phone: Phone.optional(), vehicle: Vehicle, reason: z.string().trim().min(3).max(200), level: z.enum(['block', 'watch']).default('block') }), req.body);
    if (!b.phone && !b.vehicle) throw badRequest('nothing_to_match', 'Give a mobile number or a vehicle number — that is how the gate recognises them.');
    const [w] = await db.insert(watchlist).values({ associationId: aid, name: b.name, phone: b.phone ?? null, vehicle: b.vehicle || null, reason: b.reason, level: b.level, addedBy: staff.userId, addedByName: staff.name }).returning();
    await audit(db, aid, staff.userId, staff.name, `${b.level === 'block' ? 'blocked' : 'put on watch'} ${b.name} — ${b.reason}`);
    return reply.status(201).send((await listWatch(db, aid)).find(x => x.id === w!.id));
  });

  app.delete('/admin/:aid/watchlist/:id', async (req, reply) => {
    const { aid, staff } = await office(req);
    const { id } = parse(Id, req.params);
    const gone = await db.delete(watchlist).where(and(eq(watchlist.id, id), eq(watchlist.associationId, aid))).returning();
    if (!gone.length) throw notFound('That entry');
    await audit(db, aid, staff.userId, staff.name, `removed ${gone[0]!.name} from the ${gone[0]!.level} list`);
    return reply.status(204).send();
  });
};
