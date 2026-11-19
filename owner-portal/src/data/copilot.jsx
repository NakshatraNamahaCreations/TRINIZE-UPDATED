/* Trinize Assistant — answers only from the records in this portal, suggests but never acts.
   Messages render inside a white-space:pre-wrap bubble, so '\n' strings are real line breaks. */
import { LIVE } from '../lib/api';
import { LIVE_INTRO, liveAnswer } from './insights';
import { findAssoc, health } from './portal';

const score = id => health(findAssoc(id)).score;
const DEFAULT_CHIPS = ['What needs me today?', 'Which renewal is most at risk?', 'Draft the renewal email for Prestige', 'Why is Green Meadows at risk?'];

export const COPILOT_INTRO = LIVE ? LIVE_INTRO : {
  who: 'ai',
  t: 'I read your account records — associations, subscriptions, invoices and support issues. I can explain what I see and draft messages, but I never send anything or change an account on my own.',
  chips: DEFAULT_CHIPS,
};

export function copilotAnswer(text) {
  if (LIVE) return liveAnswer(text);
  const q = text.toLowerCase();

  if (q.includes('today') || q.includes('need me') || q.includes('priorit')) return {
    who: 'ai', src: 'Computed from subscription, invoice and usage records',
    chips: ['Draft the renewal email for Prestige', 'Why is Green Meadows at risk?', 'How is health scored?'],
    t: <>Four things, in order of money you can still influence:{'\n\n'}
      <b>1.</b> Nandi Hills trial ends in 4 days at 18% onboarding — blocked by import bug ISS-2038. ₹30,240/yr.{'\n'}
      <b>2.</b> Coastal Grove has been awaiting verification for 18 days; its trial ends in 12. ₹74,800/yr sitting behind a 20-minute internal task.{'\n'}
      <b>3.</b> Prestige renews in 15 days — healthy ({score('asn-2')}/100), so make it an uplift, not a rescue. ₹11.6L/yr.{'\n'}
      <b>4.</b> Green Meadows is 15 days past due <i>and</i> its adoption slid 68% → 61%.</>,
  };

  if (q.includes('renewal') && (q.includes('risk') || q.includes('most'))) return {
    who: 'ai', src: 'Health model + renewal calendar',
    chips: ['Draft the renewal email for Prestige', 'What needs me today?'],
    t: <>By revenue at stake it is <b>Prestige Lakeside Habitat</b> (₹11.6L, 15 days) — but it scores {score('asn-2')}/100, so the risk is concentration, not churn: 70% of your ARR renews on one date.{'\n\n'}
      By <i>probability</i> of loss it is <b>Coastal Grove</b> ({score('asn-6')}/100) — never verified, zero owners onboarded, trial ends in 12 days. <b>Nandi Hills</b> ({score('asn-5')}/100) is close behind with 4 days left, and its blocker is a bug you own.</>,
  };

  if (q.includes('draft') && (q.includes('renewal') || q.includes('prestige'))) return {
    who: 'ai', src: 'Drafted from account records · not sent',
    chips: ['Draft the Green Meadows reminder', 'What needs me today?'],
    t: <>Here is a draft — <b>nothing is sent</b> until you copy it into your own mail:
      <div className="draft"><b>To:</b> Sanjana Rao · admin@plhabitat.org<br /><b>Subject:</b> Trinize renewal — 14 September<br /><br />
        Dear Sanjana,<br /><br />Your Trinize subscription renews on 14 September. Owner onboarding at Prestige Lakeside crossed 87% this quarter — the highest of any account we run — and support volume halved.<br /><br />
        At the August review the committee asked about a resident community app. That module is now ready to demo: announcements, discussions, events and polls, an AI assistant that files real trackable issues, and a moderation console for the committee.<br /><br />
        Could we walk through it before the renewal date?<br /><br />Ravi</div>
      {'\n'}Want me to draft the Green Meadows reminder too?</>,
  };

  if (q.includes('draft') && (q.includes('green') || q.includes('reminder'))) return {
    who: 'ai', src: 'Drafted from invoice ages and usage trend · not sent',
    chips: ['What needs me today?', 'Why is Green Meadows at risk?'],
    t: <>Green Meadows needs the money <i>and</i> the adoption addressed in one message:
      <div className="draft"><b>To:</b> Bhagya Lakshmi · greenmeadows.rwa@gmail.com<br /><b>Subject:</b> Two open invoices — and a hand with owner onboarding<br /><br />
        Dear Bhagya,<br /><br />Two invoices totalling ₹2,016 are past due; access restricts automatically at 30 days, and the older one is at 36. Payment link below.<br /><br />
        Separately: owner registrations have slipped from 68% to 61% since May. If it would help, we can run an onboarding drive for the remaining 23 villas at no cost — that is usually what turns the number around.<br /><br />Ravi</div></>,
  };

  if (q.includes('green meadows') || (q.includes('why') && q.includes('risk'))) return {
    who: 'ai', src: 'Health model · asn-4',
    chips: ['Draft the Green Meadows reminder', 'How is health scored?'],
    t: <>Green Meadows scores <b>{score('asn-4')}/100</b>. Three signals stack: two invoices past due (36 and 5 days), owner onboarding sliding 68% → 61% over the quarter, and logins down 34%.{'\n\n'}
      The payment is the symptom. A society stops paying for a system its residents stopped using — so a reminder alone buys about a month.</>,
  };

  if (q.includes('health') && (q.includes('score') || q.includes('how'))) return {
    who: 'ai', src: 'health() in this concept',
    chips: ['What needs me today?', 'Which renewal is most at risk?'],
    t: <>Health starts at 50 and moves on four signals:{'\n\n'}
      • <b>Owner adoption × 0.35</b> — the strongest renewal predictor{'\n'}
      • <b>Payment state</b> — paid +14, part paid −8, past due −22{'\n'}
      • <b>90-day usage slope</b> — rising +8, falling −12{'\n'}
      • <b>Ticket load</b> — −5 if open tickets rose{'\n\n'}
      75+ is Healthy, 52–74 Watch, below 52 At risk. It is a transparent model on purpose: you can argue with it.</>,
  };

  if (q.includes('community') || q.includes('resident') || q.includes('cfm')) return {
    who: 'ai', src: 'Module catalog · proposed', chips: ['What needs me today?'],
    t: <>The Community Engagement module — the resident app and the committee's moderation console from the CFM brief — exists as a working simulation. It uses Prestige Lakeside's own demo records, and a resident action there lands live in the admin queue.{'\n\n'}
      Open it from the Modules page, or the button on the Prestige account.</>,
  };

  if (q.includes('upsell') || q.includes('module') || q.includes('plan')) return {
    who: 'ai', src: 'Module registry × current plans',
    chips: ['Draft the renewal email for Prestige', 'What needs me today?'],
    t: <>Your upsell surface is the 7 Enterprise-only modules. Two accounts are obvious candidates:{'\n\n'}
      • <b>Sobha Dream Acres</b> — Professional, health {score('asn-3')}, Work Orders usage up 22%. Enterprise adds Workflow Automation and the AI Assistant.{'\n'}
      • <b>Prestige</b> is already Enterprise — its uplift is the new Community Engagement module, which they asked for unprompted.{'\n\n'}
      Modelled headroom if every active account moved up one tier: ~₹12.9L.</>,
  };

  return {
    who: 'ai', chips: DEFAULT_CHIPS,
    t: 'I answer from the account records in this portal — subscriptions, invoices, adoption, support issues and module plans. I could not match that to anything I hold, so I will not guess.\n\nTry one of these:',
  };
}
