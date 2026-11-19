/* Connected mode: everything the demo says in hand-written copy — the decisions on the command centre,
   the chase plan, the copilot's answers — worked out from the records the server returned.
   Rules, not a language model: every sentence can be traced to a number on the page. */
import { ASSOC, fmtI, fmtL, health, INVOICES, ISSUES, num, OPERATOR } from './portal';

const days = n => Math.abs(n) + (Math.abs(n) === 1 ? ' day' : ' days');
const live = () => ASSOC.filter(a => a.state !== 'Suspended');
const arrOf = () => ASSOC.filter(a => a.state === 'Active').reduce((s, a) => s + a.annual, 0);
const overdueOf = a => INVOICES.filter(i => i.a === a.id && i.days < 0);
const sum = (list, f) => list.reduce((s, x) => s + f(x), 0);
const contact = a => [a.admin, a.em].filter(Boolean).join(' · ');

/** share of annual revenue sitting in the biggest paying account */
export function concentration() {
  const arr = arrOf(), top = ASSOC.filter(a => a.state === 'Active').sort((p, q) => q.annual - p.annual)[0];
  return top && arr ? { a: top, pct: Math.round(top.annual / arr * 100) } : null;
}

/** What needs the operator, most urgent first. Each card's primary button does something real. */
export function attention(p) {
  const cards = [];
  for (const a of ASSOC) {
    const late = overdueOf(a);
    if (a.state === 'Pending') cards.push({
      id: 'verify-' + a.id, rank: 0, money: a.annual, kind: 'warn', ic: 'identification_card', t: 'Awaiting verification', head: a.n + ' — nothing can start',
      sub: `${num(a.plots)} plots cannot be onboarded until the account is verified and activated. ${fmtI(a.annual)}/yr is waiting on it.`,
      primary: ['Verify & activate', () => p.updateSubscription(a.id, { state: 'Active' }, 'Account activated')], secondary: ['Open account', () => p.go('a360', a.id)],
    });
    else if (a.state === 'Trial' && a.days <= 30) cards.push({
      id: 'trial-' + a.id, rank: a.days <= 7 ? 0 : 1, money: a.annual, kind: a.adopt < 40 ? 'bad' : 'warn', ic: 'hourglass_not_done',
      t: a.days < 0 ? 'Trial ended ' + days(a.days) + ' ago' : 'Trial ends in ' + days(a.days), head: `${a.n} — ${a.adopt}% of owners onboarded`,
      sub: `${fmtI(a.annual)}/yr at stake. ${a.adopt < 40 ? 'Low onboarding is the best predictor of a trial that will not convert — help them get owners signed in before it closes.' : 'Onboarding is moving; agree the plan before the trial closes.'}`,
      primary: ['Open account', () => p.go('a360', a.id)], secondary: ['See renewals', () => p.go('renewals')],
    });
    if (late.length && a.state !== 'Suspended') cards.push({
      id: 'dues-' + a.id, rank: 1, money: sum(late, i => i.amt), kind: 'bad', ic: 'money_with_wings', t: 'Past due · oldest ' + days(Math.min(...late.map(i => i.days))) + ' late',
      head: `${a.n} — ${fmtI(sum(late, i => i.amt))} across ${late.length} invoice${late.length === 1 ? '' : 's'}`,
      sub: health(a).why + '. ' + (a.adopt < 70 ? 'Adoption is low too, so a bare reminder may only buy a month.' : 'Otherwise a sound account — usually a paperwork delay rather than a refusal.'),
      primary: ['Log a reminder', () => p.chase(late.sort((x, y) => x.days - y.days)[0].id)], secondary: ['Open collections', () => p.go('collections')],
    });
    if (a.state === 'Active' && a.days <= 30) {
      const share = arrOf() ? Math.round(a.annual / arrOf() * 100) : 0;
      cards.push({
        id: 'renew-' + a.id, rank: a.days < 0 ? 0 : 2, money: a.annual, kind: a.days < 0 ? 'bad' : 'warn', ic: 'money_bag',
        t: (a.days < 0 ? 'Renewal ' + days(a.days) + ' overdue' : 'Renewal in ' + days(a.days)) + (share >= 25 ? ` · ${share}% of ARR` : ''), head: `${a.n} — ${fmtL(a.annual)}/yr`,
        sub: `${health(a).band} account (adoption ${a.adopt}%, ${a.pay.toLowerCase()}). ${health(a).band === 'Healthy' ? 'A healthy renewal is the moment to talk about the next plan up.' : 'Fix what is dragging the score before the renewal conversation.'}`,
        primary: ['Open account', () => p.go('a360', a.id)], secondary: ['See renewals', () => p.go('renewals')],
      });
    }
  }
  return cards.sort((x, y) => x.rank - y.rank || y.money - x.money).slice(0, 4);
}

