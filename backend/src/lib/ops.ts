import type { Plan, SubState } from '../db/schema.js';

/* The operator portal's business rules: what state an invoice is in, how an account is paying,
   and the health score that ranks the portfolio. */

export const PLAN_RANK: Record<Plan, number> = { Starter: 1, Professional: 2, Enterprise: 3 };

/** [name, what it does, category, the lowest plan that includes it] */
export const MODULES: { name: string; about: string; category: string; from: Plan }[] = [
  { name: 'Property Management', about: 'Blocks, plots and the unit register.', category: 'Core', from: 'Starter' },
  { name: 'Residents & Onboarding', about: 'Owner and tenant records, invitations.', category: 'Core', from: 'Starter' },
  { name: 'Maintenance Billing', about: 'Periodic charges, dues and receipts.', category: 'Finance', from: 'Starter' },
  { name: 'Notices & Announcements', about: 'Circulars, AGM notices and events.', category: 'Community', from: 'Starter' },
  { name: 'Service Associate Directory', about: 'Approved vendors the society can call.', category: 'Services', from: 'Starter' },
  { name: 'Accounting', about: 'Ledgers, vouchers and financial statements.', category: 'Finance', from: 'Professional' },
  { name: 'Rent Collection', about: 'Rent invoicing and arrears tracking.', category: 'Finance', from: 'Professional' },
  { name: 'Maintenance & Work Orders', about: 'Requests, assignment and completion.', category: 'Operations', from: 'Professional' },
  { name: 'Visitor Management', about: 'Gate passes, pre-approvals and logs.', category: 'Security', from: 'Professional' },
  { name: 'Delivery Management', about: 'Parcel intake and handover.', category: 'Security', from: 'Professional' },
  { name: 'Fixed Deposit Management', about: 'Corpus deposits, maturity tracking.', category: 'Finance', from: 'Professional' },
  { name: 'AI Inspections', about: 'Photo-based condition assessment.', category: 'Automation', from: 'Enterprise' },
  { name: 'AI Assistant', about: 'Natural-language answers over society data.', category: 'Automation', from: 'Enterprise' },
  { name: 'White Label & Branding', about: 'Society’s own logo, colours and domain.', category: 'Platform', from: 'Enterprise' },
  { name: 'Third-Party Integrations', about: 'Tally, payment gateways and webhooks.', category: 'Platform', from: 'Enterprise' },
  { name: 'Community Engagement', about: 'Resident app, discussions, events, polls, AI assistant.', category: 'Community', from: 'Enterprise' },
];

type Inv = { amount: number; paid: number; dueAt: Date };
export type InvoiceState = 'Paid' | 'Part paid' | 'Overdue' | 'Issued';
export function invoiceState(i: Inv, now = Date.now()): InvoiceState {
  if (i.paid >= i.amount) return 'Paid';
  if (i.paid > 0) return 'Part paid';
  return i.dueAt.getTime() < now ? 'Overdue' : 'Issued';
}

export type PayState = 'Paid' | 'Trial' | 'Part paid' | 'Past due';
/** how the account is paying overall — the worst of its open invoices */
export function payStateOf(state: SubState, invs: Inv[], now = Date.now()): PayState {
  if (state === 'Trial') return 'Trial';
  const late = invs.filter(i => i.paid < i.amount && i.dueAt.getTime() < now);
  if (late.some(i => i.paid === 0)) return 'Past due';
  if (late.length) return 'Part paid';
  return 'Paid';
}

export type Health = { score: number; band: 'Healthy' | 'Watch' | 'At risk' | 'Critical'; why: string };

/**
 * Renewal-risk score, 4–98. Adoption is the strongest signal, then payment behaviour, then the
 * three-month usage trend and whether support tickets are piling up.
 */
export function healthOf(a: { state: SubState; pay: PayState; adoption: number; usage: number[]; openTickets: number; recentTickets: number }): Health {
  if (a.state === 'Suspended') return { score: 12, band: 'Critical', why: 'Suspended for non-payment' };
  let s = 50;
  s += Math.round(a.adoption * 0.35);
  s += a.pay === 'Paid' ? 14 : a.pay === 'Trial' ? 0 : a.pay === 'Part paid' ? -8 : -22;
  const slope = a.usage.length >= 4 ? a.usage.at(-1)! - a.usage.at(-4)! : 0;
  s += slope > 2 ? 8 : slope < -2 ? -12 : 0;
  if (a.recentTickets >= 3) s -= 5;
  if (a.state === 'Pending') s -= 12;
  s = Math.max(4, Math.min(98, s));
  const band = s >= 75 ? 'Healthy' : s >= 52 ? 'Watch' : 'At risk';
  const why = a.state === 'Pending' ? 'Not verified · no owners onboarded yet'
    : a.pay === 'Past due' ? 'Payment overdue' + (slope < -2 ? ' and usage sliding' : '')
    : a.state === 'Trial' ? `Trial · onboarding at ${a.adoption}%`
    : slope < -2 ? 'Usage trending down'
    : a.adoption >= 85 ? 'High owner adoption · paying on time'
    : 'Paying · adoption still climbing';
  return { score: s, band, why };
}
