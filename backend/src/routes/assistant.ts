import { and, asc, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../app.js';
import { aiSettings, AUTO_HOLD, announcements, bills, chatMessages, contacts, documents, events, issues, knowledgeDocs, payments, polls, units, userSettings, visits, type StaffRole } from '../db/schema.js';
import { answerKey, shareable, storeAnswer, storedAnswer } from '../lib/answers.js';
import { audit } from '../lib/audit.js';
import { factDocs, FACTS, FACTS_TITLE, factValue, type FactKey } from '../lib/facts.js';
import { extractAnswer, isEmergency, relevant, ruleRewrite, understand } from '../lib/assistant.js';
import { residentOf, staffOf, userIdFrom, type Resident } from '../lib/auth.js';
import { thresholdOf } from '../lib/community.js';
import { billStatus, dueOf, rupees, unitBalances } from '../lib/finance.js';
import { forbidden, notFound, parse } from '../lib/http.js';
import { checkSafety } from '../lib/safety.js';

const TONES = ['Polite', 'Friendly', 'Funny', 'Short & Clear'] as const;
const NOT_FOUND = 'I couldn’t find that in the approved community information, so I won’t guess. You can rephrase, or ask the society office.';
const CHIPS = ['Report an issue', 'When is the water shutdown?', 'What are the pool timings?'];
/** `link` opens the screen that holds the answer; `offer` lets the resident pass an unanswered question to the office in one tap */
type Reply = {
  text: string; source: string | null; chips?: string[]; calls?: [string, string][]; link?: { label: string; href: string }; offer?: 'ask_office';
  /** an emergency: the app shows its SOS button first, above the numbers */
  sos?: boolean;
  /** the message was not answered because it read as rude; the app hands it back to be rephrased */
  flagged?: { level: 'warn' | 'block'; words: string[] };
};

export const assistantRoutes = ({ config, db, ai, quota }: Deps): FastifyPluginAsync => async app => {
  const me = async (req: FastifyRequest) => residentOf(db, await userIdFrom(req, config.JWT_SECRET));
  const settings = async (aid: string) => {
    const [s] = await db.select().from(aiSettings).where(eq(aiSettings.associationId, aid));
    return s ?? { associationId: aid, qna: true, issueCreate: true, toneRewrite: true, summaries: true, tones: Object.fromEntries(TONES.map(t => [t, true])), autoHold: 'Medium & above' as const };
  };
  const keepsHistory = async (userId: string) => {
    const [s] = await db.select({ privacy: userSettings.privacy }).from(userSettings).where(eq(userSettings.userId, userId));
    return s?.privacy.aiHistory !== false;
  };

  /** live records the assistant may quote: what's on, what's open, and the resident's own tickets */
  const liveRecords = async (r: Resident) => {
    const day = (d: Date) => d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
    const [notices, upcoming, openPolls, mine] = await Promise.all([
      db.select().from(announcements).where(eq(announcements.associationId, r.associationId)).orderBy(desc(announcements.publishedAt)).limit(6),
      db.select().from(events).where(and(eq(events.associationId, r.associationId), gte(events.startsAt, new Date()))).orderBy(asc(events.startsAt)).limit(8),
      db.select().from(polls).where(and(eq(polls.associationId, r.associationId), sql`${polls.closedAt} is null`, gte(polls.closesAt, new Date()))),
      db.select().from(issues).where(and(eq(issues.associationId, r.associationId), eq(issues.reporterId, r.userId))).orderBy(desc(issues.createdAt)).limit(8),
    ]);
    const none = '(none right now)';
    return {
      notices,
      today: day(new Date()),
      docs: [
        { title: 'Upcoming events', section: '', body: upcoming.map(e => `- ${e.title}: ${day(e.startsAt)}, ${e.location}, capacity ${e.capacity}. ${e.description}`).join('\n') || none },
        { title: 'Open polls', section: '', body: openPolls.map(p => `- ${p.question} (closes ${day(p.closesAt)}${p.eligibility === 'owners' ? ', owners only' : ''})`).join('\n') || none },
        { title: 'Your issues', section: '', body: mine.map(i => `- ISS-${i.number} ${i.title}: ${i.status}, reported ${day(i.createdAt)}`).join('\n') || none },
      ],
    };
  };

  /**
   * The resident's own account, for self-service: what the flat owes, receipts, visitors, the lease.
   * `docs` go to the model as records it may quote; `direct` answers the plain cases by rule, and
   * says which screen to open — so "download my receipt" works with or without a model.
   */
  const selfService = async (r: Resident) => {
    const day = (d: Date | string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    const [owes, open, paid, gate, unit, files] = await Promise.all([
      unitBalances(db, r.associationId).then(m => m.get(r.unitId) ?? 0),
      db.select().from(bills).where(and(eq(bills.unitId, r.unitId), isNull(bills.cancelledAt))).orderBy(asc(bills.dueDate)).then(l => l.filter(b => dueOf(b) > 0)),
      db.select().from(payments).where(and(eq(payments.unitId, r.unitId), isNull(payments.reversedAt))).orderBy(desc(payments.receivedOn), desc(payments.createdAt)).limit(3),
      db.select().from(visits).where(and(eq(visits.unitId, r.unitId), inArray(visits.status, ['Expected', 'Pending', 'AtGate', 'Inside']))).orderBy(desc(visits.createdAt)).limit(8),
      db.select({ occupancy: units.occupancy, leaseEnd: units.leaseEnd }).from(units).where(eq(units.id, r.unitId)).then(x => x[0]),
      db.select({ title: documents.title, kind: documents.kind }).from(documents).where(and(eq(documents.unitId, r.unitId), eq(documents.shared, true))),
    ]);
    const nextDue = open[0];
    const duesText = owes > 0
      ? `Your flat ${r.unitCode} owes ${rupees(owes)}.${nextDue ? ` The ${billStatus(nextDue) === 'Overdue' ? 'oldest unpaid bill was' : 'next bill is'} due on ${day(nextDue.dueDate)} (${nextDue.chargeType}, ${rupees(dueOf(nextDue))}).` : ''}`
      : owes < 0 ? `Nothing is due for ${r.unitCode}. You have ${rupees(-owes)} paid in advance.` : `Nothing is due for ${r.unitCode} right now.`;
    const lease = files.find(f => f.kind === 'Lease');
    const waiting = gate.filter(v => v.status === 'Pending');
    const visitLine = (v: typeof gate[number]) => `${v.name} (${v.visitorType}): ${v.status === 'Pending' ? 'waiting for your approval at the gate' : v.status === 'Expected' ? 'expected, pass ' + (v.passCode ?? '') : v.status === 'AtGate' ? 'parcel kept at the gate' : 'inside now'}`;
    const docs = [
      { title: 'Your dues', section: '', body: duesText + (open.length ? '\nUnpaid bills:\n' + open.map(b => `- ${b.number}: ${b.chargeType} ${b.period}, ${rupees(dueOf(b))} due ${day(b.dueDate)} (${billStatus(b)})`).join('\n') : '') },
      { title: 'Your payments', section: '', body: paid.map(p => `- Receipt ${p.number}: ${rupees(p.amount)} by ${p.mode} on ${day(p.receivedOn)}`).join('\n') || '(no payments recorded yet)' },
      { title: 'Your visitors', section: '', body: gate.map(v => '- ' + visitLine(v)).join('\n') || '(no visitors expected or waiting)' },
      { title: 'Your flat', section: '', body: `${r.unitLabel}. You are registered as ${r.role}. Occupancy: ${unit?.occupancy ?? 'not recorded'}.${unit?.leaseEnd ? ' Lease ends ' + day(unit.leaseEnd) + '.' : ''} Documents shared with this flat: ${files.map(f => `${f.title} (${f.kind})`).join(', ') || 'none'}.` },
    ];
    const RECEIPT = /\breceipts?\b|रसीद|ರಸೀದಿ/i;
    /** the screen a question is about, whoever answers it */
    const linkFor = (q: string): Reply['link'] => {
      if (RECEIPT.test(q) && paid[0]) return { label: 'Open receipt ' + paid[0].number, href: '/dues/receipt/' + paid[0].id };
      if (/\b(dues?|owe|outstanding|maintenance (due|bill|payment|charge)s?|bills?|pay(ment)?)\b|बकाया|ಬಾಕಿ/i.test(q)) return { label: 'Open Dues', href: '/dues' };
      if (/\b(visitors?|guests?|deliver\w*|parcels?|gate pass)\b|मेहमान|ಅತಿಥಿ/i.test(q)) return { label: 'Open Visitors', href: '/gate' };
      if (/\blease\b/i.test(q) && lease && r.role === 'Owner') return { label: 'Open Documents', href: '/owner/documents' };
      return undefined;
    };
    const direct = (q: string): Reply | null => {
      const link = linkFor(q);
      if (RECEIPT.test(q)) {
        return paid[0]
          ? { text: `Your latest receipt is ${paid[0].number}: ${rupees(paid[0].amount)} paid by ${paid[0].mode} on ${day(paid[0].receivedOn)}. Open it to view or share it.`, source: 'Your payments', link }
          : { text: 'No payment has been recorded for your flat yet, so there is no receipt.', source: 'Your payments', link: { label: 'Open Dues', href: '/dues' } };
      }
      if (link?.href === '/dues') return { text: duesText, source: 'Your dues', link };
      if (link?.href === '/gate') {
        return { source: 'Your visitors', link, text: waiting.length ? `${waiting.map(v => v.name).join(', ')} ${waiting.length === 1 ? 'is' : 'are'} waiting at the gate for your approval.`
          : gate.length ? gate.map(visitLine).join('. ') + '.' : 'No visitor is expected or waiting for your flat right now.' };
      }
      if (/\blease\b/i.test(q)) {
        return { source: 'Your flat', link, text: (unit?.leaseEnd ? `The lease for ${r.unitCode} ends on ${day(unit.leaseEnd)}. ` : `No lease end date is recorded for ${r.unitCode}. `)
          + (lease ? (r.role === 'Owner' ? 'The lease copy is in your documents.' : 'A lease copy is on file with the office — ask them to share it with you.') : 'No lease copy has been shared with this flat yet.') };
      }
      return null;
    };
    return { docs, linkFor, direct };
  };

  /**
   * One question, one grounded answer. Order matters: abuse and emergencies are handled by fixed rules
   * before anything reaches a model, and the model only ever sees approved documents and live records.
   */
  app.post('/assistant/chat', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async req => {
    const r = await me(req);
    const { text } = parse(z.object({ text: z.string().trim().min(1).max(2000) }), req.body);
    quota.take('chat', r.userId); // each resident's own allowance: a few a minute, a daily cap
    const cfg = await settings(r.associationId);
    const remember = await keepsHistory(r.userId);
    const done = async (reply: Reply) => {
      // one statement would stamp both rows with the same instant; the answer is kept a millisecond after its question
      const now = Date.now();
      if (remember) await db.insert(chatMessages).values([
        { userId: r.userId, role: 'user', text, createdAt: new Date(now) },
        { userId: r.userId, role: 'assistant', text: reply.text, source: reply.source, createdAt: new Date(now + 1) },
      ]);
      return reply;
    };

    // word lists first (instant, free); if they pass and AI is connected, a second opinion for rude sentences no list can catch
    const rules = checkSafety(text, await thresholdOf(db, r.associationId));
    const safety = rules.level !== 'safe' || !ai.enabled ? rules : ((await ai.moderate(text)) ?? rules);
    if (safety.level !== 'safe') {
      // not answered and not kept: the app takes the message back and offers to help rephrase it
      const named = safety.words.length ? `I noticed ${safety.words.slice(0, 3).map(w => '“' + w + '”').join(', ')} — that` : 'That';
      return { text: `${named} may land badly with your neighbours. Let’s keep our community respectful 💜`, source: null, chips: ['Start over'], flagged: { level: safety.level, words: safety.words } } satisfies Reply;
    }

    const understood = understand(text);
    if (isEmergency(understood)) {
      const numbers = await db.select({ name: contacts.name, phone: contacts.phone }).from(contacts)
        .where(and(eq(contacts.associationId, r.associationId), eq(contacts.group, 'emergency'))).orderBy(asc(contacts.position));
      const calls = numbers.map(n => [n.name, n.phone.replace(/\s/g, '')] as [string, string]);
      // 112 reaches police, fire and ambulance anywhere in India
      if (!calls.some(([, p]) => p === '112')) calls.push(['National emergency · 112', '112']);
      return done({
        text: 'Press SOS to alert the security team right now — they see it at the gate at once. If someone is hurt, in danger or stuck in a lift, also call a number below.\n\nI have not contacted any emergency service myself. Once everyone is safe, I can log an issue for the committee.',
        source: 'Emergency contacts · Directory', chips: ['Open the Directory', 'Report an issue'], sos: true, calls,
      });
    }

    if (!cfg.qna) return done({ text: 'Community Q&A is currently switched off by your society admin. You can still report an issue or contact the society office.', source: null, chips: ['Report an issue'] });

    const docs = await db.select({ title: knowledgeDocs.title, section: knowledgeDocs.section, body: knowledgeDocs.body }).from(knowledgeDocs).where(eq(knowledgeDocs.associationId, r.associationId));
    const live = await liveRecords(r);
    const self = await selfService(r);
    // notices are searchable like documents, so "when is the water shutdown" finds AN-118
    const library = [...docs, ...live.notices.map(a => ({ title: `Announcement ${a.ref}`, section: a.title, body: `${a.body} [Notice details — audience: ${a.audience}; from: ${a.byName}; posted on ${a.publishedAt.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}. The posting date is when the notice went up, not when what it describes happens.]` }))];

    if (ai.enabled) {
      const history = remember
        ? (await db.select({ role: chatMessages.role, text: chatMessages.text }).from(chatMessages).where(and(eq(chatMessages.userId, r.userId), eq(chatMessages.flow, false))).orderBy(desc(chatMessages.createdAt), desc(chatMessages.id)).limit(6)).reverse()
        : [];
      // a small library goes in whole; a large one is narrowed to the related documents
      const candidates = library.length <= 12 ? library : relevant(text, library, 8, { strict: false });
      // a question about the society's shared information (not about this resident, not a follow-up) is answered from
      // the shared documents alone — no history, no personal records — so the answer can be kept and given to the
      // next resident who asks the same thing (lib/answers.ts)
      if (shareable(text, !!self.linkFor(text))) {
        const shared = [...candidates, ...live.docs.filter(d => !d.title.startsWith('Your '))];
        const key = answerKey(r.associationId, text, shared);
        const kept = await storedAnswer(db, key);
        if (kept) return done({ text: kept.text, source: kept.sources.join(' · '), link: self.linkFor(text) });
        const general = await ai.answer(text, { docs: shared, today: live.today, history: [] });
        if (general && general.sources.length) {
          await storeAnswer(db, r.associationId, key, general);
          return done({ text: general.text, source: general.sources.join(' · '), link: self.linkFor(text) });
        }
        // not in the shared information: ask again below with everything, and keep nothing
      }
      // the live records always go in: "what's on this week" or "where is my issue" is answered from them
      const out = await ai.answer(text, { docs: [...candidates, ...live.docs, ...self.docs], today: live.today, history });
      if (out) return done({ text: out.text, source: out.sources.length ? out.sources.join(' · ') : null, chips: out.sources.length ? undefined : CHIPS, link: out.sources.length ? self.linkFor(text) : undefined, offer: out.sources.length ? undefined : 'ask_office' });
      // the model was unavailable — fall through to the quoted-passage answer rather than failing
    }
    // the resident's own account first: a question about "my dues" must not be answered from a handbook page about dues
    // — but only when they ask about themselves; "where do visitors park?" is still a question for the handbook
    const own = self.direct(text);
    if (own && /\b(my|mine|i|me|our|we|mera|meri|mere|nanna)\b|मेरा|मेरी|ನನ್ನ/i.test(text)) return done(own);
    const hit = extractAnswer(text, library);
    if (hit) return done({ text: hit.text, source: hit.source });
    return done(own ?? { text: NOT_FOUND, source: null, chips: CHIPS, offer: 'ask_office' });
  });

  /**
   * The signed-in resident's own conversation, a page at a time, newest first. Whose history it is comes
   * only from the access token — there is no user id to pass. `nextCursor` asks for the page before this
   * one; `before` starts the first page earlier than a given moment.
   */
  const HistoryQuery = z.object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z_[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/).optional(),
    before: z.iso.datetime().optional(),
  });
  app.get('/assistant/history', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const r = await me(req);
    const q = parse(HistoryQuery, req.query);
    // the cursor carries the row's full timestamp (Postgres keeps microseconds; a JS date would round them away)
    const stamp = sql<string>`to_char(${chatMessages.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
    const [ts, id] = q.cursor?.split('_') ?? [];
    const rows = await db.select({ id: chatMessages.id, role: chatMessages.role, text: chatMessages.text, source: chatMessages.source, createdAt: chatMessages.createdAt, stamp })
      .from(chatMessages)
      .where(and(
        eq(chatMessages.userId, r.userId),
        q.cursor ? sql`(${chatMessages.createdAt}, ${chatMessages.id}) < (${ts}::timestamptz, ${id}::uuid)` : undefined,
        q.before ? sql`${chatMessages.createdAt} < ${q.before}::timestamptz` : undefined,
      ))
      .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id)).limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    reply.header('cache-control', 'no-store'); // private conversation: nothing in between may keep a copy
    return {
      items: page.map(({ stamp: _s, ...m }) => m),
      nextCursor: rows.length > q.limit && last ? `${last.stamp}_${last.id}` : null,
    };
  });
  /**
   * The app's guided issue-report conversation runs on the phone; its turns are sent here so the
   * stored history is the whole conversation. They are marked `flow`: never counted as questions asked,
   * and never shown to the model.
   */
  app.post('/assistant/history', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const r = await me(req);
    const { messages } = parse(z.object({ messages: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().trim().min(1).max(2000) })).min(1).max(10) }), req.body);
    if (await keepsHistory(r.userId)) {
      const now = Date.now();
      await db.insert(chatMessages).values(messages.map((m, n) => ({ userId: r.userId, role: m.role, text: m.text, flow: true, createdAt: new Date(now + n) })));
    }
    return reply.status(204).send();
  });
  app.delete('/assistant/history', async (req, reply) => {
    const r = await me(req);
    await db.delete(chatMessages).where(eq(chatMessages.userId, r.userId));
    return reply.status(204).send();
  });

  /** the composer's "say it in a … tone" — facts stay, heat goes */
  app.post('/assistant/rewrite', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async req => {
    const r = await me(req);
    const b = parse(z.object({ text: z.string().trim().min(3).max(4000), tone: z.enum(TONES) }), req.body);
    const cfg = await settings(r.associationId);
    if (!cfg.toneRewrite || cfg.tones[b.tone] === false) throw forbidden('This tone is switched off by your society admin.');
    quota.take('rewrite', r.userId);
    const text = (ai.enabled ? await ai.rewrite(b.text, b.tone) : null) ?? ruleRewrite(b.text, b.tone);
    return { text, tone: b.tone };
  });

  /* ---------- society admin: AI controls and the knowledge library ---------- */
  const Aid = z.object({ aid: z.uuid() });
  const staff = async (req: FastifyRequest, roles: StaffRole[] = ['admin', 'operator']) => {
    const { aid } = parse(Aid, req.params);
    return { aid, s: await staffOf(db, await userIdFrom(req, config.JWT_SECRET), aid, roles) };
  };

  app.get('/admin/:aid/ai-settings', async req => {
    const { aid } = await staff(req, ['admin', 'committee', 'moderator', 'operator']);
    return { ...(await settings(aid)), threshold: await thresholdOf(db, aid), aiConnected: ai.enabled };
  });
  app.put('/admin/:aid/ai-settings', async req => {
    const { aid, s } = await staff(req);
    const b = parse(z.object({ qna: z.boolean(), issueCreate: z.boolean(), toneRewrite: z.boolean(), summaries: z.boolean(), tones: z.partialRecord(z.enum(TONES), z.boolean()), autoHold: z.enum(AUTO_HOLD) }).partial(), req.body);
    const next = { ...(await settings(aid)), ...b, tones: { ...(await settings(aid)).tones, ...b.tones } };
    const { associationId: _a, ...set } = next;
    await db.insert(aiSettings).values({ associationId: aid, ...set }).onConflictDoUpdate({ target: aiSettings.associationId, set });
    await audit(db, aid, s.userId, s.name, 'AI controls updated · ' + Object.keys(b).join(', '));
    return next;
  });

  /**
   * The same timings and rules Trinize can note while onboarding, for the society's own admin to fill in or correct.
   * Each one is kept as a "Society facts" document, so the assistant answers from it and cites it.
   */
  const factsNow = async (aid: string) => {
    const docs = await db.select().from(knowledgeDocs).where(and(eq(knowledgeDocs.associationId, aid), eq(knowledgeDocs.title, FACTS_TITLE)));
    return FACTS.map(({ key, section, label, hint }) => ({ key, section, label, hint, value: factValue(key, docs.find(d => d.section === section)?.body ?? '') }));
  };
  app.get('/admin/:aid/facts', async req => { const { aid } = await staff(req, ['admin', 'committee', 'moderator', 'operator']); return factsNow(aid); });
  app.put('/admin/:aid/facts', async req => {
    const { aid, s } = await staff(req);
    const b = parse(z.object(Object.fromEntries(FACTS.map(f => [f.key, z.string().trim().max(f.key === 'other' ? 2000 : 300).optional()])) as Record<FactKey, z.ZodOptional<z.ZodString>>), req.body);
    // only the lines that were sent change: an emptied line is removed, a filled one replaces what was there
    const sent = FACTS.filter(f => b[f.key] !== undefined);
    await db.transaction(async tx => {
      for (const f of sent) await tx.delete(knowledgeDocs).where(and(eq(knowledgeDocs.associationId, aid), eq(knowledgeDocs.title, FACTS_TITLE), eq(knowledgeDocs.section, f.section)));
      const docs = factDocs(aid, b);
      if (docs.length) await tx.insert(knowledgeDocs).values(docs);
    });
    await audit(db, aid, s.userId, s.name, `society facts updated · ${sent.map(f => f.section).join(', ')}`);
    return factsNow(aid);
  });

  app.get('/admin/:aid/knowledge', async req => {
    const { aid } = await staff(req, ['admin', 'committee', 'moderator', 'operator']);
    return db.select().from(knowledgeDocs).where(eq(knowledgeDocs.associationId, aid)).orderBy(asc(knowledgeDocs.title));
  });
  app.post('/admin/:aid/knowledge', async (req, reply) => {
    const { aid, s } = await staff(req);
    const b = parse(z.object({ title: z.string().trim().min(3).max(120), section: z.string().trim().max(80).default(''), body: z.string().trim().min(20).max(20000) }), req.body);
    const [d] = await db.insert(knowledgeDocs).values({ associationId: aid, ...b }).returning();
    await audit(db, aid, s.userId, s.name, `knowledge document added · ${b.title}`);
    return reply.status(201).send(d);
  });
  app.delete('/admin/:aid/knowledge/:id', async (req, reply) => {
    const { aid, s } = await staff(req);
    const { id } = parse(Aid.extend({ id: z.uuid() }), req.params);
    const [d] = await db.delete(knowledgeDocs).where(and(eq(knowledgeDocs.id, id), eq(knowledgeDocs.associationId, aid))).returning();
    if (!d) throw notFound('Document');
    await audit(db, aid, s.userId, s.name, `knowledge document removed · ${d.title}`);
    return reply.status(204).send();
  });
};