/** two plain paragraphs for the command centre */
export function summary() {
  const active = ASSOC.filter(a => a.state === 'Active'), plots = sum(ASSOC, a => a.plots), c = concentration();
  const trials = ASSOC.filter(a => a.state === 'Trial'), late = INVOICES.filter(i => i.days < 0);
  return [
    `You are running ${fmtI(sum(active, a => a.mrr))} of monthly recurring revenue across ${active.length} active association${active.length === 1 ? '' : 's'} and ${num(plots)} plots.` +
      (c ? ` ${c.a.n} is ${c.pct}% of annual revenue and ${c.a.days < 0 ? 'its renewal is ' + days(c.a.days) + ' overdue' : 'renews in ' + days(c.a.days)}.` : ''),
    (trials.length ? `${trials.length} trial${trials.length === 1 ? '' : 's'} (${fmtL(sum(trials, a => a.annual))} a year if they convert): ${trials.map(a => `${a.n} at ${a.adopt}% onboarding`).join(', ')}. ` : 'No trials are open. ') +
      (late.length ? `${late.length} invoice${late.length === 1 ? ' is' : 's are'} overdue, ${fmtI(sum(late, i => i.amt))} in all.` : 'Nothing is overdue.'),
  ];
}

/** one line per account that owes money, oldest debt first */
export function chasePlan() {
  return ASSOC.map(a => ({ a, late: overdueOf(a) })).filter(r => r.late.length)
    .sort((p, q) => Math.min(...p.late.map(i => i.days)) - Math.min(...q.late.map(i => i.days))).slice(0, 4)
    .map(({ a, late }) => ({
      name: a.n,
      text: `${late.length} invoice${late.length === 1 ? '' : 's'}, the oldest ${days(Math.min(...late.map(i => i.days)))} late, totalling ${fmtI(sum(late, i => i.amt))}. ` +
        (a.state === 'Suspended' ? 'The account is suspended — this is a win-back, not a chase; leading with the invoice will lose it.'
          : a.adopt < 70 ? `Adoption is ${a.adopt}%, so send the payment link and onboarding help in one message rather than a bare reminder.`
          : `Otherwise healthy (${health(a).score}/100) — one call to ${a.admin} usually clears it.`),
    }));
}

/** renewals inside 90 days, biggest first */
export function weekPlan() {
  return live().filter(a => a.days <= 90).sort((p, q) => q.annual - p.annual).slice(0, 4).map(a => {
    const h = health(a);
    return {
      head: `${a.n} (${a.days < 0 ? days(a.days) + ' late' : days(a.days)}, ${fmtL(a.annual)})`,
      text: `${h.band} at ${h.score}/100 — ${h.why.toLowerCase()}. ` + (a.state === 'Pending' ? 'Verification is the only thing in the way; do it first.'
        : a.state === 'Trial' ? 'The trial converts on onboarding: get owners signed in before it closes.'
        : h.band === 'Healthy' ? 'This is an uplift conversation, not a rescue.' : 'Deal with the cause before talking about the renewal.'),
    };
  });
}

