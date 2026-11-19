import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../app.js';
import { announcementAcks, announcements, associations, auditLog, contacts, knowledgeDocs, staffRoles, issueEvents, issueNotes, issues, messages, refreshTokens, unitMembers, units, users, vendors, type StaffRole } from '../db/schema.js';
import { audit } from '../lib/audit.js';
import { deliver } from '../lib/comms.js';
import { notify } from '../lib/community.js';
import { staffOf, userIdFrom } from '../lib/auth.js';
import { conflict, notFound, parse } from '../lib/http.js';

const Phone = z.string().regex(/^[6-9]\d{9}$/, 'Mobile numbers have 10 digits and start with 6, 7, 8 or 9');
import { loadIssue, moveIssue, parseRef, STATUSES } from '../lib/issues.js';

const Aid = z.object({ aid: z.uuid() });
const AidRef = Aid.extend({ ref: z.string() });

/** Society Admin console. Every route is scoped to one association: /v1/admin/:aid/… */
export const adminRoutes = ({ config, db, messenger }: Deps): FastifyPluginAsync => async app => {
  const staff = async (req: FastifyRequest, roles: StaffRole[] = ['admin', 'committee', 'operator']) => {
    const { aid } = parse(Aid, req.params);
    return { aid, s: await staffOf(db, await userIdFrom(req, config.JWT_SECRET), aid, roles) };
  };

  /* ---------- issues ---------- */
  app.get('/:aid/issues', async req => {
    const { aid } = await staff(req);
    const { status } = parse(z.object({ status: z.enum(STATUSES as [string, ...string[]]).optional() }), req.query);
    const rows = await db.select({ number: issues.number }).from(issues)
      .where(and(eq(issues.associationId, aid), status ? eq(issues.status, status as never) : undefined)).orderBy(desc(issues.createdAt));
    return Promise.all(rows.map(x => loadIssue(db, aid, x.number, { internal: true })));
  });

  app.get('/:aid/issues/:ref', async req => {
    const { aid } = await staff(req);
    return loadIssue(db, aid, parseRef(parse(AidRef, req.params).ref), { internal: true });
  });

  app.post('/:aid/issues/:ref/status', async req => {
    const { aid, s } = await staff(req, ['admin', 'operator']);
    const n = parseRef(parse(AidRef, req.params).ref);
    const b = parse(z.object({ to: z.enum(STATUSES as [string, ...string[]]), note: z.string().trim().max(500).optional(), vendorId: z.uuid().optional(), dueAt: z.iso.datetime({ offset: true }).optional(), accessNote: z.string().trim().max(300).optional() }), req.body);
    await moveIssue(db, { associationId: aid, number: n, to: b.to as never, note: b.note, vendorId: b.vendorId, byUserId: s.userId, byName: s.name, dueAt: b.dueAt ? new Date(b.dueAt) : undefined, accessNote: b.accessNote });
    return loadIssue(db, aid, n, { internal: true });
  });

  /** staff-only note — residents never see these */
  app.post('/:aid/issues/:ref/notes', async (req, reply) => {
    const { aid, s } = await staff(req);
    const n = parseRef(parse(AidRef, req.params).ref);
    const { text } = parse(z.object({ text: z.string().trim().min(1).max(1000) }), req.body);
    const [i] = await db.select({ id: issues.id }).from(issues).where(and(eq(issues.associationId, aid), eq(issues.number, n)));
    if (!i) throw notFound('Issue');
    await db.insert(issueNotes).values({ issueId: i.id, userId: s.userId, text });
    return reply.status(201).send(await loadIssue(db, aid, n, { internal: true }));
  });

  /** a public update on the ticket without moving its status — the resident sees it and is notified */
  app.post('/:aid/issues/:ref/updates', async (req, reply) => {
    const { aid, s } = await staff(req, ['admin', 'operator']);
    const n = parseRef(parse(AidRef, req.params).ref);
    const { text } = parse(z.object({ text: z.string().trim().min(1).max(500) }), req.body);
    const [i] = await db.select().from(issues).where(and(eq(issues.associationId, aid), eq(issues.number, n)));
    if (!i) throw notFound('Issue');
    await db.insert(issueEvents).values({ issueId: i.id, status: i.status, note: text, byUserId: s.userId });
    if (i.reporterId) await notify(db, [i.reporterId], { kind: 'issues', title: `Update on ISS-${n}`, body: text, href: '/issues/ISS-' + n });
    await audit(db, aid, s.userId, s.name, `update on ISS-${n} · “${text.slice(0, 60)}”`);
    return reply.status(201).send(await loadIssue(db, aid, n, { internal: true }));
  });

  app.get('/:aid/vendors', async req => {
    const { aid } = await staff(req);
    return db.select().from(vendors).where(eq(vendors.associationId, aid));
  });

  /* ---------- announcements ---------- */
  app.get('/:aid/announcements', async req => {
    const { aid } = await staff(req);
    return db.select({
      id: announcements.id, ref: announcements.ref, title: announcements.title, body: announcements.body, by: announcements.byName, priority: announcements.priority, audience: announcements.audience,
      requiresAck: announcements.requiresAck, publishedAt: announcements.publishedAt,
      acks: sql<number>`(select count(*)::int from ${announcementAcks} a where a.announcement_id = ${announcements.id})`,
    }).from(announcements).where(eq(announcements.associationId, aid)).orderBy(desc(announcements.publishedAt));
  });

  app.post('/:aid/announcements', async (req, reply) => {
    const { aid, s } = await staff(req, ['admin', 'operator']);
    const b = parse(z.object({
      title: z.string().trim().min(3).max(120), body: z.string().trim().min(3).max(4000),
      priority: z.enum(['High', 'Normal']).default('Normal'), audience: z.string().trim().max(80).default('All residents'),
      requiresAck: z.boolean().default(false), icon: z.string().max(40).optional(),
    }), req.body);
    const [{ next }] = (await db.select({ next: sql<number>`coalesce(max(${messages.number}), 100) + 1` }).from(messages).where(eq(messages.associationId, aid))) as [{ next: number }];
    const [m] = await db.insert(messages).values({
      associationId: aid, number: next, type: 'Announcement', title: b.title, body: b.body, priority: b.priority === 'High' ? 'Important' : 'Normal', channels: ['portal', 'push'],
      audience: { kind: 'all' }, audienceLabel: b.audience, requiresAck: b.requiresAck, createdBy: s.userId, byName: s.title && s.role !== 'vpm' ? `${s.name} (${s.title})` : s.name,
    }).returning();
    let sent;
    try { sent = await deliver(db, messenger, m!.id); }
    catch (e) { await db.delete(messages).where(eq(messages.id, m!.id)); throw e; }
    const [row] = await db.select().from(announcements).where(eq(announcements.id, sent.message.announcementId!));
    if (b.icon) await db.update(announcements).set({ icon: b.icon }).where(eq(announcements.id, row!.id));
    await audit(db, aid, s.userId, s.name, `published announcement ${sent.ref} · ${b.priority}${b.requiresAck ? ' · acknowledgement required' : ''}`);
    return reply.status(201).send(row);
  });

  /** correct a published notice — residents see the new wording; nobody is notified again */
  app.put('/:aid/announcements/:ref', async req => {
    const { aid, s } = await staff(req, ['admin', 'operator']);
    const { ref } = parse(AidRef, req.params);
    const b = parse(z.object({ title: z.string().trim().min(3).max(120), body: z.string().trim().min(3).max(4000), priority: z.enum(['High', 'Normal']) }), req.body);
    const [row] = await db.update(announcements).set({ title: b.title, body: b.body, priority: b.priority, requiresAck: b.priority === 'High' })
      .where(and(eq(announcements.associationId, aid), eq(announcements.ref, ref))).returning();
    if (!row) throw notFound('Announcement');
    // keep the Communication record of the same notice in step
    if (row.messageId) await db.update(messages).set({ title: b.title, body: b.body, priority: b.priority === 'High' ? 'Important' : 'Normal', requiresAck: b.priority === 'High' }).where(eq(messages.id, row.messageId));
    await audit(db, aid, s.userId, s.name, `edited announcement ${ref} · “${b.title.slice(0, 60)}”`);
    return row;
  });

  /** take a notice off the residents' board for good, with its acknowledgements */
  app.delete('/:aid/announcements/:ref', async req => {
    const { aid, s } = await staff(req, ['admin', 'operator']);
    const { ref } = parse(AidRef, req.params);
    const [row] = await db.delete(announcements).where(and(eq(announcements.associationId, aid), eq(announcements.ref, ref))).returning();
    if (!row) throw notFound('Announcement');
    await audit(db, aid, s.userId, s.name, `deleted announcement ${ref} · “${row.title.slice(0, 60)}”`);
    return { ok: true };
  });

  /** A new society's first steps, and which of them are done — the dashboard shows this until nothing is left. */
  app.get('/:aid/setup', async req => {
    const { aid } = await staff(req);
    const n = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
    const count = sql<number>`count(*)::int`;
    const [flats, residents, docs, notices, vendorCount, team, committee] = await Promise.all([
      n(db.select({ n: count }).from(units).where(eq(units.associationId, aid))),
      n(db.select({ n: sql<number>`count(distinct ${unitMembers.userId})::int` }).from(unitMembers).innerJoin(units, eq(units.id, unitMembers.unitId)).where(and(eq(units.associationId, aid), eq(unitMembers.status, 'active')))),
      n(db.select({ n: count }).from(knowledgeDocs).where(eq(knowledgeDocs.associationId, aid))),
      n(db.select({ n: count }).from(announcements).where(eq(announcements.associationId, aid))),
      n(db.select({ n: count }).from(vendors).where(eq(vendors.associationId, aid))),
      n(db.select({ n: count }).from(staffRoles).where(and(eq(staffRoles.associationId, aid), inArray(staffRoles.role, ['admin', 'committee', 'moderator', 'auditor'])))),
      // the helplines are there from the start; the step is done once the society's own people are listed
      n(db.select({ n: count }).from(contacts).where(and(eq(contacts.associationId, aid), eq(contacts.group, 'committee')))),
    ]);
    const steps = [
      { key: 'flats', title: 'Add your flats', body: 'A whole tower at once, or a run of numbered plots.', to: '/flats', count: flats, done: flats > 0 },
      { key: 'residents', title: 'Register residents', body: 'Add each flat’s owner — they can then sign in on the app.', to: '/residents', count: residents, done: residents > 0 },
      { key: 'knowledge', title: 'Add timings and rules for the assistant', body: 'Pool, gym, office hours, waste days — what residents ask most.', to: '/ai', count: docs, done: docs > 0 },
      { key: 'directory', title: 'Add committee and security contacts', body: 'Who residents call — the committee, the security office, approved vendors.', to: '/directory', count: committee, done: committee > 0 },
      { key: 'notice', title: 'Publish a welcome notice', body: 'The first thing residents see when they open the app.', to: '/announcements', count: notices, done: notices > 0 },
      { key: 'vendors', title: 'Add your vendors', body: 'Plumber, electrician, lift AMC — so issues can be assigned.', to: '/maintenance', count: vendorCount, done: vendorCount > 0 },
      { key: 'team', title: 'Invite your team', body: 'Give the accountant or front desk only the sections they need.', to: '/team', count: team, done: team > 1 },
    ];
    return { steps, done: steps.filter(s => s.done).length, total: steps.length };
  });

  /* ---------- people ---------- */
  app.get('/:aid/units', async req => {
    const { aid } = await staff(req);
    const list = await db.select().from(units).where(eq(units.associationId, aid)).orderBy(units.code);
    const members = list.length
      ? await db.select({ unitId: unitMembers.unitId, memberId: unitMembers.id, name: users.name, phone: users.phone, role: unitMembers.role, status: unitMembers.status })
        .from(unitMembers).innerJoin(users, eq(users.id, unitMembers.userId)).where(inArray(unitMembers.unitId, list.map(u => u.id)))
      : [];
    return list.map(u => ({ ...u, members: members.filter(m => m.unitId === u.id).map(({ unitId: _u, ...m }) => m) }));
  });

  /** the society's towers and blocks, in the order the office arranged them; any it has not placed yet follow in name order */
  const towersOf = async (aid: string) => {
    const [a] = await db.select({ order: associations.towerOrder }).from(associations).where(eq(associations.id, aid));
    const have = (await db.selectDistinct({ tower: units.tower }).from(units).where(eq(units.associationId, aid))).map(t => t.tower);
    const placed = (a?.order ?? []).filter(t => have.includes(t));
    const rest = have.filter(t => !placed.includes(t)).sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));
    return [...placed, ...rest];
  };
  app.get('/:aid/towers', async req => { const { aid } = await staff(req); return { order: await towersOf(aid) }; });
  app.put('/:aid/towers/order', async req => {
    const { aid, s } = await staff(req, ['admin', 'operator']);
    const { towers } = parse(z.object({ towers: z.array(z.string().trim().min(1).max(40)).max(500) }), req.body);
    // only towers this society really has are kept, each once
    const have = await towersOf(aid);
    const order = [...new Set(towers)].filter(t => have.includes(t));
    await db.update(associations).set({ towerOrder: order }).where(eq(associations.id, aid));
    await audit(db, aid, s.userId, s.name, 'rearranged the towers');
    return { order: await towersOf(aid) };
  });

  /**
   * Add flats or plots — one, or a whole tower at once. A code the society already has is left
   * alone and counted as skipped, so the same list can be sent twice without harm.
   */
  app.post('/:aid/units', async (req, reply) => {
    const { aid, s } = await staff(req, ['admin', 'operator']);
    const { units: list } = parse(z.object({
      units: z.array(z.object({
        code: z.string().trim().min(1).max(20).regex(/^[A-Za-z0-9][A-Za-z0-9 /-]*$/, 'Use letters, numbers, spaces, - or /'),
        tower: z.string().trim().min(1).max(40), label: z.string().trim().max(80).optional(),
        area: z.number().int().min(0).max(100000).default(0), flatType: z.string().trim().max(20).default(''),
        occupancy: z.enum(['Owner-occupied', 'Rented', 'Vacant']).default('Vacant'),
      })).min(1).max(2000),
    }), req.body);
    const seen = new Set<string>();
    const fresh = list.filter(u => { const k = u.code.toUpperCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    const added = await db.insert(units).values(fresh.map(u => ({ ...u, code: u.code.toUpperCase(), label: u.label || `${u.tower}, ${u.code.toUpperCase()}`, associationId: aid })))
      .onConflictDoNothing({ target: [units.associationId, units.code] }).returning({ code: units.code });
    if (added.length) await audit(db, aid, s.userId, s.name, added.length === 1 ? `flat added · ${added[0]!.code}` : `${added.length} flats added · ${added[0]!.code} to ${added[added.length - 1]!.code}`);
    return reply.status(201).send({ added: added.length, skipped: list.length - added.length });
  });

  /** remove a flat added by mistake — only while nobody lives in it and nothing has been raised on it */
  app.delete('/:aid/units/:id', async req => {
    const { aid, s } = await staff(req, ['admin', 'operator']);
    const { id } = parse(Aid.extend({ id: z.uuid() }), req.params);
    const [u] = await db.select({ code: units.code }).from(units).where(and(eq(units.id, id), eq(units.associationId, aid)));
    if (!u) throw notFound('Flat');
    const [m] = await db.select({ n: sql<number>`count(*)::int` }).from(unitMembers).where(eq(unitMembers.unitId, id));
    const [i] = await db.select({ n: sql<number>`count(*)::int` }).from(issues).where(eq(issues.unitId, id));
    if (m!.n || i!.n) throw conflict('flat_in_use', m!.n ? 'People are registered in this flat. Move them out first.' : 'Issues have been raised on this flat, so it is kept for the record.');
    try { await db.delete(units).where(eq(units.id, id)); }
    catch { throw conflict('flat_in_use', 'This flat has bills or other records, so it is kept for the record.'); }
    await audit(db, aid, s.userId, s.name, `flat removed · ${u.code}`);
    return { removed: true };
  });

  /**
   * The office registers a resident in a flat: the owner when a flat is first set up, or anyone the
   * office already knows. They sign in on the app with this mobile number straight away — no
   * verification step, because it is the office itself that is adding them.
   */
  app.post('/:aid/units/:id/members', async (req, reply) => {
    const { aid, s } = await staff(req, ['admin', 'operator']);
    const { id } = parse(Aid.extend({ id: z.uuid() }), req.params);
    const b = parse(z.object({ name: z.string().trim().min(2).max(80), phone: Phone, role: z.enum(['Owner', 'Tenant', 'Family']) }), req.body);
    const [u] = await db.select().from(units).where(and(eq(units.id, id), eq(units.associationId, aid)));
    if (!u) throw notFound('Flat');
    const row = await db.transaction(async tx => {
      let [person] = await tx.select().from(users).where(eq(users.phone, b.phone));
      if (person?.deletedAt) throw conflict('number_unavailable', 'That number belonged to an account that was deleted, so it can’t be registered again.');
      if (person) {
        // the app opens one home per number, so a number already living somewhere else is not quietly given a second
        const [other] = await tx.select({ code: units.code }).from(unitMembers).innerJoin(units, eq(units.id, unitMembers.unitId))
          .where(and(eq(unitMembers.userId, person.id), ne(unitMembers.unitId, id))).limit(1);
        if (other) throw conflict('number_in_use', `That number is already registered to ${other.code}. Remove it there first.`);
        const [here] = await tx.select({ id: unitMembers.id, status: unitMembers.status }).from(unitMembers).where(and(eq(unitMembers.userId, person.id), eq(unitMembers.unitId, id)));
        if (here?.status === 'active') throw conflict('already_member', 'That number is already registered in this flat.');
      }
      if (!person) [person] = await tx.insert(users).values({ name: b.name, phone: b.phone }).returning();
      const [m] = await tx.insert(unitMembers).values({ unitId: id, userId: person!.id, role: b.role, status: 'active' })
        .onConflictDoUpdate({ target: [unitMembers.unitId, unitMembers.userId], set: { status: 'active', role: b.role } }).returning();
      // a flat marked vacant is not vacant once someone lives in it
      if (u.occupancy === 'Vacant' && b.role !== 'Family') await tx.update(units).set({ occupancy: b.role === 'Tenant' ? 'Rented' : 'Owner-occupied' }).where(eq(units.id, id));
      await audit(tx, aid, s.userId, s.name, `resident registered · ${person!.name} (${b.role}) → ${u.code}`);
      return { memberId: m!.id, name: person!.name, phone: person!.phone, role: m!.role, status: m!.status };
    });
    return reply.status(201).send(row);
  });

  /** someone has moved out, or was registered by mistake: they can no longer open this flat in the app */
  app.delete('/:aid/units/:id/members/:mid', async req => {
    const { aid, s } = await staff(req, ['admin', 'operator']);
    const { id, mid } = parse(Aid.extend({ id: z.uuid(), mid: z.uuid() }), req.params);
    const [m] = await db.select({ userId: unitMembers.userId, name: users.name, code: units.code }).from(unitMembers)
      .innerJoin(units, eq(units.id, unitMembers.unitId)).innerJoin(users, eq(users.id, unitMembers.userId))
      .where(and(eq(unitMembers.id, mid), eq(unitMembers.unitId, id), eq(units.associationId, aid)));
    if (!m) throw notFound('Resident');
    await db.delete(unitMembers).where(eq(unitMembers.id, mid));
    await db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.userId, m.userId), isNull(refreshTokens.revokedAt)));
    await audit(db, aid, s.userId, s.name, `resident removed · ${m.name} from ${m.code}`);
    return { removed: true };
  });

  app.get('/:aid/audit', async req => {
    const { aid } = await staff(req);
    return db.select({ actor: auditLog.actor, action: auditLog.action, at: auditLog.createdAt }).from(auditLog)
      .where(eq(auditLog.associationId, aid)).orderBy(desc(auditLog.createdAt)).limit(200);
  });
};
