import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../app.js';
import { aiAudit, associations, bills, conversationMessages, conversations, issues, issueUpdates, staffRoles, type AiAction, type StaffRole } from '../db/schema.js';
import { audit } from '../lib/audit.js';
import { residentOf, staffOf, userIdFrom } from '../lib/auth.js';
import { remindOverdue } from '../lib/comms.js';
import { notify } from '../lib/community.js';
import { DOMAIN_WORDS, DRAFT_KINDS, periodIn, route, ruleDraft, runTools, SCOPE, toolKeys, toolsByKey, type Card, type DraftKind } from '../lib/copilot.js';
import { billStatus, dueOf, rupees } from '../lib/finance.js';
import { badRequest, conflict, forbidden, notFound, parse } from '../lib/http.js';
import { createIssue, moveIssue, parseRef, ref } from '../lib/issues.js';
import { today } from '../lib/ledger.js';
import { monthlyReport } from '../lib/reports.js';
import { triage } from '../lib/triage.js';
import { announceNew } from './maintenance.js';

const Aid = z.object({ aid: z.uuid() });
const EVERYONE: StaffRole[] = ['admin', 'committee', 'moderator', 'auditor', 'guard', 'operator'];
const ROLE_NAME: Record<StaffRole, string> = { operator: 'Operator', admin: 'Society admin', vpm: 'Property manager', committee: 'Committee member', moderator: 'Moderator', auditor: 'Auditor', guard: 'Security guard' };
const canAct = (r: StaffRole) => r === 'admin' || r === 'vpm' || r === 'operator';

const EXAMPLES: Record<string, string[]> = {
  finance: ['Total maintenance collected this month?', 'Show pending dues', 'Which head has the highest expenses?', 'Outstanding vendor payments?'],
  maintenance: ['Which complaints are pending?', 'Which vendor is overloaded?', 'Show emergency complaints', 'Which work order is overdue?'],
  residents: ['Show lease expiry list', 'Show residents with more than two complaints', 'Find flat 1108'],
  gate: ['Visitors entered today', 'Vehicles currently inside', 'Staff attendance today'],
  community: ['Poll results', 'AGM attendance', 'Recent notices'],
};

/* what the person wants done, read from the words — an action is only ever proposed here, never carried out */
const WANTS = {
  draft: /\b(draft|write|compose|prepare)\b.*\b(notice|message|reminder|greetings?|wishes|invitation|invite|reply|response|follow.?up|summary|announcement)\b/i,
  report: /\b(generate|prepare|create|make|show|give|get)\b.*\breport\b|\bmonthly report\b/i,
  reminders: /\b(send|issue|push)\b.*\breminders?\b|\bremind\b.*\b(residents?|flats?|defaulters?|everyone|all)\b/i,
  workOrder: /\b(create|raise|log|open|make|book)\b\s+(?:a |an |the )?(?:new )?(?:work ?order|ticket|complaint|maintenance request|request|job)\b\s*(?:for|about|regarding|on|:|-|–|to)?\s*(.*)/i,
};
const draftKind = (t: string): DraftKind =>
  /water/i.test(t) ? 'Water shutdown notice' : /festival|greeting|wishes|diwali|ugadi|pongal|eid|christmas|new year|holi|onam/i.test(t) ? 'Festival greetings' : /meeting|agm|invit/i.test(t) ? 'Meeting invitation'
  : /vendor|contractor/i.test(t) ? 'Vendor follow-up' : /payment|dues|due\b/i.test(t) ? 'Payment reminder' : /complaint/i.test(t) ? 'Complaint response' : /owner/i.test(t) ? 'Owner monthly summary' : /reply|response/i.test(t) ? 'Resident reply' : 'Maintenance notice';

const Picked = z.object({ tools: z.array(z.string()) });
const DRAFT = z.object({ title: z.string(), body: z.string() });
const DRAFT_SCHEMA = { type: 'object', additionalProperties: false, required: ['title', 'body'], properties: { title: { type: 'string' }, body: { type: 'string' } } } as const;

/**
 * The staff assistant, the things built on it, and the record of what it did.
 *   /v1/admin/:aid/assistant/*   ask, confirm or cancel an action, draft a message, triage a complaint
 *   /v1/admin/:aid/search · /ai-audit
 */