/* ---------- copilot ---------- */
const CHIPS = ['What needs me today?', 'Which renewal is most at risk?', 'Draft a payment reminder', 'How is health scored?'];
export const LIVE_INTRO = {
  who: 'ai',
  t: 'I read your account records — associations, subscriptions, invoices and support issues — and work my answers out from them. I can explain what I see and draft messages, but I never send anything or change an account on my own.',
  chips: CHIPS,
};

const draft = (to, subject, body) => <div className="draft"><b>To:</b> {to}<br /><b>Subject:</b> {subject}<br /><br />{body}<br /><br />{OPERATOR.first}</div>;

export function liveAnswer(text, p = { go() {}, chase() {}, updateSubscription() {} }) {
  const q = text.toLowerCase();
  const named = ASSOC.find(a => q.includes(a.n.toLowerCase()) || q.includes(a.n.split(' ')[0].toLowerCase()));

  if (q.includes('draft') && (q.includes('remind') || q.includes('payment') || q.includes('chase'))) {
    const a = (named && overdueOf(named).length ? named : null) ?? ASSOC.find(x => overdueOf(x).length && x.state !== 'Suspended') ?? ASSOC.find(x => overdueOf(x).length);
    if (!a) return { who: 'ai', src: 'Invoice records', chips: CHIPS, t: 'Nothing is overdue right now, so there is no reminder to draft.' };
    const late = overdueOf(a);
    return {
      who: 'ai', src: 'Drafted from invoice ages · not sent', chips: ['What needs me today?', 'Draft the renewal email'],
      t: <>Here is a draft for {a.n} — <b>nothing is sent</b> until you copy it into your own mail:
        {draft(contact(a), `${late.length} open invoice${late.length === 1 ? '' : 's'} — ${fmtI(sum(late, i => i.amt))}`, <>
          Dear {a.admin.split(' ')[0]},<br /><br />{late.length === 1 ? 'One invoice' : late.length + ' invoices'} totalling {fmtI(sum(late, i => i.amt))} {late.length === 1 ? 'is' : 'are'} past due ({late.map(i => i.id).join(', ')}); the oldest is {days(Math.min(...late.map(i => i.days)))} late.
          {a.adopt < 70 && <><br /><br />Separately: owner registrations are at {a.adopt}%. If it would help, we can run an onboarding drive with you — that is usually what turns the number around.</>}
          <br /><br />Could you let me know when we can expect payment?
        </>)}</>,
    };
  }

  if (q.includes('draft')) {
    const a = named ?? live().filter(x => x.state === 'Active').sort((x, y) => x.days - y.days)[0];
    if (!a) return { who: 'ai', chips: CHIPS, t: 'There is no active account with a renewal coming up to write about.' };
    return {
      who: 'ai', src: 'Drafted from account records · not sent', chips: ['Draft a payment reminder', 'What needs me today?'],
      t: <>Here is a draft — <b>nothing is sent</b> until you copy it into your own mail:
        {draft(contact(a), `Trinize renewal — ${a.renew}`, <>
          Dear {a.admin.split(' ')[0]},<br /><br />Your Trinize subscription ({a.plan}) renews on {a.renew}. Owner onboarding at {a.n} stands at {a.adopt}% — {num(a.owners)} of {num(a.plots)} plots.
          <br /><br />Could we set up a short call before the renewal date to go through the year and what you would like next?
        </>)}</>,
    };
  }

  if (q.includes('today') || q.includes('need me') || q.includes('priorit')) {
    const cards = attention(p);
    return {
      who: 'ai', src: 'Computed from subscription, invoice and usage records', chips: ['Which renewal is most at risk?', 'Draft a payment reminder', 'How is health scored?'],
      t: cards.length ? <>{cards.length === 1 ? 'One thing' : cards.length + ' things'}, most urgent first:{'\n\n'}{cards.map((c, i) => <span key={c.id}><b>{i + 1}.</b> {c.head} — {c.t.toLowerCase()}.{'\n'}</span>)}</>
        : 'Nothing needs you right now: no trials closing, no renewals inside 30 days, no verification waiting and no overdue invoices.',
    };
  }

  if (q.includes('renewal') || (q.includes('risk') && !named)) {
    const rows = live().filter(a => a.days <= 90).map(a => ({ a, h: health(a) }));
    if (!rows.length) return { who: 'ai', src: 'Health model + renewal calendar', chips: CHIPS, t: 'No account renews or ends a trial in the next 90 days.' };
    const money = rows.slice().sort((x, y) => y.a.annual - x.a.annual)[0], risk = rows.slice().sort((x, y) => x.h.score - y.h.score)[0];
    return {
      who: 'ai', src: 'Health model + renewal calendar', chips: ['Draft the renewal email', 'What needs me today?'],
      t: <>By revenue at stake it is <b>{money.a.n}</b> ({fmtL(money.a.annual)}, {days(money.a.days)}{money.a.days < 0 ? ' late' : ''}) — it scores {money.h.score}/100.{'\n\n'}
        By <i>probability</i> of loss it is <b>{risk.a.n}</b> ({risk.h.score}/100) — {risk.h.why.toLowerCase()}.</>,
    };
  }

  if (named) {
    const h = health(named), late = overdueOf(named), open = ISSUES.filter(i => i.a === named.id && i.st !== 'Resolved');
    return {
      who: 'ai', src: 'Health model · ' + named.n, chips: ['Draft a payment reminder', 'How is health scored?'],
      t: <><b>{named.n}</b> scores <b>{h.score}/100</b> ({h.band}) — {h.why.toLowerCase()}.{'\n\n'}
        • {named.plan}, {fmtL(named.annual)}/yr, {named.state === 'Trial' ? 'trial ends' : 'renews'} {named.renew}{'\n'}
        • Owner onboarding {named.adopt}% ({num(named.owners)} of {num(named.plots)} plots){'\n'}
        • {late.length ? `${late.length} overdue invoice${late.length === 1 ? '' : 's'}, ${fmtI(sum(late, i => i.amt))}` : 'No overdue invoices'}{'\n'}
        • {open.length ? `${open.length} open support ticket${open.length === 1 ? '' : 's'}` : 'No open support tickets'}</>,
    };
  }

  if (q.includes('health') || q.includes('score')) return {
    who: 'ai', src: 'The health model', chips: ['What needs me today?', 'Which renewal is most at risk?'],
    t: <>Health starts at 50 and moves on four signals:{'\n\n'}
      • <b>Owner adoption × 0.35</b> — the strongest renewal predictor{'\n'}
      • <b>Payment state</b> — paid +14, part paid −8, past due −22{'\n'}
      • <b>Three-month usage trend</b> — rising +8, falling −12{'\n'}
      • <b>Ticket load</b> — −5 with three or more new open tickets in a month{'\n\n'}
      75+ is Healthy, 52–74 Watch, below 52 At risk. Suspended accounts are Critical.</>,
  };

  if (q.includes('upsell') || q.includes('module') || q.includes('plan')) {
    const below = ASSOC.filter(a => a.state === 'Active' && a.plan !== 'Enterprise').sort((x, y) => health(y).score - health(x).score);
    return {
      who: 'ai', src: 'Module registry × current plans', chips: ['Draft the renewal email', 'What needs me today?'],
      t: below.length ? <>Active accounts not yet on Enterprise, healthiest first — a healthy account is the one that will say yes:{'\n\n'}{below.slice(0, 4).map(a => <span key={a.id}>• <b>{a.n}</b> — {a.plan}, health {health(a).score}, adoption {a.adopt}%{'\n'}</span>)}</>
        : 'Every active account is already on Enterprise.',
    };
  }

  return {
    who: 'ai', chips: CHIPS,
    t: 'I answer from the account records in this portal — subscriptions, invoices, adoption, support issues and plans. I could not match that to anything I hold, so I will not guess.\n\nTry one of these, or name an association:',
  };
}
