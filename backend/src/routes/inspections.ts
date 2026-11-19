import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../app.js';
import {
  CONDITIONS, INSPECTION_TYPES, inspectionItems, inspections, inspectionTemplates, issues, issueUpdates, unitMembers, units, users, vendors,
  type StaffRole, type TemplateSection,
} from '../db/schema.js';
import { audit } from '../lib/audit.js';
import { staffOf, userIdFrom } from '../lib/auth.js';
import { notify } from '../lib/community.js';
import { badRequest, conflict, forbidden, notFound, parse } from '../lib/http.js';
import { analyse, BUILT_IN, compareWithMoveIn, countsOf, coverage, insRef, priorityFor, summarise, type Inspection, type Item } from '../lib/inspections.js';
import { COMMON_ASSETS, createIssue, ref } from '../lib/issues.js';
import { applyEstimate } from '../lib/maintenance.js';

const Aid = z.object({ aid: z.uuid() });
const Id = Aid.extend({ id: z.uuid() });
const Sections = z.array(z.object({
  name: z.string().trim().min(2).max(40),
  items: z.array(z.object({ name: z.string().trim().min(2).max(60), photo: z.boolean().default(false) })).min(1).max(30),
})).min(1).max(20);

/**
 * Inspections.
 *   /v1/admin/:aid/inspections/*   the office and the property manager (on the phone or the console)
 *   /v1/inspections                the resident or owner: reports shared with them, and acknowledging one
 */