export const copilotRoutes = ({ config, db, ai, messenger }: Deps): FastifyPluginAsync => async app => {
  const uid = (req: FastifyRequest) => userIdFrom(req, config.JWT_SECRET);
  const staff = async (req: FastifyRequest, roles: StaffRole[]) => {
    const { aid } = parse(Aid, req.params);
    return { aid, s: await staffOf(db, await uid(req), aid, roles) };
  };
  const societyName = async (aid: string) => (await db.select({ name: associations.name }).from(associations).where(eq(associations.id, aid)))[0]?.name ?? 'The society office';

  app.get('/admin/:aid/assistant/about', async req => {
    const { s } = await staff(req, EVERYONE);
    const domains = SCOPE[s.role];
    return { role: ROLE_NAME[s.role], sees: domains.map(d => DOMAIN_WORDS[d]), canAct: canAct(s.role), aiConnected: ai.enabled, draftKinds: DRAFT_KINDS,
      examples: [...domains.flatMap(d => EXAMPLES[d]!.slice(0, 2)), ...(canAct(s.role) ? ['Send payment reminders to all pending residents', 'Create work order for lift maintenance', 'Generate monthly report'] : [])] };
  });

  const write = async (o: { text: string; cards: Card[]; system?: string }) => {
    const rule = o.cards.map(c => c.headline).join(' ');
    if (!ai.enabled || !o.cards.length) return { text: rule, by: 'rules' as const };
    const out = await ai.compose(
      'You are the assistant inside a housing society\'s management console in India. Answer the staff member\'s question from the data given and nothing else. Two to four plain sentences, no markdown, no lists (a table is shown beside your answer). Rupee amounts exactly as given. If the data does not answer the question, say so plainly.',
      `Question: ${o.text}\n\n${o.cards.map(c => `${c.title}\n${c.headline}\n${[c.columns.join(' | '), ...c.rows.map(r => r.join(' | '))].join('\n')}`).join('\n\n')}`);
    return out ? { text: out, by: 'ai' as const } : { text: rule, by: 'rules' as const };
  };

  /** One thing asked of the assistant: a question answered from records, or an action proposed for a yes. */
  app.post('/admin/:aid/assistant/ask', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async req => {
    const { aid, s } = await staff(req, EVERYONE);
    const { text } = parse(z.object({ text: z.string().trim().min(2).max(1000) }), req.body);
    const record = async (o: { response: string; data?: string[]; action?: AiAction; status?: 'answered' | 'refused' | 'proposed'; by?: 'ai' | 'rules' }) => {
      const [row] = await db.insert(aiAudit).values({ associationId: aid, userId: s.userId, userName: s.name, role: ROLE_NAME[s.role], surface: 'console', prompt: text, response: o.response,
        dataAccessed: o.data ?? [], action: o.action ?? null, approvalRequired: !!o.action, status: o.status ?? 'answered', by: o.by ?? 'rules' }).returning({ id: aiAudit.id });
      return row!.id;
    };
    const refuse = async (response: string) => ({ id: await record({ response, status: 'refused' }), text: response, cards: [], refused: true, by: 'rules' });
    const propose = async (action: AiAction, response: string, data: string[]) => {
      if (!canAct(s.role)) return refuse(`As a ${ROLE_NAME[s.role].toLowerCase()} you can look things up, but only the society admin or property manager can do that.`);
      const id = await record({ response, action, status: 'proposed', data });
      return { id, text: response, cards: [], action: { id, ...action }, by: 'rules' };
    };

    /* ----- things to write or do ----- */
    if (WANTS.draft.test(text)) {
      const kind = draftKind(text), details = text.replace(WANTS.draft, ' ').replace(/\b(about|for|regarding|on|to|a|an|the)\b/gi, ' ').replace(/\s+/g, ' ').trim();
      const d = await draft(aid, kind, details.length > 3 ? details : '');
      return { id: await record({ response: d.title + ' — ' + d.body, by: d.by }), text: `Here is a draft ${kind.toLowerCase()}. Nothing has been sent — open Communication to choose who gets it.`, cards: [], draft: { kind, ...d }, link: '/communication', by: d.by };
    }
    if (WANTS.report.test(text)) {
      if (!SCOPE[s.role].includes('finance')) return refuse(`As a ${ROLE_NAME[s.role].toLowerCase()} you can see ${SCOPE[s.role].map(d => DOMAIN_WORDS[d]).join(', ')} only — the monthly report is not part of that.`);
      const r = await monthlyReport(db, ai, aid, periodIn(text));
      return { id: await record({ response: r.summary, data: ['accounts', 'payments', 'dues', 'work orders', 'vendors', 'flats'], by: r.summaryBy }), text: r.summary, cards: [], link: '/accounts', linkLabel: 'Open Accounts for the full reports', by: r.summaryBy };
    }
    if (WANTS.reminders.test(text)) {
      const late = (await db.select().from(bills).where(and(eq(bills.associationId, aid), isNull(bills.cancelledAt)))).filter(b => billStatus(b) === 'Overdue');
      const flats = new Set(late.map(b => b.unitId)).size, amount = late.reduce((n, b) => n + dueOf(b), 0);
      if (!flats) return { id: await record({ response: 'No flat has an overdue payment, so there is nobody to remind.', data: ['dues'] }), text: 'No flat has an overdue payment, so there is nobody to remind.', cards: [], by: 'rules' };
      return propose({ kind: 'send_reminders', flats, amount }, `${flats} flat${flats === 1 ? ' has' : 's have'} overdue payments totalling ${rupees(amount)}. Shall I send them a payment reminder by app alert, WhatsApp and SMS?`, ['dues']);
    }
    const wo = WANTS.workOrder.exec(text);
    if (wo) {
      const subject = (wo[2] ?? '').trim();
      if (subject.length < 4) return { id: await record({ response: 'What is the work order for?' }), text: 'What is the work order for? For example: “Create work order for lift maintenance in Tower 2”.', cards: [], by: 'rules' };
      const t = await triage(db, ai, aid, subject);
      return propose({ kind: 'create_work_order', title: t.title, category: t.category, priority: t.priority, asset: t.asset, vendorId: t.vendor?.id ?? null, vendor: t.vendor?.name ?? null },
        `I can raise a work order “${t.title}” — ${t.category}, ${t.priority.toLowerCase()} priority (response within ${t.slaHours} hours)${t.vendor ? `, assigned to ${t.vendor.name}` : ', with no vendor yet — none on file for this trade'}. Go ahead?`, ['vendors']);
    }

    /* ----- questions ----- */
    let { allowed, denied } = route(text, s.role);
    if (!allowed.length && denied.length) return refuse(`As a ${ROLE_NAME[s.role].toLowerCase()} you can see ${SCOPE[s.role].map(d => DOMAIN_WORDS[d]).join(', ')} only, so I can’t show ${denied.map(d => DOMAIN_WORDS[d]).join(' or ')}.`);
    if (!allowed.length && ai.enabled) {
      // free wording the rules didn't recognise: the model may only choose among this role's own tools
      const keys = toolKeys(s.role);
      const pick = await ai.extract({ name: 'pick', check: Picked, schema: { type: 'object', additionalProperties: false, required: ['tools'], properties: { tools: { type: 'array', items: { type: 'string', enum: keys.map(k => k.key) } } } },
        system: 'Choose which look-ups answer a staff member\'s question about their housing society. Pick at most three; pick none if no look-up fits.', user: `Question: ${text}\n\nLook-ups:\n${keys.map(k => `- ${k.key}: ${k.about}`).join('\n')}` });
      if (pick?.tools.length) allowed = toolsByKey(pick.tools, s.role);
    }
    if (!allowed.length) {
      const response = `I couldn’t match that to anything I can look up. I can answer questions about ${SCOPE[s.role].map(d => DOMAIN_WORDS[d]).join(', ')}.`;
      return { id: await record({ response }), text: response, cards: [], chips: SCOPE[s.role].flatMap(d => EXAMPLES[d]!.slice(0, 1)), by: 'rules' };
    }
    const cards = await runTools(db, aid, text, allowed);
    const out = await write({ text, cards });
    const note = denied.length ? ` (I left out ${denied.map(d => DOMAIN_WORDS[d]).join(' and ')} — your role can’t see that.)` : '';
    return { id: await record({ response: out.text + note, data: [...new Set(cards.map(c => c.data))], by: out.by }), text: out.text + note, cards, by: out.by };
  });

  /** yes: carry out what was proposed — once, by the person it was proposed to */
  app.post('/admin/:aid/assistant/actions/:id/:verdict', async req => {
    const { aid, s } = await staff(req, ['admin', 'operator']);
    const p = parse(Aid.extend({ id: z.uuid(), verdict: z.enum(['confirm', 'cancel']) }), req.params);
    const [row] = await db.select().from(aiAudit).where(and(eq(aiAudit.id, p.id), eq(aiAudit.associationId, aid)));
    if (!row?.action) throw notFound('That action');
    if (row.userId !== s.userId) throw forbidden('Only the person who asked can confirm this.');
    if (row.status !== 'proposed') throw conflict('already_decided', `This was already ${row.status}.`);
    if (p.verdict === 'cancel') { await db.update(aiAudit).set({ status: 'cancelled', outcome: 'Cancelled by ' + s.name }).where(eq(aiAudit.id, row.id)); return { status: 'cancelled', outcome: 'Cancelled — nothing was done.' }; }
    const by = { userId: s.userId, name: s.name }, a = row.action;
    let outcome = '', link: string | null = null;
    try {
      if (a.kind === 'send_reminders') {
        const r = await remindOverdue(db, messenger, aid, by);
        outcome = r.flats ? `Reminder sent to ${r.residents} resident${r.residents === 1 ? '' : 's'} in ${r.flats} flat${r.flats === 1 ? '' : 's'}, and logged in Communication.` : 'Nobody is overdue any more — nothing was sent.';
        link = '/communication';
      } else if (a.kind === 'create_work_order') {
        const made = await createIssue(db, { associationId: aid, reporterId: s.userId, reporterName: s.name, unitId: null, via: 'admin', title: a.title, category: a.category, location: a.asset ?? 'Common area', priority: a.priority, scope: 'common', asset: a.asset ?? undefined, details: 'Raised through the assistant: “' + row.prompt + '”' });
        await announceNew(db, aid, made.number, made.title, made.priority);
        if (a.vendorId) {
          await moveIssue(db, { associationId: aid, number: made.number, to: 'Acknowledged', byUserId: s.userId, byName: s.name });
          await moveIssue(db, { associationId: aid, number: made.number, to: 'Assigned', vendorId: a.vendorId, byUserId: s.userId, byName: s.name });
        }
        outcome = `Work order ${ref(made.number)} raised${a.vendor ? ` and assigned to ${a.vendor}` : ''}. The office${a.priority === 'Emergency' ? ' and the committee have' : ' has'} been told.`;
        link = '/issues';
      } else throw badRequest('unsupported', 'That action can’t be run here.');
    } catch (e) {
      const why = e instanceof Error ? e.message : 'It could not be completed.';
      await db.update(aiAudit).set({ status: 'failed', outcome: why }).where(eq(aiAudit.id, row.id));
      throw e;
    }
    await db.update(aiAudit).set({ status: 'done', outcome }).where(eq(aiAudit.id, row.id));
    await audit(db, aid, s.userId, s.name, 'assistant action confirmed · ' + outcome);
    return { status: 'done', outcome, link };
  });

  /* ----- drafting ----- */
  const draft = async (aid: string, kind: DraftKind, details: string) => {
    const society = await societyName(aid), rule = ruleDraft(kind, details, society);
    if (!ai.enabled) return { ...rule, by: 'rules' as const };
    const out = await ai.extract({ name: 'draft', schema: DRAFT_SCHEMA, check: DRAFT,
      system: `You draft messages a housing society's office in India sends to its residents, owners and vendors. Write a ${kind.toLowerCase()} from "${society}". Plain, polite, short — it will be read on a phone. Use only the details given. Where a fact the message needs is not given (a date, a time, an amount, a place), put its name in square brackets for the office to fill in — for example [date], [time], [venue] — never an empty bracket and never a made-up value. Address only the people this kind of message is for (residents for a notice, the vendor for a vendor follow-up), not a list of everyone. No markdown.`,
      user: details || '(no details given)' });
    return out ? { title: out.title.slice(0, 120), body: out.body.slice(0, 3000), by: 'ai' as const } : { ...rule, by: 'rules' as const };
  };
  app.post('/admin/:aid/assistant/draft', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async req => {
    const { aid, s } = await staff(req, ['admin', 'operator', 'committee']);
    const b = parse(z.object({ kind: z.enum(DRAFT_KINDS), details: z.string().trim().max(1500).default('') }), req.body);
    const d = await draft(aid, b.kind, b.details);
    await db.insert(aiAudit).values({ associationId: aid, userId: s.userId, userName: s.name, role: ROLE_NAME[s.role], surface: 'console', prompt: `Draft: ${b.kind}${b.details ? ' — ' + b.details : ''}`, response: d.title + ' — ' + d.body, dataAccessed: [], by: d.by });
    return d;
  });

  /* ----- reading a complaint ----- */
  app.post('/admin/:aid/assistant/triage', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async req => {
    const { aid } = await staff(req, ['admin', 'operator', 'committee']);
    return triage(db, ai, aid, parse(z.object({ text: z.string().trim().min(4).max(2000) }), req.body).text);
  });
  /** the same reading for a complaint already on file: what the assistant would file it under and who it would send */
  app.get('/admin/:aid/issues/:ref/suggestion', async req => {
    const { aid } = await staff(req, ['admin', 'operator', 'committee']);
    const n = parseRef(parse(Aid.extend({ ref: z.string() }), req.params).ref);
    const [i] = await db.select().from(issues).where(and(eq(issues.associationId, aid), eq(issues.number, n)));
    if (!i) throw notFound('Issue');
    const [first] = await db.select({ text: issueUpdates.text }).from(issueUpdates).where(eq(issueUpdates.issueId, i.id)).orderBy(asc(issueUpdates.createdAt)).limit(1);
    const t = await triage(db, ai, aid, [i.title, first?.text].filter(Boolean).join('. '));
    return { ...t, current: { category: i.category, priority: i.priority, vendorId: i.vendorId }, differs: t.category !== i.category || t.priority !== i.priority };
  });

  /* ----- search ----- */
  /** type a few letters, land on the record: flats and people, vendors, work orders, and the console's own pages */
  app.get('/admin/:aid/search', async req => {
    const { aid, s } = await staff(req, ['admin', 'committee', 'moderator', 'auditor', 'operator']);
    const { q } = parse(z.object({ q: z.string().trim().min(2).max(60) }), req.query);
    const like = '%' + q.replace(/[%_]/g, '') + '%', sees = SCOPE[s.role];
    const rowsOf = async <T>(query: ReturnType<typeof sql>) => ((await db.execute(query)) as unknown as { rows: T[] }).rows;
    type Hit = { kind: string; label: string; sub: string; link: string };
    const hits: Hit[] = [];
    const PAGES: [string, string, RegExp, string][] = [
      ['Accounts', '/accounts', /account|collection|bill|dues|payment|expense|ledger|receipt|unpaid/i, 'finance'], ['Issues', '/issues', /issue|complaint|ticket|request/i, 'maintenance'],
      ['Maintenance & vendors', '/maintenance', /maintenance|vendor|invoice|work order/i, 'maintenance'], ['Gate', '/gate', /gate|visitor|guard|parcel|delivery/i, 'gate'],
      ['Communication', '/communication', /message|communication|email|notice/i, 'community'], ['Owners', '/owners', /owner|lease|rent|payout|document/i, 'finance'],
      ['Gate & emergencies', '/gate', /emergency|sos|incident/i, 'gate'], ['Inspections', '/inspections', /inspect|checklist|move.?in|move.?out/i, 'maintenance'],
      ['Residents', '/residents', /user|resident|member|owner|tenant/i, 'residents'], ['Flats & units', '/flats', /unit|flat|tower|plot/i, 'residents'], ['Events & polls', '/events-polls', /event|poll|agm|meeting/i, 'community'],
    ];
    for (const [label, link, re, d] of PAGES) if (re.test(q) && sees.includes(d as never)) hits.push({ kind: 'Page', label, sub: 'Open this screen', link });
    if (sees.includes('residents')) {
      for (const u of await rowsOf<{ code: string; label: string; people: string | null }>(sql`
        select u.code, u.label, (select string_agg(us.name, ', ') from unit_members m join users us on us.id = m.user_id where m.unit_id = u.id and m.status = 'active') as people
        from units u where u.association_id = ${aid} and (u.code ilike ${like} or replace(u.code, '-', '') ilike ${like}
          or exists (select 1 from unit_members m join users us on us.id = m.user_id where m.unit_id = u.id and us.name ilike ${like})) order by u.code limit 6`)) hits.push({ kind: 'Flat', label: u.code, sub: u.people ?? u.label, link: '/users' });
    }
    if (sees.includes('maintenance')) {
      for (const v of await rowsOf<{ name: string; category: string }>(sql`select name, category from vendors where association_id = ${aid} and (name ilike ${like} or category ilike ${like}) order by name limit 5`)) hits.push({ kind: 'Vendor', label: v.name, sub: v.category, link: '/maintenance' });
      const num = /^(?:iss-?)?(\d{3,6})$/i.exec(q)?.[1];
      for (const i of await rowsOf<{ number: number; title: string; status: string }>(sql`select number, title, status from issues where association_id = ${aid} and (title ilike ${like} or number = ${num ? Number(num) : -1}) order by created_at desc limit 6`)) hits.push({ kind: 'Work order', label: 'ISS-' + i.number, sub: `${i.title} · ${i.status}`, link: '/issues' });
    }
    if (sees.includes('finance')) {
      for (const b of await rowsOf<{ number: string; code: string; amount: number }>(sql`select b.number, u.code, b.amount from bills b join units u on u.id = b.unit_id where b.association_id = ${aid} and b.number ilike ${like} order by b.created_at desc limit 4`)) hits.push({ kind: 'Bill', label: b.number, sub: `${b.code} · ${rupees(b.amount)}`, link: '/accounts' });
    }
    return hits.slice(0, 20);
  });

  /** every question asked of the assistant and every action it proposed — who, what, when, and what came of it */
  app.get('/admin/:aid/ai-audit', async req => {
    const { aid } = await staff(req, ['admin', 'committee', 'operator']);
    const q = parse(z.object({ only: z.enum(['all', 'actions']).default('all') }), req.query);
    const list = await db.select().from(aiAudit).where(and(eq(aiAudit.associationId, aid), q.only === 'actions' ? eq(aiAudit.approvalRequired, true) : undefined)).orderBy(desc(aiAudit.createdAt)).limit(200);
    return list.map(r => ({ id: r.id, at: r.createdAt, user: r.userName, role: r.role, surface: r.surface, prompt: r.prompt, response: r.response, dataAccessed: r.dataAccessed,
      action: r.action?.kind ?? null, approvalRequired: r.approvalRequired, status: r.status, outcome: r.outcome, by: r.by }));
  });

  /* ================= the resident ================= */
  /** "I couldn't find that" → one tap sends the question to the society office as a conversation */
  app.post('/assistant/ask-office', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
    const me = await residentOf(db, await uid(req));
    const { text } = parse(z.object({ text: z.string().trim().min(3).max(2000) }), req.body);
    const [c] = await db.insert(conversations).values({ associationId: me.associationId, userId: me.userId, subject: text.slice(0, 110), topic: 'General' }).returning();
    await db.insert(conversationMessages).values({ conversationId: c!.id, fromUserId: me.userId, fromRole: 'resident', fromName: me.name, text: text + '\n\n(Sent from the assistant, which could not answer this.)' });
    const office = (await db.select({ userId: staffRoles.userId }).from(staffRoles).where(and(eq(staffRoles.associationId, me.associationId), inArray(staffRoles.role, ['admin', 'vpm'])))).map(x => x.userId);
    await notify(db, office, { kind: 'messages', title: `${me.name} (${me.unitCode}): ${text.slice(0, 60)}`, body: 'A question the assistant could not answer.', href: '/messages/' + c!.id });
    await db.insert(aiAudit).values({ associationId: me.associationId, userId: me.userId, userName: me.name, role: 'Resident', surface: 'app', prompt: text, response: 'Not found in the approved information.', dataAccessed: [],
      action: { kind: 'ask_office', question: text.slice(0, 200) }, approvalRequired: true, status: 'done', outcome: 'Sent to the society office as a message.' });
    return reply.status(201).send({ conversationId: c!.id });
  });
};
