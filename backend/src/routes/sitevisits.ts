import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../app.js';
import {
  issues, siteItems, sitePlans, siteVisits, staffNotes, staffRoles, unitMembers, units, users, vendors,
  type SiteItemStatus, type SiteVisitStatus, type StaffRole,
} from '../db/schema.js';
import { audit } from '../lib/audit.js';
import { residentOf, staffOf, userIdFrom } from '../lib/auth.js';
import { notify } from '../lib/community.js';
import { isOnline } from '../lib/presence.js';
import { primaryVpms } from '../lib/vpm.js';
import { badRequest, conflict, notFound, parse } from '../lib/http.js';

const Aid = z.object({ aid: z.uuid() });
const AidId = Aid.extend({ id: z.uuid() });
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Give the date as YYYY-MM-DD');
const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Give the time as HH:MM');
const Ref = z.string().regex(/^ISS-\d+$/i, 'Give the request number, e.g. ISS-1043');
const READERS: StaffRole[] = ['admin', 'committee', 'moderator', 'auditor', 'operator'];
const WRITERS: StaffRole[] = ['admin', 'committee', 'operator'];
const OPEN_STATUSES = ['Submitted', 'Acknowledged', 'Assigned', 'In Progress', 'On Hold'] as const;

/* ---------- days, on the society's (IST) calendar ---------- */
const IST = 330 * 60_000;
/** today in India, YYYY-MM-DD */
export const todayIst = (now = Date.now()) => new Date(now + IST).toISOString().slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(day + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
const weekdayOf = (day: string) => new Date(day + 'T00:00:00Z').getUTCDay();
/** the instant a visit day + 'HH:MM' happens, as an ISO string */
const instant = (day: string, hhmm: string) => new Date(Date.parse(`${day}T${hhmm}:00Z`) - IST).toISOString();

type Plan = { weekday: number; start: string; end: string };
type Visit = typeof siteVisits.$inferSelect;
type Item = typeof siteItems.$inferSelect;

/**
 * The property manager's weekly on-site visit.
 *   /v1/manager                        the resident: who their property manager is, the next visits, and asking for something on one
 *   /v1/admin/:aid/site-visits…        the manager and the office: the regular slot, each day's agenda, residents' requests
 *   /v1/admin/:aid/stats/operations    resolution time, satisfaction and vendor workload for the dashboard
 */
export const siteVisitRoutes = ({ config, db }: Deps): FastifyPluginAsync => async app => {
  const uid = (req: FastifyRequest) => userIdFrom(req, config.JWT_SECRET);
  const staff = async (req: FastifyRequest, roles = READERS) => {
    const { aid } = parse(Aid, req.params);
    return { aid, s: await staffOf(db, await uid(req), aid, roles) };
  };

  /** the society's property manager as residents see them: the primary one when several are assigned (lib/vpm.ts), none when there is none */
  const managerOf = async (aid: string) => {
    const id = (await primaryVpms(db, [aid])).get(aid);
    if (!id) return null;
    const [m] = await db.select({ id: users.id, name: users.name, phone: users.phone, title: staffRoles.title })
      .from(staffRoles).innerJoin(users, eq(users.id, staffRoles.userId))
      .where(and(eq(staffRoles.associationId, aid), eq(staffRoles.role, 'vpm'), eq(users.id, id))).limit(1);
    return m ? { id: m.id, name: m.name, phone: m.phone, title: m.title || 'Property Manager' } : null;
  };
  const planOf = async (aid: string): Promise<Plan | null> => {
    const [p] = await db.select().from(sitePlans).where(eq(sitePlans.associationId, aid));
    return p ? { weekday: p.weekday, start: p.start, end: p.end } : null;
  };
  /** who to tell about a resident's request: the office and the property manager */
  const officeIds = async (aid: string) =>
    (await db.select({ userId: staffRoles.userId }).from(staffRoles).where(and(eq(staffRoles.associationId, aid), inArray(staffRoles.role, ['admin', 'vpm'])))).map(r => r.userId);

  /** the visit days from `from` for `n` days: the stored ones, and the regular slot's days that nothing has been stored for yet */
  const days = async (aid: string, from: string, n: number) => {
    const to = addDays(from, n);
    const plan = await planOf(aid);
    const stored = await db.select().from(siteVisits)
      .where(and(eq(siteVisits.associationId, aid), gte(siteVisits.date, from), lt(siteVisits.date, to))).orderBy(asc(siteVisits.date));
    const out: (Pick<Visit, 'date' | 'start' | 'end' | 'status' | 'note'> & { id: string | null })[] = stored.map(v => ({ id: v.id, date: v.date, start: v.start, end: v.end, status: v.status, note: v.note }));
    if (plan) for (let d = from; d < to; d = addDays(d, 1)) {
      if (weekdayOf(d) === plan.weekday && !out.some(v => v.date === d)) out.push({ id: null, date: d, start: plan.start, end: plan.end, status: 'Planned', note: '' });
    }
    return { plan, days: out.sort((a, b) => a.date.localeCompare(b.date)) };
  };
  /** the row for a visit day, made from the regular slot (or the given hours) the first time something is put on it */
  const ensureVisit = async (aid: string, date: string, hours?: { start?: string; end?: string }) => {
    const [have] = await db.select().from(siteVisits).where(and(eq(siteVisits.associationId, aid), eq(siteVisits.date, date)));
    if (have) return have;
    const plan = await planOf(aid);
    const start = hours?.start ?? plan?.start ?? '09:00', end = hours?.end ?? plan?.end ?? '12:00';
    const [made] = await db.insert(siteVisits).values({ associationId: aid, date, start, end }).onConflictDoNothing().returning();
    return made ?? (await db.select().from(siteVisits).where(and(eq(siteVisits.associationId, aid), eq(siteVisits.date, date))))[0]!;
  };

  const cancelled = () => conflict('visit_cancelled', 'That visit is cancelled — choose another day, or restore the visit first.');

  /** items with the facts the screens show: the request number, who asked and their flat */
  const detail = async (list: Item[]) => {
    if (!list.length) return [];
    const issueIds = [...new Set(list.map(i => i.issueId).filter((x): x is string => !!x))];
    const people = [...new Set(list.map(i => i.requestedBy).filter((x): x is string => !!x))];
    const visitIds = [...new Set(list.map(i => i.visitId).filter((x): x is string => !!x))];
    const iss = issueIds.length ? await db.select({ id: issues.id, number: issues.number, status: issues.status, scope: issues.scope, reporterId: issues.reporterId, unitId: issues.unitId }).from(issues).where(inArray(issues.id, issueIds)) : [];
    const who = people.length ? await db.select({ id: users.id, name: users.name, unit: units.code }).from(users)
      .leftJoin(unitMembers, and(eq(unitMembers.userId, users.id), eq(unitMembers.status, 'active'))).leftJoin(units, eq(units.id, unitMembers.unitId))
      .where(inArray(users.id, people)) : [];
    const vis = visitIds.length ? await db.select({ id: siteVisits.id, date: siteVisits.date }).from(siteVisits).where(inArray(siteVisits.id, visitIds)) : [];
    return list.map(i => {
      const is = iss.find(x => x.id === i.issueId), p = who.find(x => x.id === i.requestedBy);
      return {
        id: i.id, date: vis.find(v => v.id === i.visitId)?.date ?? null, time: i.time, title: i.title, location: i.location, kind: i.kind, status: i.status,
        extra: i.extra, note: i.note, reply: i.reply, createdAt: i.createdAt,
        issue: is ? { ref: 'ISS-' + is.number, status: is.status, scope: is.scope, reporterId: is.reporterId, unitId: is.unitId } : null,
        requestedBy: i.requestedBy, resident: p ? { name: p.name, unit: p.unit } : null,
      };
    });
  };
  const sortItems = <T extends { time: string | null; createdAt: Date }>(l: T[]) =>
    l.sort((a, b) => (a.time ?? '99:99').localeCompare(b.time ?? '99:99') || a.createdAt.getTime() - b.createdAt.getTime());

  /* =============== the resident =============== */
  app.get('/manager', async req => {
    const me = await residentOf(db, await uid(req));
    const aid = me.associationId, today = todayIst();
    const manager = await managerOf(aid);
    const card = manager && { name: manager.name, title: manager.title, phone: manager.phone, online: await isOnline(db, manager.id) };
    // before the visit tables exist (a migration not yet run) residents still see their manager, with no visits
    try { return { manager: card, ...(await schedule(me, aid, today)) }; } catch { return { manager: card, plan: null, next: null, visits: [], requests: [] }; }
  });
  /** the visits a resident sees, and their own requests */
  const schedule = async (me: Awaited<ReturnType<typeof residentOf>>, aid: string, today: string) => {
    const { plan, days: list } = await days(aid, today, 28);
    const ids = list.map(d => d.id).filter((x): x is string => !!x);
    const items = await detail(ids.length ? await db.select().from(siteItems).where(and(inArray(siteItems.visitId, ids), inArray(siteItems.status, ['Scheduled', 'Done']))) : []);
    // another resident's request, or work on someone else's flat, is theirs: other residents see only that it is on the list
    const isMine = (i: (typeof items)[number]) => i.requestedBy === me.userId || i.issue?.reporterId === me.userId || (!!i.issue && i.issue.unitId === me.unitId);
    const isPrivate = (i: (typeof items)[number]) => i.kind === 'Request' || i.issue?.scope === 'unit';
    const visits = list.map(d => {
      const on = items.filter(i => d.id && i.date === d.date);
      const shown = on.filter(i => !isPrivate(i) || isMine(i));
      return {
        date: d.date, start: d.start, end: d.end, status: d.status, note: d.note, startsAt: instant(d.date, d.start),
        items: sortItems(shown.map(i => ({ ...i, createdAt: new Date(i.createdAt) }))).map(i => ({ id: i.id, time: i.time, title: i.title, location: i.location, kind: i.kind, status: i.status, mine: isMine(i), ref: isMine(i) ? i.issue?.ref ?? null : null })),
        others: on.length - shown.length,
      };
    });
    const mine = await detail(await db.select().from(siteItems).where(and(eq(siteItems.associationId, aid), eq(siteItems.requestedBy, me.userId))).orderBy(desc(siteItems.createdAt)).limit(20));
    const next = visits.find(v => v.status === 'Planned' && Date.parse(instant(v.date, v.end)) > Date.now()) ?? null;
    return {
      plan, next: next && { date: next.date, start: next.start, end: next.end, startsAt: next.startsAt },
      visits,
      requests: mine.map(i => ({ id: i.id, title: i.title, kind: i.kind, status: i.status, extra: i.extra, date: i.date, time: i.time, note: i.note, reply: i.reply, ref: i.issue?.ref ?? null, createdAt: i.createdAt })),
    };
  };

  /** ask for something to be looked at on the next visit (or a given one), or for a visit outside the regular slot */
  app.post('/manager/requests', async (req, reply) => {
    const me = await residentOf(db, await uid(req));
    const aid = me.associationId;
    const b = parse(z.object({ issueRef: Ref.optional(), note: z.string().trim().max(500).default(''), extra: z.boolean().default(false), date: Day.optional() }), req.body);
    let issue: { id: string; title: string; location: string } | undefined;
    if (b.issueRef) {
      const number = Number(b.issueRef.slice(4));
      const [i] = await db.select({ id: issues.id, title: issues.title, location: issues.location, status: issues.status, reporterId: issues.reporterId, unitId: issues.unitId })
        .from(issues).where(and(eq(issues.associationId, aid), eq(issues.number, number)));
      // only the resident's own request, or one on their flat
      if (!i || (i.reporterId !== me.userId && i.unitId !== me.unitId)) throw notFound('That request');
      if (!(OPEN_STATUSES as readonly string[]).includes(i.status)) throw conflict('issue_closed', 'That request is already resolved.');
      const [dup] = await db.select({ id: siteItems.id }).from(siteItems).where(and(eq(siteItems.issueId, i.id), inArray(siteItems.status, ['Requested', 'Scheduled'])));
      if (dup) throw conflict('already_on_visit', 'That request is already on the property manager’s visit list.');
      issue = i;
    } else if (b.note.length < 3) throw badRequest('note_required', 'Tell the property manager what you’d like looked at.');

    let visitId: string | null = null;
    if (!b.extra) {
      const today = todayIst();
      const { days: upcoming } = await days(aid, today, 42);
      const open = upcoming.filter(d => d.status === 'Planned' && Date.parse(instant(d.date, d.end)) > Date.now());
      const target = b.date ? open.find(d => d.date === b.date) : open[0];
      if (!target) throw conflict('no_visit', b.date ? 'There’s no on-site visit planned that day.' : 'No on-site visit is planned yet — ask for a visit outside the schedule instead.');
      visitId = (await ensureVisit(aid, target.date)).id;
    }
    const [made] = await db.insert(siteItems).values({
      associationId: aid, visitId, title: issue?.title ?? b.note.slice(0, 120), location: issue?.location ?? me.unitLabel, kind: 'Request', status: 'Requested',
      issueId: issue?.id ?? null, requestedBy: me.userId, extra: b.extra, note: b.note,
    }).returning();
    await notify(db, await officeIds(aid), {
      kind: 'issues', title: `${me.name} (${me.unitCode}) ${b.extra ? 'asked for a visit outside the schedule' : 'added a request for the on-site visit'}`,
      body: (issue ? `${b.issueRef!.toUpperCase()} · ${issue.title}` : b.note).slice(0, 140), href: '/visits',
    });
    const [out] = await detail([made!]);
    return reply.status(201).send(out);
  });

  /** a resident takes back a request the manager hasn't answered yet */
  app.delete('/manager/requests/:id', async (req, reply) => {
    const me = await residentOf(db, await uid(req));
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    const [gone] = await db.delete(siteItems).where(and(eq(siteItems.id, id), eq(siteItems.requestedBy, me.userId), eq(siteItems.status, 'Requested'))).returning();
    if (!gone) throw notFound('That request');
    return reply.status(204).send();
  });

  /* =============== the manager and the office =============== */
  app.get('/admin/:aid/site-visits', async req => {
    const { aid } = await staff(req);
    const q = parse(z.object({ from: Day.optional(), days: z.coerce.number().int().min(1).max(62).default(14) }), req.query);
    const from = q.from ?? todayIst();
    const { plan, days: list } = await days(aid, from, q.days);
    const ids = list.map(d => d.id).filter((x): x is string => !!x);
    const items = await detail(ids.length ? await db.select().from(siteItems).where(and(inArray(siteItems.visitId, ids), inArray(siteItems.status, ['Scheduled', 'Done']))) : []);
    const waiting = await detail(await db.select().from(siteItems).where(and(eq(siteItems.associationId, aid), eq(siteItems.status, 'Requested'))).orderBy(asc(siteItems.createdAt)));
    const strip = ({ requestedBy: _r, issue, ...i }: (typeof items)[number]) => ({ ...i, ref: issue?.ref ?? null, issueStatus: issue?.status ?? null });
    return {
      manager: await managerOf(aid), plan, today: todayIst(),
      days: list.map(d => ({ ...d, startsAt: instant(d.date, d.start), items: sortItems(items.filter(i => d.id && i.date === d.date).map(i => ({ ...i, createdAt: new Date(i.createdAt) }))).map(strip) })),
      requests: waiting.map(strip),
    };
  });

  /** the regular slot */
  app.put('/admin/:aid/site-visits/plan', async req => {
    const { aid, s } = await staff(req, WRITERS);
    const b = parse(z.object({ weekday: z.number().int().min(0).max(6), start: Time, end: Time }), req.body);
    if (b.start >= b.end) throw badRequest('bad_hours', 'The visit has to end after it starts.');
    await db.insert(sitePlans).values({ associationId: aid, ...b }).onConflictDoUpdate({ target: sitePlans.associationId, set: { ...b, updatedAt: new Date() } });
    await audit(db, aid, s.userId, s.name, `Set the on-site visit to ${['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'][b.weekday]} ${b.start}–${b.end}`);
    return b;
  });
  app.delete('/admin/:aid/site-visits/plan', async (req, reply) => {
    const { aid, s } = await staff(req, WRITERS);
    await db.delete(sitePlans).where(eq(sitePlans.associationId, aid));
    await audit(db, aid, s.userId, s.name, 'Stopped the regular on-site visit');
    return reply.status(204).send();
  });

  /** add a visit day, change its hours, cancel it or mark it done */
  app.put('/admin/:aid/site-visits/days/:date', async req => {
    const { aid, s } = await staff(req, WRITERS);
    const { date } = parse(Aid.extend({ date: Day }), req.params);
    const b = parse(z.object({ start: Time.optional(), end: Time.optional(), status: z.enum(['Planned', 'Done', 'Cancelled']).optional(), note: z.string().trim().max(300).optional() }), req.body);
    const v = await ensureVisit(aid, date, b);
    const start = b.start ?? v.start, end = b.end ?? v.end;
    if (start >= end) throw badRequest('bad_hours', 'The visit has to end after it starts.');
    const [u] = await db.update(siteVisits).set({ start, end, ...(b.status ? { status: b.status } : {}), ...(b.note !== undefined ? { note: b.note } : {}) }).where(eq(siteVisits.id, v.id)).returning();
    if (b.status && b.status !== v.status) {
      await audit(db, aid, s.userId, s.name, `${b.status === 'Cancelled' ? 'Cancelled' : b.status === 'Done' ? 'Completed' : 'Re-planned'} the on-site visit on ${date}`);
      if (b.status === 'Cancelled') {
        // residents' requests on that day go back to the manager's list, to be put on another visit — and the residents are told
        const moved = await db.update(siteItems).set({ visitId: null, time: null, status: 'Requested' })
          .where(and(eq(siteItems.visitId, v.id), eq(siteItems.kind, 'Request'), inArray(siteItems.status, ['Requested', 'Scheduled']))).returning({ by: siteItems.requestedBy });
        await notify(db, [...new Set(moved.map(m => m.by).filter((x): x is string => !!x))], {
          kind: 'issues', title: `The property manager’s visit on ${date} is cancelled`,
          body: b.note ? `${b.note} — your request is back with the property manager for another visit.` : 'Your request is back with the property manager, who will put it on another visit.', href: '/visits',
        });
      }
    }
    return { id: u!.id, date: u!.date, start: u!.start, end: u!.end, status: u!.status as SiteVisitStatus, note: u!.note };
  });

  /** put something on a visit's agenda */
  app.post('/admin/:aid/site-visits/items', async (req, reply) => {
    const { aid, s } = await staff(req, WRITERS);
    const b = parse(z.object({
      date: Day, time: Time.optional(), title: z.string().trim().min(3).max(120), location: z.string().trim().max(120).default(''),
      kind: z.enum(['Inspection', 'Meeting', 'Follow-up']), issueRef: Ref.optional(), note: z.string().trim().max(500).default(''),
    }), req.body);
    let issueId: string | null = null;
    if (b.issueRef) {
      const [i] = await db.select({ id: issues.id }).from(issues).where(and(eq(issues.associationId, aid), eq(issues.number, Number(b.issueRef.slice(4)))));
      if (!i) throw notFound('That request');
      issueId = i.id;
    }
    const v = await ensureVisit(aid, b.date);
    if (v.status === 'Cancelled') throw cancelled();
    const [made] = await db.insert(siteItems).values({ associationId: aid, visitId: v.id, time: b.time ?? null, title: b.title, location: b.location, kind: b.kind, status: 'Scheduled', issueId, note: b.note }).returning();
    await audit(db, aid, s.userId, s.name, `Planned “${b.title}” for the on-site visit on ${b.date}`);
    const [out] = await detail([made!]);
    return reply.status(201).send(out);
  });

  /** answer a resident's request, move an item to another day or time, or tick it off */
  app.put('/admin/:aid/site-visits/items/:id', async req => {
    const { aid, s } = await staff(req, WRITERS);
    const { id } = parse(AidId, req.params);
    const b = parse(z.object({
      status: z.enum(['Scheduled', 'Done', 'Declined']).optional(), date: Day.optional(), time: Time.nullable().optional(),
      title: z.string().trim().min(3).max(120).optional(), location: z.string().trim().max(120).optional(), reply: z.string().trim().max(300).optional(),
    }), req.body);
    const [it] = await db.select().from(siteItems).where(and(eq(siteItems.id, id), eq(siteItems.associationId, aid)));
    if (!it) throw notFound('That visit item');
    const visit = b.date ? await ensureVisit(aid, b.date) : it.visitId ? (await db.select().from(siteVisits).where(eq(siteVisits.id, it.visitId)))[0] : undefined;
    const visitId = visit?.id ?? null;
    if ((b.status === 'Scheduled' || b.status === 'Done') && !visitId) throw badRequest('date_required', 'Choose the day of the visit.');
    // nothing new goes on a cancelled visit; taking an item off it (declining) is still fine
    if (visit?.status === 'Cancelled' && (b.date || b.status === 'Scheduled' || b.status === 'Done')) throw cancelled();
    const [u] = await db.update(siteItems).set({
      visitId, ...(b.status ? { status: b.status as SiteItemStatus } : {}), ...(b.time !== undefined ? { time: b.time } : {}),
      ...(b.title ? { title: b.title } : {}), ...(b.location !== undefined ? { location: b.location } : {}), ...(b.reply !== undefined ? { reply: b.reply } : {}),
    }).where(eq(siteItems.id, id)).returning();
    const [out] = await detail([u!]);
    if (b.status && b.status !== it.status) {
      await audit(db, aid, s.userId, s.name, `${b.status === 'Declined' ? 'Declined' : b.status === 'Done' ? 'Completed' : 'Scheduled'} “${it.title}” on the on-site visit`);
      if (it.requestedBy) {
        const title = b.status === 'Declined' ? 'Your visit request was declined'
          : b.status === 'Done' ? 'The property manager looked at your request'
          : `Your request is on the property manager’s visit${out!.date ? ' on ' + out!.date : ''}${u!.time ? ' at ' + u!.time : ''}`;
        await notify(db, [it.requestedBy], { kind: 'issues', title, body: (u!.reply || it.title).slice(0, 140), href: '/visits' });
      }
    }
    return out;
  });

  app.delete('/admin/:aid/site-visits/items/:id', async (req, reply) => {
    const { aid, s } = await staff(req, WRITERS);
    const { id } = parse(AidId, req.params);
    const [gone] = await db.delete(siteItems).where(and(eq(siteItems.id, id), eq(siteItems.associationId, aid))).returning();
    if (!gone) throw notFound('That visit item');
    await audit(db, aid, s.userId, s.name, `Removed “${gone.title}” from the on-site visits`);
    return reply.status(204).send();
  });

  /* =============== numbers for the dashboard =============== */
  /**
   * Resolution time, resident satisfaction and vendor workload — all from what is already stored.
   * A request's resolution time runs from when it was raised to its latest "Resolved" step, for requests that are resolved or closed.
   * "Pending vendor" is a request assigned to a vendor who hasn't started; there is no separate status for it.
   */
  app.get('/admin/:aid/stats/operations', async req => {
    const { aid } = await staff(req);
    const q = async <T>(query: ReturnType<typeof sql>) => ((await db.execute(query)) as unknown as { rows: T[] }).rows;
    const resolved = sql`(select i.id, i.vendor_id, i.created_at, max(e.created_at) as resolved_at from issues i join issue_events e on e.issue_id = i.id and e.status = 'Resolved'
                          where i.association_id = ${aid} and i.status in ('Resolved','Closed') group by i.id)`;
    const [speed] = await q<{ now: number | null; prev: number | null; n: number }>(sql`
      select avg(extract(epoch from r.resolved_at - r.created_at) / 3600) filter (where r.resolved_at > now() - interval '30 days')::float as now,
             avg(extract(epoch from r.resolved_at - r.created_at) / 3600) filter (where r.resolved_at > now() - interval '60 days' and r.resolved_at <= now() - interval '30 days')::float as prev,
             count(*) filter (where r.resolved_at > now() - interval '30 days')::int as n
      from ${resolved} r`);
    const ratings = await db.select({ rating: issues.rating, n: sql<number>`count(*)::int` }).from(issues)
      .where(and(eq(issues.associationId, aid), sql`${issues.rating} between 1 and 5`)).groupBy(issues.rating);
    const total = ratings.reduce((a, r) => a + r.n, 0);
    const dist = [5, 4, 3, 2, 1].map(star => ({ star, n: ratings.find(r => r.rating === star)?.n ?? 0 }));
    const [b] = await q<{ open: number; progress: number; vendor: number; resolved: number }>(sql`
      select count(*) filter (where status in ('Submitted','Acknowledged','On Hold'))::int as open,
             count(*) filter (where status = 'In Progress')::int as progress,
             count(*) filter (where status = 'Assigned')::int as vendor,
             (select count(*) from ${resolved} r where r.resolved_at > now() - interval '30 days')::int as resolved
      from issues where association_id = ${aid}`);
    const work = await q<{ id: string; open: number; progress: number; done: number }>(sql`
      select v.id,
             (select count(*) from issues i where i.vendor_id = v.id and i.status in ('Submitted','Acknowledged','Assigned','On Hold'))::int as open,
             (select count(*) from issues i where i.vendor_id = v.id and i.status = 'In Progress')::int as progress,
             (select count(*) from ${resolved} r where r.vendor_id = v.id and r.resolved_at > now() - interval '30 days')::int as done
      from vendors v where v.association_id = ${aid}`);
    const vs = await db.select({ id: vendors.id, name: vendors.name, category: vendors.category, active: vendors.active }).from(vendors).where(eq(vendors.associationId, aid));
    const vendorRows = vs.map(v => { const w = work.find(x => x.id === v.id); return { id: v.id, name: v.name, category: v.category, open: w?.open ?? 0, inProgress: w?.progress ?? 0, completed: w?.done ?? 0 }; })
      .filter(v => v.open + v.inProgress + v.completed > 0 || vs.find(x => x.id === v.id)!.active)
      .sort((a, b) => b.open + b.inProgress - (a.open + a.inProgress) || b.completed - a.completed || a.name.localeCompare(b.name));
    const round = (n: number | null | undefined) => (n == null ? null : Math.round(n * 10) / 10);

    // the last 7 IST days, oldest first: requests raised that day, and requests given a "Resolved" step that day (as the web console's trend counts them)
    const day = (col: string) => sql.raw(`(${col} at time zone 'Asia/Kolkata')::date`);
    const today = sql`(now() at time zone 'Asia/Kolkata')::date`;
    const timeline = await q<{ date: string; created: number; resolved: number }>(sql`
      with days as (select generate_series(${today} - 6, ${today}, interval '1 day')::date as d)
      select to_char(days.d, 'YYYY-MM-DD') as date,
             (select count(*) from issues i where i.association_id = ${aid} and ${day('i.created_at')} = days.d)::int as created,
             (select count(distinct e.issue_id) from issue_events e join issues i on i.id = e.issue_id
               where i.association_id = ${aid} and e.status = 'Resolved' and ${day('e.created_at')} = days.d)::int as resolved
      from days order by days.d`);
    const [week] = await q<{ total: number; created: number; createdPrev: number }>(sql`
      select count(*)::int as total,
             count(*) filter (where ${day('created_at')} > ${today} - 7)::int as created,
             count(*) filter (where ${day('created_at')} > ${today} - 14 and ${day('created_at')} <= ${today} - 7)::int as "createdPrev"
      from issues where association_id = ${aid}`);
    const categories = await db.select({ category: issues.category, n: sql<number>`count(*)::int` }).from(issues)
      .where(and(eq(issues.associationId, aid), sql`${issues.createdAt} > now() - interval '30 days'`))
      .groupBy(issues.category).orderBy(sql`count(*) desc`, issues.category).limit(5);
    return {
      /** every request on file, and how many were raised in the last 7 days against the 7 before */
      totals: { all: week?.total ?? 0, week: week?.created ?? 0, prevWeek: week?.createdPrev ?? 0 },
      timeline,
      /** the most-raised categories over the last 30 days */
      categories,
      resolution: { hours: round(speed?.now), prevHours: round(speed?.prev), resolved: speed?.n ?? 0 },
      satisfaction: { avg: total ? round(ratings.reduce((a, r) => a + (r.rating ?? 0) * r.n, 0) / total) : null, count: total, dist },
      buckets: { open: b?.open ?? 0, inProgress: b?.progress ?? 0, pendingVendor: b?.vendor ?? 0, resolved: b?.resolved ?? 0 },
      vendors: vendorRows,
    };
  });

  /* =============== my notes: a staff member's own to-do list for one society =============== */
  const NoteIn = z.object({ text: z.string().trim().min(1).max(300) });
  app.get('/admin/:aid/my-notes', async req => {
    const { aid, s } = await staff(req);
    return db.select({ id: staffNotes.id, text: staffNotes.text, done: staffNotes.done, createdAt: staffNotes.createdAt }).from(staffNotes)
      .where(and(eq(staffNotes.associationId, aid), eq(staffNotes.userId, s.userId))).orderBy(asc(staffNotes.done), desc(staffNotes.createdAt)).limit(100);
  });
  app.post('/admin/:aid/my-notes', async (req, reply) => {
    const { aid, s } = await staff(req);
    const [n] = await db.insert(staffNotes).values({ associationId: aid, userId: s.userId, text: parse(NoteIn, req.body).text }).returning();
    return reply.status(201).send({ id: n!.id, text: n!.text, done: n!.done, createdAt: n!.createdAt });
  });
  app.put('/admin/:aid/my-notes/:id', async req => {
    const { aid, s } = await staff(req);
    const { id } = parse(AidId, req.params);
    const b = parse(NoteIn.partial().extend({ done: z.boolean().optional() }), req.body);
    const [n] = await db.update(staffNotes).set({ ...(b.text ? { text: b.text } : {}), ...(b.done !== undefined ? { done: b.done } : {}) })
      .where(and(eq(staffNotes.id, id), eq(staffNotes.associationId, aid), eq(staffNotes.userId, s.userId))).returning();
    if (!n) throw notFound('That note');
    return { id: n.id, text: n.text, done: n.done, createdAt: n.createdAt };
  });
  app.delete('/admin/:aid/my-notes/:id', async (req, reply) => {
    const { aid, s } = await staff(req);
    const { id } = parse(AidId, req.params);
    const [gone] = await db.delete(staffNotes).where(and(eq(staffNotes.id, id), eq(staffNotes.associationId, aid), eq(staffNotes.userId, s.userId))).returning();
    if (!gone) throw notFound('That note');
    return reply.status(204).send();
  });
};