export const inspectionRoutes = ({ config, db, ai }: Deps): FastifyPluginAsync => async app => {
  const uid = (req: FastifyRequest) => userIdFrom(req, config.JWT_SECRET);
  const staff = async (req: FastifyRequest, roles: StaffRole[] = ['admin', 'operator']) => {
    const { aid } = parse(Aid, req.params);
    return { aid, s: await staffOf(db, await uid(req), aid, roles) };
  };
  const reader = (req: FastifyRequest) => staff(req, ['admin', 'committee', 'operator']);
  const ownFile = (u: string) => { if (!u.startsWith(config.PUBLIC_URL + '/files/')) throw badRequest('invalid_file', 'Photos must come from /v1/uploads.'); return u; };

  const find = async (aid: string, id: string) => {
    const [i] = await db.select().from(inspections).where(and(eq(inspections.id, id), eq(inspections.associationId, aid)));
    if (!i) throw notFound('That inspection');
    return i;
  };
  const itemsOf = (id: string) => db.select().from(inspectionItems).where(eq(inspectionItems.inspectionId, id)).orderBy(asc(inspectionItems.position));
  const whereOf = async (i: Inspection) => {
    if (!i.unitId) return { where: i.place || 'Common areas', unit: null as string | null };
    const [u] = await db.select({ code: units.code, label: units.label }).from(units).where(eq(units.id, i.unitId));
    return { where: u?.label ?? 'Flat', unit: u?.code ?? null };
  };

  const head = (i: Inspection, where: string, unit: string | null, c: ReturnType<typeof countsOf>) => ({
    id: i.id, ref: insRef(i.number), type: i.type, template: i.templateName, scope: i.scope, where, unit, status: i.status, inspector: i.inspectorName,
    startedAt: i.startedAt, submittedAt: i.submittedAt, counts: c, shareOwner: i.shareOwner, shareTenant: i.shareTenant,
    ack: i.ackAt ? { name: i.ackName, role: i.ackRole, note: i.ackNote, at: i.ackAt } : null,
  });

  /** the whole report. `office` adds what only staff act on: what is missing, and work-order links */
  const full = async (i: Inspection, office: boolean) => {
    const items = await itemsOf(i.id);
    const { where, unit } = await whereOf(i);
    const linked = items.filter(x => x.issueId).map(x => x.issueId!);
    const orders = linked.length
      ? await db.select({ id: issues.id, number: issues.number, status: issues.status, vendor: vendors.name, costEstimate: issues.costEstimate, approval: issues.approval })
        .from(issues).leftJoin(vendors, eq(vendors.id, issues.vendorId)).where(inArray(issues.id, linked))
      : [];
    const order = (id: string | null) => { const o = orders.find(x => x.id === id); return o ? { ref: ref(o.number), status: o.status, vendor: o.vendor, ...(office ? { costEstimate: o.costEstimate, approval: o.approval } : {}) } : null; };
    const sections: { name: string; items: unknown[] }[] = [];
    for (const x of items) {
      const out = { id: x.id, item: x.item, photoRequired: x.photoRequired, condition: x.condition, note: x.note, photos: x.photos, checkedAt: x.checkedAt,
        finding: x.finding, severity: x.severity, recommendation: x.recommendation, category: x.category, findingBy: x.findingBy, workOrder: order(x.issueId) };
      const last = sections[sections.length - 1];
      if (last?.name === x.section) last.items.push(out); else sections.push({ name: x.section, items: [out] });
    }
    return {
      ...head(i, where, unit, countsOf(items)), summary: i.summary, summaryBy: i.summaryBy, sections,
      ...(office ? { missing: i.status === 'Submitted' ? [] : coverage(items) } : {}),
      comparison: i.status === 'Submitted' ? await compareWithMoveIn(db, i, items) : null,
    };
  };

  /* ================= the office and the property manager ================= */
  app.get('/admin/:aid/inspections/options', async req => {
    const { aid } = await reader(req);
    const own = await db.select().from(inspectionTemplates).where(eq(inspectionTemplates.associationId, aid)).orderBy(asc(inspectionTemplates.name));
    return {
      types: INSPECTION_TYPES, conditions: CONDITIONS, places: COMMON_ASSETS,
      templates: [
        ...BUILT_IN.map(t => ({ key: t.key, name: t.name, about: t.about, scope: t.scope, builtIn: true, sections: t.sections })),
        ...own.map(t => ({ key: t.id, name: t.name, about: 'Your own checklist', scope: t.scope, builtIn: false, sections: t.sections })),
      ],
      units: await db.select({ id: units.id, code: units.code, label: units.label }).from(units).where(eq(units.associationId, aid)).orderBy(asc(units.code)),
      aiConnected: ai.enabled,
    };
  });

  /** a society's own checklist */
  app.post('/admin/:aid/inspections/templates', async (req, reply) => {
    const { aid, s } = await staff(req);
    const b = parse(z.object({ name: z.string().trim().min(3).max(60), scope: z.enum(['unit', 'common']), sections: Sections }), req.body);
    const [t] = await db.insert(inspectionTemplates).values({ associationId: aid, ...b, byName: s.name }).returning();
    await audit(db, aid, s.userId, s.name, `inspection checklist added · ${b.name}`);
    return reply.status(201).send({ key: t!.id, name: t!.name, scope: t!.scope, builtIn: false, sections: t!.sections });
  });
  app.delete('/admin/:aid/inspections/templates/:id', async (req, reply) => {
    const { aid, s } = await staff(req);
    const [t] = await db.delete(inspectionTemplates).where(and(eq(inspectionTemplates.id, parse(Id, req.params).id), eq(inspectionTemplates.associationId, aid))).returning();
    if (!t) throw notFound('That checklist');
    await audit(db, aid, s.userId, s.name, `inspection checklist removed · ${t.name}`);
    return reply.status(204).send();
  });

  /** start one: where, what kind, which checklist. The checklist is copied in, so later edits to it never change a report. */
  app.post('/admin/:aid/inspections', async (req, reply) => {
    const { aid, s } = await staff(req);
    const b = parse(z.object({ type: z.enum(INSPECTION_TYPES), template: z.string().min(1).max(60), unitId: z.uuid().optional(), place: z.string().trim().max(80).optional() }), req.body);
    let tpl: { name: string; scope: 'unit' | 'common'; sections: TemplateSection[] } | undefined = BUILT_IN.find(t => t.key === b.template);
    if (!tpl && z.uuid().safeParse(b.template).success) [tpl] = await db.select().from(inspectionTemplates).where(and(eq(inspectionTemplates.id, b.template), eq(inspectionTemplates.associationId, aid)));
    if (!tpl) throw notFound('That checklist');
    if (tpl.scope === 'unit') {
      if (!b.unitId) throw badRequest('unit_required', 'Pick the flat being inspected.');
      const [u] = await db.select({ id: units.id }).from(units).where(and(eq(units.id, b.unitId), eq(units.associationId, aid)));
      if (!u) throw notFound('That flat');
    } else if ((b.type === 'Move-in' || b.type === 'Move-out')) throw badRequest('wrong_checklist', 'A move-in or move-out inspection needs a flat checklist.');
    const made = await db.transaction(async tx => {
      const [{ next }] = (await tx.select({ next: sql<number>`coalesce(max(${inspections.number}), 100) + 1` }).from(inspections).where(eq(inspections.associationId, aid))) as [{ next: number }];
      const [i] = await tx.insert(inspections).values({ associationId: aid, number: next, type: b.type, templateName: tpl.name, scope: tpl.scope,
        unitId: tpl.scope === 'unit' ? b.unitId : null, place: tpl.scope === 'common' ? b.place ?? '' : '', inspectorId: s.userId, inspectorName: s.name }).returning();
      let position = 0;
      await tx.insert(inspectionItems).values(tpl.sections.flatMap(sec => sec.items.map(it => ({ inspectionId: i!.id, position: position++, section: sec.name, item: it.name, photoRequired: it.photo, photos: [] }))));
      return i!;
    });
    await audit(db, aid, s.userId, s.name, `inspection ${insRef(made.number)} started · ${b.type}`);
    return reply.status(201).send(await full(made, true));
  });

  app.get('/admin/:aid/inspections', async req => {
    const { aid } = await reader(req);
    const list = await db.select({ i: inspections, code: units.code, label: units.label }).from(inspections).leftJoin(units, eq(units.id, inspections.unitId))
      .where(eq(inspections.associationId, aid)).orderBy(desc(inspections.startedAt)).limit(200);
    if (!list.length) return [];
    const items = await db.select({ inspectionId: inspectionItems.inspectionId, condition: inspectionItems.condition, severity: inspectionItems.severity, finding: inspectionItems.finding, issueId: inspectionItems.issueId })
      .from(inspectionItems).where(inArray(inspectionItems.inspectionId, list.map(l => l.i.id)));
    return list.map(l => head(l.i, l.i.unitId ? l.label ?? 'Flat' : l.i.place || 'Common areas', l.code, countsOf(items.filter(x => x.inspectionId === l.i.id))));
  });

  app.get('/admin/:aid/inspections/:id', async req => {
    const { aid } = await reader(req);
    return full(await find(aid, parse(Id, req.params).id), true);
  });

  /** rate one item, write a note, add or remove photos — each change is saved as it is made */
  app.put('/admin/:aid/inspections/:id/items/:item', async req => {
    const { aid } = await staff(req);
    const p = parse(Id.extend({ item: z.uuid() }), req.params);
    const i = await find(aid, p.id);
    if (i.status === 'Submitted') throw conflict('submitted', 'This inspection has been submitted and can no longer be changed.');
    const b = parse(z.object({ condition: z.enum(CONDITIONS).nullable().optional(), note: z.string().trim().max(1000).optional(), photos: z.array(z.string()).max(8).optional() }), req.body);
    b.photos?.forEach(ownFile);
    const [row] = await db.update(inspectionItems).set({ ...(b.condition !== undefined ? { condition: b.condition } : {}), ...(b.note !== undefined ? { note: b.note } : {}), ...(b.photos ? { photos: b.photos } : {}), checkedAt: new Date() })
      .where(and(eq(inspectionItems.id, p.item), eq(inspectionItems.inspectionId, i.id))).returning();
    if (!row) throw notFound('That checklist item');
    return full(i, true);
  });

  /** look at what has been captured so far and write the findings — can be run as often as wanted before submitting */
  app.post('/admin/:aid/inspections/:id/analyse', { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async req => {
    const { aid } = await staff(req);
    const i = await find(aid, parse(Id, req.params).id);
    if (i.status === 'Submitted') throw conflict('submitted', 'This inspection has already been submitted.');
    await analyse(db, ai, config, i.id);
    return full(i, true);
  });

  /** finish: refuse while anything required is missing, then write the findings and the summary */
  app.post('/admin/:aid/inspections/:id/submit', { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async req => {
    const { aid, s } = await staff(req);
    const i = await find(aid, parse(Id, req.params).id);
    if (i.status === 'Submitted') throw conflict('submitted', 'This inspection has already been submitted.');
    const missing = coverage(await itemsOf(i.id));
    if (missing.length) throw conflict('incomplete', `${missing.length} thing${missing.length === 1 ? ' is' : 's are'} still missing — ${missing.slice(0, 3).join('; ')}${missing.length > 3 ? '…' : ''}`);
    await analyse(db, ai, config, i.id);
    const { where } = await whereOf(i);
    const sum = await summarise(ai, i, where, await itemsOf(i.id));
    const [done] = await db.update(inspections).set({ status: 'Submitted', submittedAt: new Date(), summary: sum.text, summaryBy: sum.by }).where(eq(inspections.id, i.id)).returning();
    await audit(db, aid, s.userId, s.name, `inspection ${insRef(i.number)} submitted · ${where}`);
    return full(done!, true);
  });

  /** who may read the report in the app. Sharing tells them. */
  app.put('/admin/:aid/inspections/:id/share', async req => {
    const { aid, s } = await staff(req);
    const i = await find(aid, parse(Id, req.params).id);
    const b = parse(z.object({ owner: z.boolean(), tenant: z.boolean() }), req.body);
    if (i.status !== 'Submitted') throw conflict('not_submitted', 'Submit the inspection before sharing its report.');
    if (!i.unitId) throw conflict('no_flat', 'Only the report of a flat can be shared with its owner or resident.');
    const members = await db.select({ userId: unitMembers.userId, role: unitMembers.role }).from(unitMembers).where(and(eq(unitMembers.unitId, i.unitId), eq(unitMembers.status, 'active')));
    const fresh = members.filter(m => (m.role === 'Owner' ? b.owner && !i.shareOwner : b.tenant && !i.shareTenant)).map(m => m.userId);
    const [done] = await db.update(inspections).set({ shareOwner: b.owner, shareTenant: b.tenant }).where(eq(inspections.id, i.id)).returning();
    if (fresh.length) await notify(db, fresh, { kind: 'issues', title: `${i.type} inspection report`, body: 'The society office has shared an inspection report for your flat.', href: '/inspections/' + i.id });
    await audit(db, aid, s.userId, s.name, `inspection ${insRef(i.number)} shared with ${[b.owner && 'owner', b.tenant && 'resident'].filter(Boolean).join(' and ') || 'nobody'}`);
    return full(done!, true);
  });

  /** findings → work orders, one each, with the photos and notes attached. An estimate goes through the usual approvals. */
  app.post('/admin/:aid/inspections/:id/work-orders', async (req, reply) => {
    const { aid, s } = await staff(req);
    const i = await find(aid, parse(Id, req.params).id);
    const b = parse(z.object({ items: z.array(z.object({ id: z.uuid(), estimate: z.number().int().min(0).max(100_000_000).optional(), vendorId: z.uuid().optional() })).min(1).max(60) }), req.body);
    if (i.status !== 'Submitted') throw conflict('not_submitted', 'Submit the inspection first — work orders are raised from its findings.');
    const all = await itemsOf(i.id);
    const { where } = await whereOf(i);
    const created: string[] = [];
    for (const want of b.items) {
      const x: Item | undefined = all.find(a => a.id === want.id);
      if (!x) throw notFound('One of those findings');
      if (x.issueId || !x.condition || x.condition === 'Good' && !x.finding) continue; // already raised, or nothing to fix
      const asset = COMMON_ASSETS.find(a => a.toLowerCase().startsWith(x.section.toLowerCase().split(' ')[0]!)) ?? undefined;
      const row = await createIssue(db, {
        associationId: aid, reporterId: s.userId, reporterName: s.name, unitId: i.unitId, via: 'admin',
        title: `${x.item} — ${x.section}`.slice(0, 120), category: x.category ?? 'General maintenance', location: where.slice(0, 80), priority: priorityFor(x.severity),
        details: [x.finding, x.note && x.note !== x.finding ? 'Inspector’s note: ' + x.note : '', `From inspection ${insRef(i.number)} (${i.type}), rated ${x.condition}${x.recommendation ? ' · ' + x.recommendation : ''}.`].filter(Boolean).join('\n'),
        photoUrl: x.photos[0], scope: i.scope, asset,
      });
      if (x.photos.length > 1) await db.insert(issueUpdates).values(x.photos.slice(1).map(photoUrl => ({ issueId: row.id, userId: s.userId, text: '', photoUrl })));
      if (want.vendorId) {
        const [v] = await db.select().from(vendors).where(and(eq(vendors.id, want.vendorId), eq(vendors.associationId, aid)));
        if (!v) throw notFound('Vendor');
        await db.update(issues).set({ vendorId: v.id, status: 'Assigned', vendorState: 'Assigned' }).where(eq(issues.id, row.id));
      }
      if (want.estimate) await applyEstimate(db, aid, row, want.estimate, s);
      await db.update(inspectionItems).set({ issueId: row.id }).where(eq(inspectionItems.id, x.id));
      created.push(ref(row.number));
    }
    if (created.length) await audit(db, aid, s.userId, s.name, `${created.length} work order${created.length === 1 ? '' : 's'} raised from inspection ${insRef(i.number)} · ${created.join(', ')}`);
    return reply.status(201).send({ created, inspection: await full(i, true) });
  });

  /** the report as a spreadsheet */
  app.get('/admin/:aid/inspections/:id/report.csv', async (req, reply) => {
    const { aid } = await reader(req);
    const r = await full(await find(aid, parse(Id, req.params).id), true);
    const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [
      ['Inspection', r.ref], ['Type', r.type], ['Where', r.where], ['Inspector', r.inspector], ['Started', new Date(r.startedAt).toISOString()], ['Submitted', r.submittedAt ? new Date(r.submittedAt).toISOString() : ''], ['Summary', r.summary], [],
      ['Section', 'Item', 'Condition', 'Note', 'Finding', 'Severity', 'Recommendation', 'Category', 'Photos', 'Checked at', 'Work order', 'Work order status'],
      ...r.sections.flatMap(sec => (sec.items as { item: string; condition: string | null; note: string; finding: string; severity: string | null; recommendation: string | null; category: string | null; photos: string[]; checkedAt: Date | null; workOrder: { ref: string; status: string } | null }[])
        .map(x => [sec.name, x.item, x.condition, x.note, x.finding, x.severity, x.recommendation, x.category, x.photos.join(' '), x.checkedAt ? new Date(x.checkedAt).toISOString() : '', x.workOrder?.ref, x.workOrder?.status])),
    ];
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${r.ref}.csv"`).send('﻿' + lines.map(l => l.map(q).join(',')).join('\r\n'));
  });

  /* ================= the resident or owner ================= */
  /** the flats I belong to, and whether I am there as the owner */
  const homes = async (req: FastifyRequest) => {
    const userId = await uid(req);
    const rows = await db.select({ unitId: unitMembers.unitId, role: unitMembers.role }).from(unitMembers).where(and(eq(unitMembers.userId, userId), eq(unitMembers.status, 'active')));
    if (!rows.length) throw forbidden('Your number isn’t linked to a verified flat yet. Contact your society office.');
    return { userId, rows };
  };
  const mayRead = (i: Inspection, rows: { unitId: string; role: string }[]) => rows.some(r => r.unitId === i.unitId && (r.role === 'Owner' ? i.shareOwner : i.shareTenant));

  app.get('/inspections', async req => {
    const { rows } = await homes(req);
    const list = await db.select({ i: inspections, code: units.code, label: units.label }).from(inspections).innerJoin(units, eq(units.id, inspections.unitId))
      .where(and(inArray(inspections.unitId, rows.map(r => r.unitId)), eq(inspections.status, 'Submitted'))).orderBy(desc(inspections.submittedAt));
    const mine = list.filter(l => mayRead(l.i, rows));
    if (!mine.length) return [];
    const items = await db.select({ inspectionId: inspectionItems.inspectionId, condition: inspectionItems.condition, severity: inspectionItems.severity, finding: inspectionItems.finding, issueId: inspectionItems.issueId })
      .from(inspectionItems).where(inArray(inspectionItems.inspectionId, mine.map(l => l.i.id)));
    return mine.map(l => head(l.i, l.label, l.code, countsOf(items.filter(x => x.inspectionId === l.i.id))));
  });

  const shared = async (req: FastifyRequest) => {
    const { userId, rows } = await homes(req);
    const [i] = await db.select().from(inspections).where(and(eq(inspections.id, parse(z.object({ id: z.uuid() }), req.params).id), eq(inspections.status, 'Submitted')));
    if (!i || !mayRead(i, rows)) throw notFound('That report');
    return { i, userId, role: rows.find(r => r.unitId === i.unitId)!.role };
  };
  app.get('/inspections/:id', async req => full((await shared(req)).i, false));

  /** "I have read this report" — recorded once, with the name and the time */
  app.post('/inspections/:id/ack', async req => {
    const { i, userId, role } = await shared(req);
    const { note } = parse(z.object({ note: z.string().trim().max(500).default('') }), req.body ?? {});
    if (i.ackAt) throw conflict('already_acknowledged', `This report was already acknowledged by ${i.ackName}.`);
    const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, userId));
    const [done] = await db.update(inspections).set({ ackName: u?.name ?? 'Resident', ackRole: role, ackNote: note, ackAt: new Date() }).where(eq(inspections.id, i.id)).returning();
    await audit(db, i.associationId, userId, u?.name ?? 'Resident', `inspection ${insRef(i.number)} acknowledged by the ${role.toLowerCase()}${note ? ' · “' + note.slice(0, 60) + '”' : ''}`);
    return full(done!, false);
  });
};
