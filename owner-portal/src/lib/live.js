import { api } from './api';

/* Connected mode: reads the operator API (/v1/ops/*) and reshapes it into the records the pages
   already use (see data/portal.js), plus the calls behind each action. */

const DAY = 864e5;
const TINTS = [['#E6EEFB', '#1F5FB0'], ['#E2F4EA', '#05683F'], ['#EEF0FE', '#4F46E5'], ['#FCEFD9', '#A44207'], ['#F3E8FF', '#7C3AED'], ['#EFEEE9', '#54525E']];

const date = iso => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const rupees = n => '₹' + n.toLocaleString('en-IN');
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

export function ago(iso) {
  const ms = Date.now() - new Date(iso).getTime(), min = Math.round(ms / 60000);
  if (min < 1) return 'Just now';
  if (min < 60) return min + ' min ago';
  if (min < 24 * 60) return Math.round(min / 60) + 'h ago';
  const d = Math.round(ms / DAY);
  return d === 1 ? 'Yesterday' : d < 30 ? d + ' days ago' : date(iso);
}
const dueText = days => (days < 0 ? plural(-days, 'day') + ' ago' : days === 0 ? 'today' : 'in ' + plural(days, 'day'));

/** "Nov", "Nov 2026" for a "2026-11" key */
function monthLabels(key) {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return [d.toLocaleDateString('en-IN', { month: 'short' }), d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })];
}
/** the n months ending this month, as tooltip labels */
function lastMonths(n) {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => new Date(now.getFullYear(), now.getMonth() - (n - 1 - i), 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }));
}

function slaText(t) {
  if (t.status === 'Resolved') return 'Met';
  const h = Math.round((new Date(t.slaDueAt).getTime() - Date.now()) / 3600e3);
  return h < 0 ? -h + 'h over' : h + 'h left';
}

const initialsOf = name => name.split(' ').filter(w => /^[A-Za-z]/.test(w)).map(w => w[0]).slice(0, 2).join('').toUpperCase();

function assocOut(a, i, invoices, tickets) {
  const trial = a.state === 'Trial';
  const [c, tc] = TINTS[i % TINTS.length];
  const mine = invoices.filter(x => x.a === a.id), tix = tickets.filter(x => x.a === a.id);
  const tl = [
    ...(a.state === 'Suspended' ? [] : [[trial ? 'Trial ends ' + dueText(a.daysToRenewal) : 'Renewal ' + dueText(a.daysToRenewal), rupees(a.annual) + '/yr · ' + a.plan, date(a.renewsAt), a.daysToRenewal <= 30 ? 1 : 0]]),
    ...mine.map(v => [v.state === 'Issued' ? 'Invoice issued' : 'Invoice ' + v.state.toLowerCase(), v.id + ' · ' + rupees(v.amt) + ' outstanding', 'Due ' + v.due, v.days < 0 ? 1 : 0]),
    ...tix.filter(t => t.st !== 'Resolved').map(t => [t.t, t.id + ' · ' + t.st + ' · ' + t.pm, 'Raised ' + t.raised, t.slaState === 'over' ? 1 : 0]),
    ['Onboarded', plural(a.plots, 'plot') + ' · ' + a.plan, date(a.since), 0],
  ];
  const note = a.state === 'Suspended' ? 'Suspended for non-payment. This is a win-back conversation, not a renewal.'
    : a.state === 'Pending' ? 'Awaiting verification — nothing can start on this account until it is activated.'
    : `${a.health.why}. ${trial ? 'Trial ends' : 'Renews'} ${dueText(a.daysToRenewal)} · ${rupees(a.annual)}/yr.`;
  return {
    id: a.id, n: a.name, city: a.city, type: a.kind, plan: a.plan, bill: a.billing, state: a.state, pay: a.state === 'Suspended' ? 'Suspended' : a.pay, trial,
    billing: a.billing, plots: a.plots, owners: a.owners, adopt: a.adoption, annual: a.annual, renew: date(a.renewsAt), days: a.daysToRenewal, mrr: a.mrr, c, tc, ini: initialsOf(a.name),
    admin: a.contact.name || '—', role: a.contact.role, ph: a.contact.phone, em: a.contact.email, reg: a.registration || '—', since: date(a.since), addr: a.address || '—',
    credits: null, blocks: [], committee: [], usage: a.usage, usageMonths: lastMonths(a.usage.length), tickets: a.openTickets, ticketsPrev: 0, logins: 0,
    note, tl, h: a.health, detail: false, onApp: a.onApp, overdue: a.overdue, renewsAt: a.renewsAt,
  };
}

