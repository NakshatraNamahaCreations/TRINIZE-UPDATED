import { sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import type { StaffRole } from '../db/schema.js';
import { rupees, unitBalances } from './finance.js';
import { balances, chartOf, monthName, today } from './ledger.js';
import { prevPeriod } from './reports.js';

/* The staff assistant's reading side. A question is matched to one or more "tools" — fixed, tested
   queries over the society's own records. A tool belongs to a domain, and a role may only use the
   domains it is allowed: that is the whole permission model, and no model can talk its way past it,
   because data a role may not see is never fetched in the first place. */

export type Domain = 'finance' | 'maintenance' | 'residents' | 'gate' | 'community';
const ALL: Domain[] = ['finance', 'maintenance', 'residents', 'gate', 'community'];
export const SCOPE: Record<StaffRole, Domain[]> = { operator: ALL, admin: ALL, vpm: ALL, committee: ALL, auditor: ['finance'], guard: ['gate'], moderator: ['community'] };
export const DOMAIN_WORDS: Record<Domain, string> = { finance: 'money and accounts', maintenance: 'maintenance and vendors', residents: 'residents and flats', gate: 'visitors and the gate', community: 'notices, events and polls' };

export type Card = { key: string; title: string; headline: string; columns: string[]; rows: string[][]; link: string | null; data: string };
type Ctx = { db: Pick<DB, 'select' | 'execute' | 'insert'>; aid: string; q: string; period: string };
type Tool = { key: string; domain: Domain; data: string; about: string; match: RegExp; run(c: Ctx): Promise<Card> };

const rows = async <T>(db: Ctx['db'], q: ReturnType<typeof sql>) => ((await db.execute(q)) as unknown as { rows: T[] }).rows;
const lastDay = (period: string) => new Date(Date.UTC(Number(period.slice(0, 4)), Number(period.slice(5, 7)), 0)).toISOString().slice(0, 10);
const dm = (d: Date | string) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
const hm = (d: Date | string) => new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' });
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
/** the month a question is about: "June collection", "last month", otherwise this month */
export function periodIn(q: string, now = today()): string {
  const t = q.toLowerCase(), cur = now.slice(0, 7);
  if (/\blast month\b/.test(t)) return prevPeriod(cur);
  const m = MONTHS.findIndex(name => new RegExp(`\\b${name}\\b|\\b${name.slice(0, 3)}\\b`).test(t) && !(name === 'may' && !/\bin may\b|\bmay (collection|report|expense|month)|\bfor may\b/.test(t)));
  if (m < 0) return cur;
  const year = Number(cur.slice(0, 4)) - (m + 1 > Number(cur.slice(5, 7)) ? 1 : 0); // the most recent such month
  return `${year}-${String(m + 1).padStart(2, '0')}`;
}

const TOOLS: Tool[] = [
  /* ---------- money ---------- */
  {
    key: 'collected', domain: 'finance', data: 'payments', about: 'what was collected in a month', match: /\b(collect\w*|received|payments? (received|this|in))\b/,
    async run({ db, aid, period }) {
      const r = await rows<{ mode: string; n: number; amount: number }>(db, sql`
        select mode, count(*)::int n, coalesce(sum(amount), 0)::int amount from payments
        where association_id = ${aid} and reversed_at is null and received_on >= ${period + '-01'}::date and received_on <= ${lastDay(period)}::date group by mode order by amount desc`);
      const total = r.reduce((n, x) => n + x.amount, 0);
      return { key: 'collected', title: `Collected in ${monthName(period)}`, headline: `${rupees(total)} collected in ${monthName(period)} from ${plural(r.reduce((n, x) => n + x.n, 0), 'payment')}.`,
        columns: ['Mode', 'Payments', 'Amount'], rows: r.map(x => [x.mode, String(x.n), rupees(x.amount)]), link: '/accounts', data: 'payments' };
    },
  },
  {
    key: 'dues', domain: 'finance', data: 'dues', about: 'who owes money', match: /\b(dues?|outstanding|unpaid|owes?|defaulters?|not paid|hasn.?t paid|haven.?t paid|pending (payment|maintenance|resident)s?)\b/,
    async run({ db, aid }) {
      const due = [...(await unitBalances(db as DB, aid)).entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
      const info = due.length ? await rows<{ id: string; code: string; name: string | null }>(db, sql`
        select u.id, u.code, (select us.name from unit_members m join users us on us.id = m.user_id where m.unit_id = u.id and m.status = 'active' order by (m.role = 'Owner') desc limit 1) as name
        from units u where u.association_id = ${aid}`) : [];
      const total = due.reduce((n, [, x]) => n + x, 0);
      return { key: 'dues', title: 'Pending dues', headline: due.length ? `${rupees(total)} is owed by ${plural(due.length, 'flat')}.` : 'No flat owes anything right now.',
        columns: ['Flat', 'Resident', 'Owes'], rows: due.slice(0, 15).map(([id, n]) => { const u = info.find(x => x.id === id); return [u?.code ?? '—', u?.name ?? '—', rupees(n)]; }), link: '/accounts', data: 'dues' };
    },
  },
  {
    key: 'payables', domain: 'finance', data: 'vendor bills', about: 'vendor bills waiting to be paid', match: /\b(vendor payments?|payables?|(outstanding|unpaid|pending) vendor|to pay|bills? to pay)\b/,
    async run({ db, aid }) {
      const r = await rows<{ payee: string; n: number; amount: number }>(db, sql`select payee, count(*)::int n, sum(amount)::int amount from expenses where association_id = ${aid} and status = 'Approved' group by payee order by amount desc`);
      const total = r.reduce((n, x) => n + x.amount, 0);
      return { key: 'payables', title: 'Vendor payments outstanding', headline: r.length ? `${rupees(total)} is approved and waiting to be paid to ${plural(r.length, 'payee')}.` : 'No approved vendor bill is waiting to be paid.',
        columns: ['Payee', 'Bills', 'Amount'], rows: r.map(x => [x.payee, String(x.n), rupees(x.amount)]), link: '/accounts', data: 'vendor bills' };
    },
  },
  {
    key: 'expenses', domain: 'finance', data: 'expenses', about: 'what was spent, by head', match: /\b(expenses?|spent|spending|costs?)\b/,
    async run({ db, aid, period }) {
      await chartOf(db as DB, aid);
      const e = (await balances(db as DB, aid, { from: period + '-01', to: lastDay(period) })).filter(a => a.kind === 'expense' && a.balance).sort((a, b) => b.balance - a.balance);
      const total = e.reduce((n, x) => n + x.balance, 0);
      return { key: 'expenses', title: `Expenses in ${monthName(period)}`, headline: e.length ? `${rupees(total)} spent in ${monthName(period)}; the largest head is ${e[0]!.name} at ${rupees(e[0]!.balance)}.` : `No expenses are recorded for ${monthName(period)}.`,
        columns: ['Head', 'Amount'], rows: e.map(x => [x.name, rupees(x.balance)]), link: '/accounts', data: 'expenses' };
    },
  },
  {
    key: 'net', domain: 'finance', data: 'income and expenses', about: 'income against expenses', match: /\b(profit|surplus|net|income|financial summary|how are we doing)\b/,
    async run({ db, aid, period }) {
      await chartOf(db as DB, aid);
      const b = await balances(db as DB, aid, { from: period + '-01', to: lastDay(period) });
      const inc = b.filter(a => a.kind === 'income').reduce((n, a) => n + a.balance, 0), exp = b.filter(a => a.kind === 'expense').reduce((n, a) => n + a.balance, 0);
      return { key: 'net', title: `Income and expenses, ${monthName(period)}`, headline: `${monthName(period)}: income ${rupees(inc)}, expenses ${rupees(exp)}, net ${rupees(inc - exp)}.`,
        columns: ['', 'Amount'], rows: [['Income', rupees(inc)], ['Expenses', rupees(exp)], ['Net', rupees(inc - exp)]], link: '/accounts', data: 'income and expenses' };
    },
  },
  {
    key: 'payouts', domain: 'finance', data: 'rent held for owners', about: 'rent held for flat owners', match: /\b(payouts?|held for (the )?owners?|owner (income|money|funds))\b/,
    async run({ db, aid }) {
      await chartOf(db as DB, aid);
      const held = (await balances(db as DB, aid, {})).find(a => a.role === 'owner_funds')?.balance ?? 0;
      return { key: 'payouts', title: 'Rent held for owners', headline: held > 0 ? `${rupees(held)} of collected rent is held for flat owners and can be paid out.` : 'No rent is being held for owners right now.',
        columns: [], rows: [], link: '/owners', data: 'rent held for owners' };
    },
  },
  /* ---------- maintenance ---------- */
  {
    key: 'emergencies', domain: 'maintenance', data: 'work orders', about: 'open emergency complaints', match: /\bemergenc\w*\b/,
    async run(c) { return issueList(c, sql`i.priority = 'Emergency' and i.status not in ('Resolved','Closed')`, 'emergencies', 'Open emergency complaints', n => (n ? `${plural(n, 'emergency complaint')} open.` : 'No emergency complaint is open.')); },
  },
  {
    key: 'overdue', domain: 'maintenance', data: 'work orders', about: 'work orders past their response time', match: /\b(overdue|late|delayed|past (the )?(sla|response))\b.*\b(work|order|complaint|request|ticket|maintenance|repair)|\b(work orders?|complaints?|requests?|tickets?|repairs?)\b.*\b(overdue|late|delayed)\b/,
    async run(c) { return issueList(c, sql`i.status not in ('Resolved','Closed','On Hold') and i.sla_due_at < now()`, 'overdue', 'Overdue work orders', n => (n ? `${plural(n, 'work order')} past the response time.` : 'Nothing is past its response time.')); },
  },
  {
    key: 'vendor_load', domain: 'maintenance', data: 'vendors', about: 'how busy each vendor is', match: /\b(vendors?|contractors?)\b.*\b(overloaded|busy|busiest|workload|load|performance|jobs)\b|\b(overloaded|busiest)\b/,
    async run({ db, aid }) {
      const r = await rows<{ name: string; category: string; open: number; done: number; rating: number | null }>(db, sql`
        select v.name, v.category, count(i.id) filter (where i.status not in ('Resolved','Closed'))::int open, count(i.id) filter (where i.status in ('Resolved','Closed'))::int done, round(avg(i.rating), 1)::float rating
        from vendors v left join issues i on i.vendor_id = v.id where v.association_id = ${aid} and v.active group by v.id order by open desc, v.name`);
      const top = r[0];
      return { key: 'vendor_load', title: 'Vendor workload', headline: top && top.open > 0 ? `${top.name} has the most open work: ${plural(top.open, 'job')}.` : 'No vendor has open work right now.',
        columns: ['Vendor', 'Trade', 'Open', 'Completed', 'Rating'], rows: r.map(x => [x.name, x.category, String(x.open), String(x.done), x.rating ? String(x.rating) : '—']), link: '/maintenance', data: 'vendors' };
    },
  },
  {
    key: 'pending', domain: 'maintenance', data: 'work orders', about: 'open complaints and work orders', match: /\b(pending|open|unresolved|active)\b.*\b(maintenance|complaints?|requests?|work orders?|tickets?|issues?|repairs?)\b|\b(maintenance|complaints?|requests?|work orders?|tickets?|repairs?)\b.*\b(pending|open|unresolved|summary|status)\b/,
    async run(c) { return issueList(c, sql`i.status not in ('Resolved','Closed')`, 'pending', 'Open maintenance requests', n => (n ? `${plural(n, 'request')} open.` : 'No maintenance request is open.')); },
  },
  /* ---------- residents ---------- */
  {
    key: 'repeat', domain: 'residents', data: 'complaints by resident', about: 'residents with several complaints', match: /\b(more than|over|most|many|repeat\w*)\b.*\bcomplaints?\b/,
    async run({ db, aid, q }) {
      const min = Number(/\b(?:more than|over)\s+(\d+)/.exec(q.toLowerCase())?.[1] ?? (/\bmore than two\b/i.test(q) ? 2 : /\bmore than three\b/i.test(q) ? 3 : 2));
      const r = await rows<{ name: string; code: string | null; n: number }>(db, sql`
        select us.name, (select u.code from unit_members m join units u on u.id = m.unit_id where m.user_id = us.id and u.association_id = ${aid} limit 1) as code, count(*)::int n
        from issues i join users us on us.id = i.reporter_id where i.association_id = ${aid} group by us.id having count(*) > ${min} order by n desc limit 15`);
      return { key: 'repeat', title: `Residents with more than ${min} complaints`, headline: r.length ? `${plural(r.length, 'resident')} raised more than ${min} complaints.` : `No resident has raised more than ${min} complaints.`,
        columns: ['Resident', 'Flat', 'Complaints'], rows: r.map(x => [x.name, x.code ?? '—', String(x.n)]), link: '/issues', data: 'complaints by resident' };
    },
  },
  {
    key: 'leases', domain: 'residents', data: 'leases', about: 'leases ending soon', match: /\blease\w*\b/,
    async run({ db, aid }) {
      const r = await rows<{ code: string; lease_end: string; rent: number }>(db, sql`
        select code, to_char(lease_end, 'YYYY-MM-DD') as lease_end, monthly_rent as rent from units where association_id = ${aid} and lease_end is not null and lease_end <= (${today()}::date + 90) order by lease_end`);
      return { key: 'leases', title: 'Leases ending within 90 days', headline: r.length ? `${plural(r.length, 'lease')} ${r.length === 1 ? 'ends' : 'end'} within 90 days; the first is ${r[0]!.code} on ${dm(r[0]!.lease_end)}.` : 'No lease ends within 90 days.',
        columns: ['Flat', 'Lease ends', 'Monthly rent'], rows: r.map(x => [x.code, dm(x.lease_end), rupees(x.rent)]), link: '/owners', data: 'leases' };
    },
  },
  {
    key: 'find', domain: 'residents', data: 'flats and residents', about: 'finding a flat or a resident', match: /\b(find|search|look ?up|who lives|who is in|open)\b.*\b(flat|unit|resident|tenant|owner|[a-z]?\d?-?\d{3,4})\b|\bflat\s+[a-z]?\d?-?\d{3,4}\b/,
    async run({ db, aid, q }) {
      const term = (/\b([a-z]\d-?\d{3,4}|\d{3,4})\b/i.exec(q)?.[1] ?? q.replace(/\b(find|search|look ?up|who lives|who is in|open|show|the|flat|unit|resident|tenant|owner|in|for|me|please)\b/gi, ' ').trim()).replace(/\s+/g, ' ');
      const like = '%' + term.replace(/[%_]/g, '') + '%';
      const r = term ? await rows<{ code: string; label: string; occupancy: string; people: string | null }>(db, sql`
        select u.code, u.label, u.occupancy, (select string_agg(us.name || ' (' || m.role || ')', ', ') from unit_members m join users us on us.id = m.user_id where m.unit_id = u.id and m.status = 'active') as people
        from units u where u.association_id = ${aid} and (u.code ilike ${like} or replace(u.code, '-', '') ilike ${like} or u.label ilike ${like}
          or exists (select 1 from unit_members m join users us on us.id = m.user_id where m.unit_id = u.id and us.name ilike ${like})) order by u.code limit 10`) : [];
      return { key: 'find', title: `Flats and residents matching “${term}”`, headline: r.length === 1 ? `${r[0]!.label}: ${r[0]!.people ?? 'nobody on the app yet'} · ${r[0]!.occupancy}.` : r.length ? `${plural(r.length, 'flat')} match “${term}”.` : `Nothing matches “${term}”.`,
        columns: ['Flat', 'Who', 'Occupancy'], rows: r.map(x => [x.code, x.people ?? '—', x.occupancy]), link: '/users', data: 'flats and residents' };
    },
  },
  {
    key: 'find_vendor', domain: 'maintenance', data: 'vendors', about: 'finding a vendor', match: /\b(find|search|look ?up|open|show|list)\b.*\b(vendors?|plumbers?|electricians?|contractors?)\b/,
    async run({ db, aid, q }) {
      const term = q.replace(/\b(find|search|look ?up|open|show|list|the|a|an|vendors?|contractors?|for|me|please|all)\b/gi, ' ').trim().replace(/\s+/g, ' ').replace(/(plumb|electric)\w*/i, '$1');
      const like = '%' + term.replace(/[%_]/g, '') + '%';
      const r = await rows<{ name: string; category: string; phone: string; open: number }>(db, sql`
        select v.name, v.category, v.phone, (select count(*)::int from issues i where i.vendor_id = v.id and i.status not in ('Resolved','Closed')) as open
        from vendors v where v.association_id = ${aid} and v.active and (${term} = '' or v.name ilike ${like} or v.category ilike ${like}) order by v.name limit 15`);
      return { key: 'find_vendor', title: term ? `Vendors matching “${term}”` : 'Vendors', headline: r.length ? `${plural(r.length, 'vendor')}${term ? ` match “${term}”` : ' on file'}.` : `No vendor matches “${term}”.`,
        columns: ['Vendor', 'Trade', 'Phone', 'Open jobs'], rows: r.map(x => [x.name, x.category, x.phone || '—', String(x.open)]), link: '/maintenance', data: 'vendors' };
    },
  },
  /* ---------- the gate ---------- */
  {
    key: 'vehicles', domain: 'gate', data: 'gate log', about: 'vehicles inside now', match: /\bvehicles?\b|\bcars?\b.*\binside\b/,
    async run({ db, aid }) {
      const r = await rows<{ vehicle: string; name: string; code: string | null; entered_at: string }>(db, sql`
        select v.vehicle, v.name, u.code, v.entered_at from visits v left join units u on u.id = v.unit_id
        where v.association_id = ${aid} and v.status = 'Inside' and v.vehicle is not null and v.vehicle <> '' order by v.entered_at desc`);
      return { key: 'vehicles', title: 'Visitor vehicles inside now', headline: r.length ? `${plural(r.length, 'visitor vehicle')} inside right now.` : 'No visitor vehicle is inside right now.',
        columns: ['Vehicle', 'Visitor', 'Flat', 'Entered'], rows: r.map(x => [x.vehicle, x.name, x.code ?? '—', hm(x.entered_at)]), link: '/gate', data: 'gate log' };
    },
  },
  {
    key: 'staff_today', domain: 'gate', data: 'gate log', about: 'domestic staff who came in today', match: /\b(staff|attendance|maids?|helpers?|housekeeping)\b/,
    async run(c) { return visitList(c, sql`v.visitor_type = 'Staff'`, 'staff_today', 'Staff who came in today', n => (n ? `${plural(n, 'staff entry', 'staff entries')} recorded at the gate today.` : 'No staff entry has been recorded today.')); },
  },
  {
    key: 'visitors', domain: 'gate', data: 'gate log', about: 'visitors today', match: /\b(visitors?|guests?|entr(y|ies)|entered|deliver\w*|parcels?|gate)\b/,
    async run(c) { return visitList(c, sql`true`, 'visitors', 'Gate entries today', n => (n ? `${plural(n, 'entry', 'entries')} at the gate today.` : 'Nothing has been recorded at the gate today.')); },
  },
  /* ---------- community ---------- */
  {
    key: 'polls', domain: 'community', data: 'polls', about: 'poll results', match: /\b(polls?|votes?|voting)\b/,
    async run({ db, aid }) {
      const r = await rows<{ question: string; closed: boolean; label: string; votes: number }>(db, sql`
        select p.question, (p.closed_at is not null or p.closes_at < now()) as closed, o.label,
          (o.base_votes + (select count(*) from votes v where v.option_id = o.id))::int as votes
        from polls p join poll_options o on o.poll_id = p.id where p.association_id = ${aid} order by p.closes_at desc, o.position`);
      const qs = [...new Set(r.map(x => x.question))];
      const lead = (q: string) => r.filter(x => x.question === q).sort((a, b) => b.votes - a.votes)[0]!;
      return { key: 'polls', title: 'Poll results', headline: qs.length ? `${plural(qs.length, 'poll')}. “${qs[0]}” — leading: ${lead(qs[0]!).label} (${plural(lead(qs[0]!).votes, 'vote')}).` : 'There are no polls.',
        columns: ['Poll', 'Option', 'Votes', 'State'], rows: r.map(x => [x.question, x.label, String(x.votes), x.closed ? 'Closed' : 'Open']), link: '/events-polls', data: 'polls' };
    },
  },
  {
    key: 'events', domain: 'community', data: 'events', about: 'events, meetings and who is coming', match: /\b(agm|meetings?|events?|attendance|rsvps?)\b/,
    async run({ db, aid, q }) {
      const r = await rows<{ title: string; starts_at: string; capacity: number; going: number }>(db, sql`
        select e.title, e.starts_at, e.capacity, (e.base_going + (select count(*) from rsvps r where r.event_id = e.id and r.status = 'Going'))::int as going
        from events e where e.association_id = ${aid} and e.starts_at >= now() - interval '30 days' order by e.starts_at`);
      const agm = /\bagm\b/i.test(q) ? r.find(x => /annual general|agm/i.test(x.title)) : undefined;
      return { key: 'events', title: 'Events and attendance', headline: agm ? `${agm.title} on ${dm(agm.starts_at)}: ${agm.going} of ${agm.capacity} have said they are coming.` : r.length ? `${plural(r.length, 'event')} in the last 30 days and ahead.` : 'No events in the last 30 days or ahead.',
        columns: ['Event', 'When', 'Coming', 'Capacity'], rows: r.map(x => [x.title, `${dm(x.starts_at)}, ${hm(x.starts_at)}`, String(x.going), String(x.capacity)]), link: '/events-polls', data: 'events' };
    },
  },
  {
    key: 'notices', domain: 'community', data: 'notices', about: 'recent notices', match: /\b(notices?|announcements?|circulars?)\b/,
    async run({ db, aid }) {
      const r = await rows<{ ref: string; title: string; published_at: string; acks: number }>(db, sql`
        select a.ref, a.title, a.published_at, (select count(*)::int from announcement_acks k where k.announcement_id = a.id) as acks
        from announcements a where a.association_id = ${aid} order by a.published_at desc limit 8`);
      return { key: 'notices', title: 'Recent notices', headline: r.length ? `The latest notice is “${r[0]!.title}” (${r[0]!.ref}), posted ${dm(r[0]!.published_at)}.` : 'No notices have been posted.',
        columns: ['Notice', 'Title', 'Posted', 'Acknowledged'], rows: r.map(x => [x.ref, x.title, dm(x.published_at), String(x.acks)]), link: '/announcements', data: 'notices' };
    },
  },
];

async function issueList({ db, aid }: Ctx, where: ReturnType<typeof sql>, key: string, title: string, say: (n: number) => string): Promise<Card> {
  const r = await rows<{ number: number; title: string; priority: string; status: string; place: string; vendor: string | null; over: boolean }>(db, sql`
    select i.number, i.title, i.priority, i.status, coalesce(u.code, 'Common · ' || coalesce(i.asset, 'area')) as place, v.name as vendor, (i.sla_due_at < now()) as over
    from issues i left join units u on u.id = i.unit_id left join vendors v on v.id = i.vendor_id
    where i.association_id = ${aid} and ${where}
    order by (i.priority = 'Emergency') desc, i.sla_due_at limit 20`);
  return { key, title, headline: say(r.length), columns: ['Ref', 'What', 'Where', 'Priority', 'Status', 'Vendor'],
    rows: r.map(x => ['ISS-' + x.number, x.title, x.place, x.priority, x.status + (x.over && !['Resolved', 'Closed'].includes(x.status) ? ' · overdue' : ''), x.vendor ?? '—']), link: '/issues', data: 'work orders' };
}
async function visitList({ db, aid }: Ctx, where: ReturnType<typeof sql>, key: string, title: string, say: (n: number) => string): Promise<Card> {
  const r = await rows<{ name: string; visitor_type: string; code: string | null; status: string; at: string }>(db, sql`
    select v.name, v.visitor_type, u.code, v.status, coalesce(v.entered_at, v.created_at) as at from visits v left join units u on u.id = v.unit_id
    where v.association_id = ${aid} and ${where} and (coalesce(v.entered_at, v.created_at) at time zone 'Asia/Kolkata')::date = ${today()}::date
    order by at desc limit 25`);
  return { key, title, headline: say(r.length), columns: ['Who', 'Type', 'Flat', 'Status', 'Time'], rows: r.map(x => [x.name, x.visitor_type, x.code ?? '—', x.status, hm(x.at)]), link: '/gate', data: 'gate log' };
}

export const toolKeys = (role: StaffRole) => TOOLS.filter(t => SCOPE[role].includes(t.domain)).map(t => ({ key: t.key, about: t.about }));

/**
 * Which tools a question calls for. `allowed` are the ones this role may use; `denied` are domains the
 * question reached for but the role may not see — the caller answers those with a refusal, not with data.
 */
export function route(q: string, role: StaffRole) {
  const t = q.toLowerCase();
  const hit = TOOLS.filter(x => x.match.test(t));
  // the specific beats the general: an emergency or overdue question is not also "all pending"; a staff question is not "all visitors"
  const drop = new Set<string>();
  if (hit.some(x => x.key === 'emergencies' || x.key === 'overdue')) drop.add('pending');
  if (hit.some(x => x.key === 'staff_today' || x.key === 'vehicles')) drop.add('visitors');
  if (hit.some(x => x.key === 'payables')) { drop.add('expenses'); drop.add('dues'); }
  if (hit.some(x => x.key === 'find_vendor')) { drop.add('find'); drop.add('vendor_load'); }
  if (hit.some(x => x.key === 'net')) drop.add('expenses');
  if (hit.some(x => x.key === 'repeat')) { drop.add('pending'); }
  const want = hit.filter(x => !drop.has(x.key));
  return { allowed: want.filter(x => SCOPE[role].includes(x.domain)).slice(0, 3), denied: [...new Set(want.filter(x => !SCOPE[role].includes(x.domain)).map(x => x.domain))] };
}
export const toolsByKey = (keys: string[], role: StaffRole) => TOOLS.filter(t => keys.includes(t.key) && SCOPE[role].includes(t.domain)).slice(0, 3);

export async function runTools(db: Ctx['db'], aid: string, q: string, tools: Tool[]): Promise<Card[]> {
  const period = periodIn(q);
  return Promise.all(tools.map(t => t.run({ db, aid, q, period })));
}

/* ---------- drafting ---------- */
export const DRAFT_KINDS = ['Payment reminder', 'Maintenance notice', 'Water shutdown notice', 'Festival greetings', 'Meeting invitation', 'Vendor follow-up', 'Complaint response', 'Resident reply', 'Owner monthly summary'] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

/** does the detail already say when? then the wording must not ask for a date again */
const WHEN = /\b\d{1,2}\s?(am|pm)\b|\b\d{1,2}[:.]\d{2}\b|\b(today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

/** the built-in wording for each kind; `[square brackets]` mark what the office must fill in */
export function ruleDraft(kind: DraftKind, details: string, society: string): { title: string; body: string } {
  const d = details.trim().replace(/\s+/g, ' ');
  const about = d ? d.replace(/[.]*$/, '') : '';
  switch (kind) {
    case 'Payment reminder': return { title: 'Maintenance payment reminder', body: `Dear resident, this is a gentle reminder that the maintenance payment${about ? ' for ' + about : ' for [period]'} is due. Please pay from the app before the due date to avoid a late fee. If you have already paid, please ignore this message. — ${society}` };
    case 'Maintenance notice': return { title: 'Maintenance work notice', body: `Dear residents, maintenance work${about ? ' on ' + about : ' on [what]'} will be carried out on [date] between [start time] and [end time]. There may be some disturbance during this time. Thank you for your patience. — ${society}` };
    case 'Water shutdown notice': return { title: 'Water supply interruption', body: `Dear residents, water supply will be paused${!about ? ' on [date] from [start time] to [end time]' : WHEN.test(about) ? ' ' + about.replace(/^(?!on |from |in |at |for |tomorrow|today)/i, 'in ') : ` in ${about} on [date] from [start time] to [end time]`}. Please store enough water in advance. We are sorry for the inconvenience. — ${society}` };
    case 'Festival greetings': return { title: `Warm wishes${about ? ' for ' + about : ''}`, body: `Wishing you and your family a very happy ${about || '[festival]'}. May it bring joy, health and togetherness to every home. — ${society}` };
    case 'Meeting invitation': return { title: 'Meeting invitation', body: `Dear members, you are invited to a meeting${about ? ' on ' + about : ''} on [date] at [time] in [venue]. Agenda: [agenda]. Your presence is requested. — ${society}` };
    case 'Vendor follow-up': return { title: 'Follow-up on pending work', body: `Hello, this is a follow-up from ${society}${about ? ' about ' + about : ' about [work order]'}. The work is still pending. Please share the status and when it will be completed.` };
    case 'Complaint response': return { title: 'About your complaint', body: `Dear resident, thank you for telling us${about ? ' about ' + about : ''}. We are sorry for the trouble. The matter has been taken up and we will update you on [date]. — ${society}` };
    case 'Resident reply': return { title: 'Reply from the society office', body: `Dear resident, thank you for your message${about ? ' about ' + about : ''}. [Your answer]. Please write back if you need anything else. — ${society}` };
    case 'Owner monthly summary': return { title: 'Your monthly summary', body: `Dear owner, here is the summary for ${about || '[month]'}: rent collected [amount], repairs [amount], net [amount]. The full statement is in the Owner portal in the app. — ${society}` };
  }
}
