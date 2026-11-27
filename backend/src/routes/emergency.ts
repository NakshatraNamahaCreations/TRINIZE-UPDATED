import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../app.js';
import { contacts, INCIDENT_KINDS, incidents, staffRoles, units, users } from '../db/schema.js';
import { audit } from '../lib/audit.js';
import { residentOf, staffOf, userIdFrom } from '../lib/auth.js';
import { notify, residentsOf } from '../lib/community.js';
import { badRequest, conflict, forbidden, notFound, parse } from '../lib/http.js';
import { staffOfSociety } from '../lib/maintenance.js';

const Id = z.object({ id: z.uuid() });

/**
 * Emergencies: an SOS raised from the app, and the incident log the office keeps.
 *   /v1/sos · /v1/emergency              the resident and the guard
 *   /v1/admin/:aid/incidents             the office
 */
export const emergencyRoutes = ({ config, db }: Deps): FastifyPluginAsync => async app => {
  const uid = (req: FastifyRequest) => userIdFrom(req, config.JWT_SECRET);
  const office = async (req: FastifyRequest, write = true) => {
    const { aid } = parse(z.object({ aid: z.uuid() }), req.params);
    const s = await staffOf(db, await uid(req), aid, write ? ['admin'] : ['admin', 'committee']);
    return { aid, by: { userId: s.userId, name: s.name } };
  };

  const incidentOut = (aid: string, where?: ReturnType<typeof and>) => db.select({ id: incidents.id, kind: incidents.kind, by: incidents.raisedByName, role: incidents.raisedByRole, unit: units.code, place: incidents.place, note: incidents.note,
    status: incidents.status, ackByName: incidents.ackByName, ackAt: incidents.ackAt, resolvedByName: incidents.resolvedByName, resolvedAt: incidents.resolvedAt, resolution: incidents.resolution, createdAt: incidents.createdAt })
    .from(incidents).leftJoin(units, eq(units.id, incidents.unitId)).where(and(eq(incidents.associationId, aid), where)).orderBy(desc(incidents.createdAt)).limit(200);
  const guardsOf = async (aid: string) => (await db.select({ userId: staffRoles.userId }).from(staffRoles).where(and(eq(staffRoles.associationId, aid), eq(staffRoles.role, 'guard')))).map(g => g.userId);
  /** who is asking: a resident in their society, or a guard at their post */
  const caller = async (req: FastifyRequest) => {
    const userId = await uid(req);
    try {
      const r = await residentOf(db, userId);
      return { userId, name: r.name, role: 'resident' as const, associationId: r.associationId, unitId: r.unitId as string | null, where: r.unitCode };
    } catch {
      const [g] = await db.select({ name: users.name, associationId: staffRoles.associationId, gate: staffRoles.title }).from(staffRoles).innerJoin(users, eq(users.id, staffRoles.userId)).where(and(eq(staffRoles.userId, userId), eq(staffRoles.role, 'guard')));
      if (!g?.associationId) throw forbidden();
      return { userId, name: g.name, role: 'guard' as const, associationId: g.associationId, unitId: null, where: g.gate ?? 'Main gate' };
    }
  };

  /** the numbers to call, and anything already raised that is still open */
  app.get('/emergency', async req => {
    const c = await caller(req);
    const numbers = await db.select({ name: contacts.name, role: contacts.role, phone: contacts.phone }).from(contacts).where(and(eq(contacts.associationId, c.associationId), eq(contacts.group, 'emergency'))).orderBy(asc(contacts.position));
    const open = await incidentOut(c.associationId, c.role === 'guard' ? inArray(incidents.status, ['Open', 'Acknowledged']) : and(eq(incidents.raisedBy, c.userId), inArray(incidents.status, ['Open', 'Acknowledged'])));
    // 112 reaches police, fire and ambulance anywhere in India — always offered, whatever the society has listed
    const contactsOut = numbers.some(n => n.phone.replace(/\s/g, '') === '112') ? numbers : [...numbers, { name: 'National emergency', role: 'Police, fire and ambulance', phone: '112' }];
    return { contacts: contactsOut, kinds: INCIDENT_KINDS, open };
  });

  /** SOS: security, the office and the committee are told at once, and it goes on the incident log */
  app.post('/sos', { config: { rateLimit: { max: 6, timeWindow: '10 minutes' } } }, async (req, reply) => {
    const c = await caller(req);
    const b = parse(z.object({ kind: z.enum(INCIDENT_KINDS), note: z.string().trim().max(300).default(''), place: z.string().trim().max(80).optional() }), req.body);
    const [mine] = await db.select({ id: incidents.id }).from(incidents).where(and(eq(incidents.raisedBy, c.userId), eq(incidents.kind, b.kind), eq(incidents.status, 'Open'), sql`${incidents.createdAt} > now() - interval '5 minutes'`));
    if (mine) return reply.status(200).send((await incidentOut(c.associationId, eq(incidents.id, mine.id)))[0]); // a second tap doesn't raise a second alarm
    const place = b.place || c.where;
    const [i] = await db.insert(incidents).values({ associationId: c.associationId, kind: b.kind, raisedBy: c.userId, raisedByName: c.name, raisedByRole: c.role, unitId: c.unitId, place, note: b.note }).returning();
    const title = `SOS · ${b.kind} · ${place}`, body = `${c.name}${b.note ? ': ' + b.note : ''}`;
    await notify(db, [...new Set([...(await guardsOf(c.associationId)), ...(await staffOfSociety(db, c.associationId, ['admin', 'committee']))])].filter(u => u !== c.userId), { kind: 'issues', title, body, href: '/incidents' });
    await audit(db, c.associationId, c.userId, c.name, `raised an SOS · ${b.kind} · ${place}`);
    return reply.status(201).send((await incidentOut(c.associationId, eq(incidents.id, i!.id)))[0]);
  });

  /** a guard says "on it" from the gate */
  app.post('/emergency/:id/ack', async req => {
    const c = await caller(req);
    if (c.role !== 'guard') throw forbidden();
    const { id } = parse(Id, req.params);
    const [i] = await db.update(incidents).set({ status: 'Acknowledged', ackByName: c.name, ackAt: new Date() }).where(and(eq(incidents.id, id), eq(incidents.associationId, c.associationId), eq(incidents.status, 'Open'))).returning();
    if (!i) throw conflict('not_open', 'Someone has already responded to this.');
    if (i.raisedBy) await notify(db, [i.raisedBy], { kind: 'issues', title: 'Help is on the way', body: `${c.name} at ${c.where} is responding to your ${i.kind.toLowerCase()} alert.`, href: '/emergency' });
    return (await incidentOut(c.associationId, eq(incidents.id, id)))[0];
  });

  app.get('/admin/:aid/incidents', async req => { const { aid } = await office(req, false); return incidentOut(aid); });
  app.post('/admin/:aid/incidents/:id/:verb', async req => {
    const { aid, by } = await office(req, false);
    const { id, verb } = parse(Id.extend({ verb: z.enum(['ack', 'resolve']) }), req.params);
    const b = parse(z.object({ resolution: z.string().trim().max(500).default('') }), req.body ?? {});
    const [cur] = await db.select().from(incidents).where(and(eq(incidents.id, id), eq(incidents.associationId, aid)));
    if (!cur) throw notFound('That incident');
    if (cur.status === 'Resolved') throw conflict('already_resolved', 'This incident is already closed.');
    if (verb === 'resolve' && b.resolution.length < 3) throw badRequest('say_what_happened', 'Say what happened and what was done — it goes on the incident log.');
    await db.update(incidents).set(verb === 'ack' ? { status: 'Acknowledged', ackByName: cur.ackByName ?? by.name, ackAt: cur.ackAt ?? new Date() }
      : { status: 'Resolved', resolvedByName: by.name, resolvedAt: new Date(), resolution: b.resolution, ackByName: cur.ackByName ?? by.name, ackAt: cur.ackAt ?? new Date() }).where(eq(incidents.id, id));
    if (cur.raisedBy) await notify(db, [cur.raisedBy], { kind: 'issues', title: verb === 'ack' ? 'The office is responding' : 'Your alert has been closed', body: verb === 'ack' ? `${by.name} has seen your ${cur.kind.toLowerCase()} alert.` : b.resolution, href: '/emergency' });
    await audit(db, aid, by.userId, by.name, `${verb === 'ack' ? 'acknowledged' : 'closed'} the ${cur.kind} incident raised by ${cur.raisedByName}`);
    return (await incidentOut(aid, eq(incidents.id, id)))[0];
  });
  /** tell everyone: an emergency broadcast is an Emergency message through the communication hub (see /comms/messages) */
  app.get('/admin/:aid/incidents/reach', async req => { const { aid } = await office(req, false); return { residents: (await residentsOf(db, aid)).length, guards: (await guardsOf(aid)).length }; });
};