/** Everything the portal shows, in the shapes of data/portal.js. Callers that ask while a load is already under way share it. */
let inFlight = null;
export function loadPortal() {
  inFlight ??= fetchPortal().finally(() => { inFlight = null; });
  return inFlight;
}
async function fetchPortal() {
  // one request carries every screen's records (it used to take seven); property managers live in their own module
  const [boot, vpms] = await Promise.all([api('GET', '/v1/ops/bootstrap'), api('GET', '/v1/ops/vpms')]);
  const { summary, associations: assoc, invoices: inv, tickets: tix, activity, modules, plans } = boot;
  const invoices = inv.filter(i => i.state !== 'Paid').map(i => ({ id: i.number, uid: i.id, a: i.associationId, amt: i.balance, total: i.amount, due: dueText(i.daysToDue), state: i.state, days: i.daysToDue, chases: i.chases }));
  const issues = tix.map(t => ({
    id: t.ref, uid: t.id, cat: t.category, t: t.title, by: t.raisedBy, src: t.source, a: t.associationId, pri: t.priority, pm: t.assignee ?? 'Unassigned',
    raised: ago(t.createdAt), sla: slaText(t), slaState: t.slaState, st: t.status,
  }));
  const rank = { Starter: 1, Professional: 2, Enterprise: 3 };
  const series = summary.mrrSeries.map(m => ({ ...m, labels: monthLabels(m.month) }));
  return {
    assoc: assoc.map((a, i) => assocOut(a, i, invoices, issues)),
    invoices, issues, vpms, plans,
    feed: activity.map(f => ({ who: f.who, what: f.what, when: ago(f.at) })),
    modules: modules.map(m => [m.name, m.about, m.category, 1 >= rank[m.from] ? 1 : 0, 2 >= rank[m.from] ? 1 : 0, 1, m.adoption]),
    mrr: series.map(m => m.mrr), months: series.map(m => m.labels[0]), monthsFull: series.map(m => m.labels[1]),
    billed: summary.billed.map(b => { const [short, full] = monthLabels(b.month); return [short, b.invoiced, b.collected, full]; }),
  };
}

/** Blocks, committee and who is on the resident app — loaded when an account is opened. */
export async function assocDetail(id) {
  const d = await api('GET', '/v1/ops/associations/' + id);
  return {
    blocks: d.towers.map(t => [t.tower, t.units, null]),
    committee: d.committee.map(c => [c.name, c.role, c.phone]),
    homes: d.homes ?? [],
    onApp: d.onApp, detail: true,
  };
}

/** set up a society's plots on its behalf — the same route its own console uses */
export const addPlots = (id, units) => api('POST', `/v1/admin/${id}/units`, { units });

export const chaseInvoice =uid => api('POST', `/v1/ops/invoices/${uid}/chase`);
export const payInvoice = (uid, amount) => api('POST', `/v1/ops/invoices/${uid}/payment`, { amount });
export const issueInvoice = (associationId, amount, dueAt) => api('POST', '/v1/ops/invoices', { associationId, amount, dueAt });
export const assignTicket = (uid, assignee) => api('POST', `/v1/ops/tickets/${uid}/assign`, { assignee });
export const replyTicket = (uid, text, resolve) => api('POST', `/v1/ops/tickets/${uid}/reply`, { text, resolve });
export const ticketDetail = uid => api('GET', `/v1/ops/tickets/${uid}`);
export const setSubscription = (id, patch) => api('PUT', `/v1/ops/associations/${id}/subscription`, patch);
export const onboard = body => api('POST', '/v1/ops/associations', body);
/** the timings and rules the onboarding form can note for a society's assistant */
export const factFields = () => api('GET', '/v1/ops/facts');

/* plans, a society's details, and the people who run this portal */
export const savePlans = patch => api('PUT', '/v1/ops/plans', patch);
export const updateAssociation = (id, patch) => api('PUT', `/v1/ops/associations/${id}`, patch);
export const removeAssociation = (id, confirm) => api('DELETE', `/v1/ops/associations/${id}`, { confirm });
export const operators = () => api('GET', '/v1/ops/operators');
export const addOperator = o => api('POST', '/v1/ops/operators', o);
export const resetOperatorPassword = (id, password) => api('PUT', `/v1/ops/operators/${id}/password`, { password });
export const removeOperator = id => api('DELETE', `/v1/ops/operators/${id}`);
export const changePassword = (current, next) => api('POST', '/v1/auth/staff/password', { current, next });

export const createVpm = v => api('POST', '/v1/ops/vpms', v);
export const setVpmSocieties = (id, associationIds) => api('PUT', `/v1/ops/vpms/${id}/societies`, { associationIds });
export const removeVpm = id => api('DELETE', `/v1/ops/vpms/${id}`);
