import { and, asc, desc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../app.js';
import {
  associations, contacts, invoices, knowledgeDocs, opsActivity, staffRoles, subscriptions, supportTickets, ticketReplies, unitMembers, units, usageSnapshots, users,
} from '../db/schema.js';
import { staffOf, userIdFrom } from '../lib/auth.js';
import { hashPassword } from '../lib/crypto.js';
import { factDocs, FACTS, type FactKey } from '../lib/facts.js';
import { defaultContacts } from './directory.js';
import { conflict, notFound, parse } from '../lib/http.js';
import { healthOf, invoiceState, payStateOf, PLAN_RANK } from '../lib/ops.js';
import { forgetPlans, modulesWith, planConfig, type PlanConfig } from '../lib/plans.js';

const Id = z.object({ id: z.uuid() });
const DAY = 864e5;
/** calendar days from today to a date, counted on India-time days: 27 Nov → 1 Dec is 4, whatever the hour */
export const calendarDaysTo = (at: Date, now = Date.now()) => {
  const ist = (t: number) => Math.floor((t + 330 * 60_000) / DAY);
  return ist(at.getTime()) - ist(now);
};
/** the last n calendar months, oldest first */
function months(n: number) {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => {
    const start = new Date(now.getFullYear(), now.getMonth() - (n - 1 - i), 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    return { key: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`, start: start.getTime(), end: end.getTime() };
  });
}

/** Owner Portal — Trinize operators only. They see every association. */
export const opsRoutes = ({ config, db, messenger }: Deps): FastifyPluginAsync => async app => {
  const operator = async (req: FastifyRequest) => staffOf(db, await userIdFrom(req, config.JWT_SECRET), null, ['operator']);
  const log = (who: string, what: string) => db.insert(opsActivity).values({ who, what });

  /**
   * The records every operator screen is built from, read once and in parallel. The portfolio, the
   * summary, the invoice list, the ticket list and the module adoption are all worked out from this
   * in memory — so one page load costs six queries, however many of those views it needs.
   */
  const base = async () => {
    const [subs, inv, usage, tix, onApp, people, homes] = await Promise.all([
      db.select().from(subscriptions).innerJoin(associations, eq(associations.id, subscriptions.associationId)),
      db.select({ i: invoices, name: associations.name }).from(invoices).innerJoin(associations, eq(associations.id, invoices.associationId)).orderBy(asc(invoices.dueAt)),
      db.select().from(usageSnapshots).orderBy(asc(usageSnapshots.month)),
      db.select({ t: supportTickets, association: associations.name }).from(supportTickets).innerJoin(associations, eq(associations.id, supportTickets.associationId)).orderBy(asc(supportTickets.slaDueAt)),
      db.select({ associationId: units.associationId, n: sql<number>`count(*)::int` }).from(units).groupBy(units.associationId),
      db.select({ associationId: units.associationId, n: sql<number>`count(distinct ${unitMembers.userId})::int` }).from(unitMembers).innerJoin(units, eq(units.id, unitMembers.unitId)).groupBy(units.associationId),
      // flats with at least one verified resident on the app
      db.select({ associationId: units.associationId, n: sql<number>`count(distinct ${unitMembers.unitId})::int` }).from(unitMembers).innerJoin(units, eq(units.id, unitMembers.unitId))
        .where(eq(unitMembers.status, 'active')).groupBy(units.associationId),
    ]);
    return { subs, inv, usage, tix, onApp, people, homes };
  };
  type Base = Awaited<ReturnType<typeof base>>;

  /** every association with the numbers the portal ranks them by */
  const portfolioOf = (b: Base) => {
    const now = Date.now();
    const group = <T>(rows: T[], key: (r: T) => string) => { const m = new Map<string, T[]>(); for (const r of rows) { const k = key(r); (m.get(k) ?? m.set(k, []).get(k)!).push(r); } return m; };
    const invBy = group(b.inv, r => r.i.associationId), usageBy = group(b.usage, u => u.associationId), tixBy = group(b.tix, r => r.t.associationId);
    return b.subs.map(({ subscriptions: s, associations: a }) => {
      const mine = (invBy.get(a.id) ?? []).map(r => r.i);
      const series = (usageBy.get(a.id) ?? []).map(u => u.adoption);
      const open = (tixBy.get(a.id) ?? []).map(r => r.t).filter(t => t.status !== 'Resolved');
      const recent = open.filter(t => now - t.createdAt.getTime() < 30 * DAY).length;
      const pay = payStateOf(s.state, mine);
      // adoption today is worked out from the flats actually set up and the residents actually on the app — not a stored figure
      const setUp = b.onApp.find(x => x.associationId === a.id)?.n ?? 0, withResident = b.homes.find(x => x.associationId === a.id)?.n ?? 0;
      const adoption = setUp ? Math.round((withResident / setUp) * 100) : 0;
      const overdue = mine.filter(i => i.paid < i.amount && i.dueAt.getTime() < now);
      return {
        id: a.id, name: a.name, short: a.short, city: a.city, kind: s.kind, plan: s.plan, billing: s.billing, state: s.state, pay,
        plots: s.plots, owners: s.owners, adoption, usage: series.slice(-12), annual: s.annualAmount, mrr: Math.round(s.annualAmount / 12),
        renewsAt: s.renewsAt, daysToRenewal: calendarDaysTo(s.renewsAt, now), openTickets: open.length,
        overdue: { count: overdue.length, amount: overdue.reduce((n, i) => n + (i.amount - i.paid), 0) },
        onApp: { units: b.onApp.find(x => x.associationId === a.id)?.n ?? 0, residents: b.people.find(x => x.associationId === a.id)?.n ?? 0 },
        health: healthOf({ state: s.state, pay, adoption, usage: series, openTickets: open.length, recentTickets: recent }),
        contact: { name: s.adminName, role: s.adminRole, phone: s.adminPhone, email: s.adminEmail }, registration: s.registration, address: s.address, since: s.since,
      };
    });
  };
  type Row = ReturnType<typeof portfolioOf>[number];
  const portfolio = async () => portfolioOf(await base());
  const byRisk = (list: Row[]) => [...list].sort((a, b) => a.health.score - b.health.score); // most at risk first

  const summaryOf = (list: Row[], b: Base) => {
    const inv = b.inv.map(r => r.i);
    const overdue = inv.filter(i => invoiceState(i) === 'Overdue' || (invoiceState(i) === 'Part paid' && i.dueAt.getTime() < Date.now()));
    const paying = list.filter(a => a.state === 'Active');
    return {
      mrr: paying.reduce((n, a) => n + a.mrr, 0),
      arr: paying.reduce((n, a) => n + a.annual, 0),
      associations: list.length,
      atRisk: list.filter(a => a.health.band !== 'Healthy').length,
      renewingIn60: list.filter(a => a.daysToRenewal >= 0 && a.daysToRenewal <= 60).reduce((n, a) => n + a.annual, 0),
      overdueAmount: overdue.reduce((n, i) => n + (i.amount - i.paid), 0),
      overdueCount: overdue.length,
      health: { Healthy: 0, Watch: 0, 'At risk': 0, Critical: 0, ...Object.fromEntries(['Healthy', 'Watch', 'At risk', 'Critical'].map(k => [k, list.filter(a => a.health.band === k).length])) },
      // the last 12 months: what the accounts onboarded by each month are worth per month today
      mrrSeries: months(12).map(m => ({ month: m.key, mrr: list.filter(a => a.state !== 'Suspended' && a.since.getTime() < m.end).reduce((n, a) => n + a.mrr, 0) })),
      // the last 6 months: what was invoiced in each, and how much of that has come in so far
      billed: months(6).map(m => {
        const mine = inv.filter(i => i.issuedAt.getTime() >= m.start && i.issuedAt.getTime() < m.end);
        return { month: m.key, invoiced: mine.reduce((n, i) => n + i.amount, 0), collected: mine.reduce((n, i) => n + i.paid, 0) };
      }),
    };
  };
  const invoicesOf = (b: Base) => b.inv.map(({ i, name }) => ({ ...i, association: name, state: invoiceState(i), balance: i.amount - i.paid, daysToDue: calendarDaysTo(i.dueAt) }));
  const ticketsOf = (b: Base) => b.tix.map(({ t, association }) => ({ ...ticketOut(t), association }));
  /** share of associations whose plan includes each module */
  const modulesOf = (list: Row[], c: PlanConfig) => {
    const total = list.length || 1;
    return modulesWith(c).map(m => ({ ...m, adoption: Math.round((list.filter(a => PLAN_RANK[a.plan] >= PLAN_RANK[m.from]).length / total) * 100) }));
  };
  const activity = () => db.select({ who: opsActivity.who, what: opsActivity.what, at: opsActivity.createdAt }).from(opsActivity).orderBy(desc(opsActivity.createdAt)).limit(50);

  /** Everything the portal's screens need, in one round trip. */
  app.get('/bootstrap', async req => {
    await operator(req);
    const [b, feed, plans] = await Promise.all([base(), activity(), planConfig(db)]);
    const list = portfolioOf(b);
    return { summary: summaryOf(list, b), associations: byRisk(list), invoices: invoicesOf(b), tickets: ticketsOf(b), activity: feed, modules: modulesOf(list, plans), plans: plans.plans };
  });

  /* ---------- command centre ---------- */
  app.get('/summary', async req => {
    await operator(req);
    const b = await base();
    return summaryOf(portfolioOf(b), b);
  });

  app.get('/activity', async req => {
    await operator(req);
    return activity();
  });

  /* ---------- associations ---------- */
  app.get('/associations', async req => {
    await operator(req);
    return byRisk(await portfolio());
  });

  /** Onboard a society: the association, its subscription and (optionally) the first admin login for the console. */
  app.post('/associations', async (req, reply) => {
    const op = await operator(req);
    const b = parse(z.object({
      name: z.string().trim().min(3).max(80), short: z.string().trim().min(2).max(40).optional(), city: z.string().trim().min(2).max(60),
      kind: z.enum(['Apartment', 'Villa', 'Plotted', 'Mixed']).default('Apartment'), plan: z.enum(['Starter', 'Professional', 'Enterprise']),
      billing: z.enum(['monthly', 'yearly']).default('yearly'), state: z.enum(['Active', 'Trial', 'Pending']).default('Trial'),
      annualAmount: z.number().int().min(0), renewsAt: z.iso.datetime({ offset: true }), plots: z.number().int().min(1).max(100000),
      registration: z.string().trim().max(60).default(''), address: z.string().trim().max(200).default(''),
      admin: z.object({ name: z.string().trim().min(2).max(80), role: z.string().trim().max(40).default('Secretary'), phone: z.string().trim().max(20).default(''), email: z.email() }),
      /** set to give that person a login to the society console */
      adminPassword: z.string().min(8).max(100).optional(),
      /** timings and rules noted while onboarding — the assistant answers residents from these from day one */
      facts: z.object(Object.fromEntries(FACTS.map(f => [f.key, z.string().trim().max(f.key === 'other' ? 2000 : 300).optional()])) as Record<FactKey, z.ZodOptional<z.ZodString>>).default({}),
    }), req.body);
    const email = b.admin.email.toLowerCase();
    const id = await db.transaction(async tx => {
      const [dup] = await tx.select({ id: associations.id }).from(associations).where(sql`lower(${associations.name}) = ${b.name.toLowerCase()}`);
      if (dup) throw conflict('name_taken', 'There is already an association with that name.');
      if (b.adminPassword) {
        const [taken] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email));
        if (taken) throw conflict('email_taken', 'That email already has a login. Use a different one for this admin.');
      }
      const [a] = await tx.insert(associations).values({ name: b.name, short: b.short ?? b.name.split(' ').slice(0, 2).join(' '), city: b.city }).returning();
      await tx.insert(subscriptions).values({
        associationId: a!.id, kind: b.kind, plan: b.plan, billing: b.billing, state: b.state, annualAmount: b.annualAmount, renewsAt: new Date(b.renewsAt), plots: b.plots, owners: 0,
        adminName: b.admin.name, adminRole: b.admin.role, adminPhone: b.admin.phone, adminEmail: email, registration: b.registration, address: b.address,
      });
      if (b.adminPassword) {
        const [u] = await tx.insert(users).values({ name: b.admin.name, email, passwordHash: await hashPassword(b.adminPassword) }).returning();
        await tx.insert(staffRoles).values({ userId: u!.id, associationId: a!.id, role: 'admin', title: b.admin.role });
      }
      await tx.insert(contacts).values(defaultContacts(a!.id));
      const docs = factDocs(a!.id, b.facts);
      if (docs.length) await tx.insert(knowledgeDocs).values(docs);
      await tx.insert(opsActivity).values({ who: op.name, what: `onboarded ${b.name} · ${b.plots} plots · ${b.plan}${b.state === 'Trial' ? ' trial' : ''}` });
      return a!.id;
    });
    return reply.status(201).send({ ...(await portfolio()).find(a => a.id === id), adminLogin: !!b.adminPassword });
  });

  /** what the onboarding form asks about a society's timings and rules */
  app.get('/facts', async req => { await operator(req); return FACTS.map(({ key, section, label, hint }) => ({ key, section, label, hint })); });

  /** Association 360: the account on one screen */
  app.get('/associations/:id', async req => {
    await operator(req);
    const { id } = parse(Id, req.params);
    const a = (await portfolio()).find(x => x.id === id);
    if (!a) throw notFound('Association');
    const [inv, tix, committee, towers, homes] = await Promise.all([
      db.select().from(invoices).where(eq(invoices.associationId, id)).orderBy(desc(invoices.dueAt)),
      db.select().from(supportTickets).where(eq(supportTickets.associationId, id)).orderBy(desc(supportTickets.createdAt)),
      db.select({ name: contacts.name, role: contacts.role, phone: contacts.phone }).from(contacts).where(and(eq(contacts.associationId, id), eq(contacts.group, 'committee'))).orderBy(asc(contacts.position)),
      db.select({ tower: units.tower, units: sql<number>`count(*)::int` }).from(units).where(eq(units.associationId, id)).groupBy(units.tower).orderBy(units.tower),
      // every flat or plot the society has set up, with who owns it and how many people are registered in it
      db.select({
        code: units.code, tower: units.tower, flatType: units.flatType, area: units.area, occupancy: units.occupancy,
        owner: sql<string | null>`(select u.name from unit_members m join users u on u.id = m.user_id where m.unit_id = units.id and m.role = 'Owner' and m.status = 'active' order by m.created_at limit 1)`,
        residents: sql<number>`(select count(*)::int from unit_members m where m.unit_id = units.id and m.status = 'active')`,
      }).from(units).where(eq(units.associationId, id)).orderBy(units.tower, units.code),
    ]);
    return {
      ...a,
      towers, committee, homes,
      invoices: inv.map(i => ({ ...i, state: invoiceState(i) })),
      tickets: tix.map(({ number, ...t }) => ({ ...t, ref: 'ISS-' + number })),
      modules: modulesWith(await planConfig(db)).map(m => ({ ...m, included: PLAN_RANK[a.plan] >= PLAN_RANK[m.from] })),
    };
  });

  app.put('/associations/:id/subscription', async req => {
    const op = await operator(req);
    const { id } = parse(Id, req.params);
    const { note, ...b } = parse(z.object({ plan: z.enum(['Starter', 'Professional', 'Enterprise']), state: z.enum(['Active', 'Trial', 'Pending', 'Suspended']), billing: z.enum(['monthly', 'yearly']), annualAmount: z.number().int().min(0),
      renewsAt: z.iso.datetime({ offset: true }), /** why — kept in the activity log */ note: z.string().trim().max(300) }).partial(), req.body);
    const [was] = await db.select().from(subscriptions).where(eq(subscriptions.associationId, id));
    if (!was) throw notFound('Association');
    if (!Object.keys(b).length) throw conflict('nothing_to_change', 'Nothing was changed.');
    const [s] = await db.update(subscriptions).set({ ...b, renewsAt: b.renewsAt ? new Date(b.renewsAt) : undefined }).where(eq(subscriptions.associationId, id)).returning();
    const [a] = await db.select({ name: associations.name }).from(associations).where(eq(associations.id, id));
    // the log says what moved, in words: "plan Starter → Professional", not field names
    const day = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const moved = [
      b.plan && b.plan !== was.plan ? `plan ${was.plan} → ${b.plan}` : '', b.state && b.state !== was.state ? `${was.state} → ${b.state}` : '',
      b.annualAmount !== undefined && b.annualAmount !== was.annualAmount ? `annual value ₹${was.annualAmount.toLocaleString('en-IN')} → ₹${b.annualAmount.toLocaleString('en-IN')}` : '',
      b.renewsAt && day(new Date(b.renewsAt)) !== day(was.renewsAt) ? `renewal ${day(was.renewsAt)} → ${day(new Date(b.renewsAt))}` : '', b.billing && b.billing !== was.billing ? `billing ${was.billing} → ${b.billing}` : '',
    ].filter(Boolean);
    forgetPlans(db, id);
    await log(op.name, `updated the subscription · ${a?.name} · ${moved.join(', ') || 'no change'}${note ? ` · “${note}”` : ''}`);
    return s!;
  });

  /* ---------- collections ---------- */
  app.get('/invoices', async req => {
    await operator(req);
    return invoicesOf(await base());
  });

  app.post('/invoices', async (req, reply) => {
    const op = await operator(req);
    const b = parse(z.object({ associationId: z.uuid(), amount: z.number().int().min(1), dueAt: z.iso.datetime({ offset: true }) }), req.body);
    const [a] = await db.select({ name: associations.name }).from(associations).where(eq(associations.id, b.associationId));
    if (!a) throw notFound('Association');
    const year = new Date().getFullYear();
    const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(invoices).where(sql`${invoices.number} like ${'TRZ-INV-' + year + '-%'}`)) as [{ n: number }];
    const number = `TRZ-INV-${year}-${String(n + 1).padStart(4, '0')}`;
    const [i] = await db.insert(invoices).values({ associationId: b.associationId, number, amount: b.amount, dueAt: new Date(b.dueAt) }).returning();
    await log(op.name, `issued invoice ${number} · ${a.name}`);
    return reply.status(201).send({ ...i!, state: invoiceState(i!) });
  });

  /** a payment reminder — always recorded; the email goes out when MESSAGING=emailjs (otherwise it is only logged) */
  app.post('/invoices/:id/chase', async req => {
    const op = await operator(req);
    const { id } = parse(Id, req.params);
    const [i] = await db.select().from(invoices).where(eq(invoices.id, id));
    if (!i) throw notFound('Invoice');
    if (i.paid >= i.amount) throw conflict('already_paid', 'This invoice is fully paid.');
    const [u] = await db.update(invoices).set({ lastChasedAt: new Date(), chases: sql`${invoices.chases} + 1` }).where(eq(invoices.id, id)).returning();
    const [sub] = await db.select({ email: subscriptions.adminEmail, name: subscriptions.adminName, phone: subscriptions.adminPhone }).from(subscriptions).where(eq(subscriptions.associationId, i.associationId));
    const [soc] = await db.select({ name: associations.name }).from(associations).where(eq(associations.id, i.associationId));
    const due = i.amount - i.paid, late = Math.max(0, Math.floor((Date.now() - i.dueAt.getTime()) / DAY));
    const body = `Dear ${sub?.name || 'Sir/Madam'}, invoice ${i.number} for ${soc?.name ?? 'your society'} has ₹${due.toLocaleString('en-IN')} outstanding${late ? ` and is ${late} day${late === 1 ? '' : 's'} past its due date` : ''}. Please arrange payment, or reply if it has already been made. — Trinize`;
    const sent = sub?.email ? await messenger.send('email', sub.email, { subject: `Payment reminder: ${i.number}`, body }) : { status: 'Skipped' as const, detail: 'No email address is on file for this society’s contact' };
    await log(op.name, `chased invoice ${i.number} (reminder ${u!.chases}) · email ${sent.status.toLowerCase()}`);
    return { ...u!, state: invoiceState(u!), delivered: sent.status === 'Sent' || sent.status === 'Delivered', delivery: sent.status, deliveryDetail: sent.detail, to: sub?.email ?? null };
  });

  app.post('/invoices/:id/payment', async req => {
    const op = await operator(req);
    const { id } = parse(Id, req.params);
    const { amount } = parse(z.object({ amount: z.number().int().min(1) }), req.body);
    const [i] = await db.select().from(invoices).where(eq(invoices.id, id));
    if (!i) throw notFound('Invoice');
    if (i.paid + amount > i.amount) throw conflict('overpayment', `Only ₹${i.amount - i.paid} is outstanding on this invoice.`);
    const [u] = await db.update(invoices).set({ paid: i.paid + amount }).where(eq(invoices.id, id)).returning();
    await log(op.name, `recorded ₹${amount} against ${i.number}`);
    return { ...u!, state: invoiceState(u!) };
  });

  /* ---------- support tickets ---------- */
  const ticketOut = <T extends { number: number; slaDueAt: Date; status: string }>(t: T) => {
    const { number, ...rest } = t;
    const left = t.slaDueAt.getTime() - Date.now();
    return { ...rest, ref: 'ISS-' + number, slaState: t.status === 'Resolved' ? 'met' : left < 0 ? 'over' : left < 6 * 3600e3 ? 'risk' : 'ok' };
  };

  app.get('/tickets', async req => {
    await operator(req);
    return ticketsOf(await base());
  });

  app.get('/tickets/:id', async req => {
    await operator(req);
    const { id } = parse(Id, req.params);
    const [t] = await db.select().from(supportTickets).where(eq(supportTickets.id, id));
    if (!t) throw notFound('Ticket');
    const replies = await db.select({ by: ticketReplies.byName, text: ticketReplies.text, at: ticketReplies.createdAt }).from(ticketReplies).where(eq(ticketReplies.ticketId, id)).orderBy(asc(ticketReplies.createdAt));
    return { ...ticketOut(t), replies };
  });

  app.post('/tickets/:id/assign', async req => {
    const op = await operator(req);
    const { id } = parse(Id, req.params);
    const { assignee } = parse(z.object({ assignee: z.string().trim().min(2).max(80) }), req.body);
    const [t] = await db.update(supportTickets).set({ assignee, status: sql`case when ${supportTickets.status} = 'Open' then 'In progress' else ${supportTickets.status} end` }).where(eq(supportTickets.id, id)).returning();
    if (!t) throw notFound('Ticket');
    await log(op.name, `assigned ISS-${t.number} to ${assignee}`);
    return ticketOut(t);
  });

  app.post('/tickets/:id/reply', async req => {
    const op = await operator(req);
    const { id } = parse(Id, req.params);
    const b = parse(z.object({ text: z.string().trim().min(1).max(4000), resolve: z.boolean().default(false) }), req.body);
    const [t] = await db.select().from(supportTickets).where(eq(supportTickets.id, id));
    if (!t) throw notFound('Ticket');
    await db.insert(ticketReplies).values({ ticketId: id, byUserId: op.userId, byName: op.name, text: b.text });
    const [u] = b.resolve ? await db.update(supportTickets).set({ status: 'Resolved', resolvedAt: new Date() }).where(eq(supportTickets.id, id)).returning() : [t];
    await log(op.name, `${b.resolve ? 'resolved' : 'replied on'} ISS-${t.number}`);
    return ticketOut(u!);
  });

  /* ---------- plans ---------- */
  app.get('/modules', async req => {
    await operator(req);
    return modulesOf(await portfolio(), await planConfig(db));
  });
};
