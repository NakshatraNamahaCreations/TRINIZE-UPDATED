import type { Draft } from 'immer';
import type { IconName } from '@/components/Icon';
import { ME, WELCOME_CHIPS, type Issue, type ModItem, type Notif, type Priority, type State, type Tone } from './data';

/* All mutators here take an immer draft, so they stay pure and side-effect free.
   Toasts, confetti and navigation are the caller's job. */

export const isOpen = (i: Issue) => !['Resolved', 'Closed'].includes(i.status);

/* ---- mock safety pipeline (server-side in the real build) ---- */
const BLOCK_WORDS = ['kill', 'die', 'hate you', 'bastard', 'bloody fool', 'scum'];
const WARN_WORDS = ['useless', 'idiot', 'idiots', 'stupid', 'nonsense', 'shameless', 'pathetic', 'joke', 'worst', 'dumb', 'freeloader', 'freeloaders'];

export type Safety = { level: 'safe' | 'warn' | 'block'; words: string[] };

export function checkSafety(text: string, threshold: State['ai']['threshold']): Safety {
  const t = ' ' + text.toLowerCase() + ' ';
  const hit = (list: string[]) => list.filter(w => new RegExp('[^a-z]' + w.replace(/ /g, '\\s+') + '[^a-z]').test(t));
  const hitB = hit(BLOCK_WORDS);
  if (hitB.length) return { level: 'block', words: hitB };
  const hitW = threshold === 'Lenient' ? [] : hit(WARN_WORDS);
  if (hitW.length) return { level: threshold === 'Strict' ? 'block' : 'warn', words: hitW };
  return { level: 'safe', words: [] };
}

/* ---- mock tone rewrite ---- */
export const TONE_META: Record<Tone, [IconName, string]> = {
  Polite: ['rose-outline', 'Kind, respectful & professional'],
  Friendly: ['hand-left-outline', 'Warm & casual'],
  Funny: ['happy-outline', 'Light-hearted & humorous'],
  'Short & Clear': ['flash-outline', 'Straight to the point'],
};

export function rewrite(text: string, tone: Tone): string {
  const seed = text.trim().replace(/\s+/g, ' ');
  const low = seed.toLowerCase();
  if (low.includes('useless') || low.includes('idiot') || low.includes('joke')) {
    if (tone === 'Friendly') return "Hey everyone 👋 — I know the committee has a lot on its plate, but could we please get an update on this? It's been pending a while and it's starting to affect us.";
    if (tone === 'Funny') return 'At this point my patience and the corridor light are flickering at the same frequency 😄 — committee friends, any update for us?';
    if (tone === 'Short & Clear') return 'Requesting a status update from the committee — this has been pending for a while.';
    return "I'm quite frustrated with how this has been handled and would really appreciate a clear update from the committee.";
  }
  if (tone === 'Polite') return 'Dear neighbours, ' + seed.charAt(0).toLowerCase() + seed.slice(1).replace(/!+/g, '.') + ' Thank you for your time and support.';
  if (tone === 'Friendly') return 'Hey everyone 👋 ' + seed.replace(/!+/g, '!') + ' Would love your thoughts!';
  if (tone === 'Funny') return seed.replace(/[.!]*$/, '') + ' — asking for a friend who is definitely not me 😄';
  return seed.replace(/!+/g, '.').split(/(?<=[.?])\s+/).slice(0, 2).join(' ');
}

/* ---- shared-record mutators ---- */
export function audit(d: Draft<State>, who: string, what: string) {
  d.audit.unshift({ who, what, when: 'Just now' });
}

export function notify(d: Draft<State>, n: Omit<Notif, 'id' | 'unread' | 'when'>) {
  d.notifs.unshift({ ...n, id: d.notifSeq++, unread: true, when: 'Just now' });
}

export function createIssue(d: Draft<State>, o: { title: string; cat: string; loc: string; pri: Priority; via: 'chat' | 'app' }): string {
  const id = 'ISS-' + d.issueSeq++;
  d.issues.unshift({
    id, title: o.title, cat: o.cat, loc: o.loc, pri: o.pri, by: ME.name, unit: ME.unit, mine: true,
    when: 'Just now', status: 'Submitted', vendor: '—', sla: 'Response due in 24h', slaState: 'ok',
    tl: [{ s: 'Submitted', w: 'Just now', n: o.via === 'chat' ? 'Reported via chatbot' : 'Reported via app' }], internal: [],
  });
  notify(d, { icon: 'ticket-outline', c: '#F1ECFE', tc: '#7C55F7', t: id + ' created', s: o.title, goTo: 'issues' });
  audit(d, 'System', 'issue ' + id + ' created by resident (via ' + (o.via === 'chat' ? 'AI assistant' : 'app') + ') · category ' + o.cat);
  return id;
}

export function holdForReview(d: Draft<State>, kind: string, text: string, cat: string, sev: ModItem['sev'], ai: string, ctx: string, refId?: string) {
  const id = 'MOD-' + d.modSeq++;
  d.modqueue.unshift({ id, kind, by: ME.name, unit: ME.unit, when: 'Just now', text, cat, sev, state: 'open', ai, ctx, refId: refId ?? null });
  audit(d, 'System (safety)', 'held ' + kind.toLowerCase() + ' for review · ' + cat + ' · severity ' + sev);
  return id;
}

/* ---- Community Assistant: grounded answers + guided issue reporting ---- */
const LOC_CHIPS = ['My flat (T4-1108)', 'Tower 4 common area', 'Clubhouse', 'Basement parking', 'Gate / external'];
const URG_CHIPS = ['Low — whenever possible', 'Medium — this week', 'High — needs attention today'];
const DESC_CHIPS = ['Streetlight near Gate 2 not working', 'Lift making noise', 'Garbage not collected today'];

function aiSay(d: Draft<State>, text: string, src: string | null, chips?: string[]) {
  d.chat.log.push({ who: 'ai', text, src, chips });
}

function guessCategory(t: string) {
  if (t.includes('light') || t.includes('electric') || t.includes('power')) return 'Electrical';
  if (t.includes('water') || t.includes('leak') || t.includes('seep')) return 'Plumbing';
  if (t.includes('lift')) return 'Lifts';
  if (t.includes('garbage') || t.includes('dustbin') || t.includes('trash')) return 'Sanitation';
  if (t.includes('ac ') || t.includes('cooling')) return 'HVAC';
  return 'General maintenance';
}

export function aiReply(d: Draft<State>, text: string) {
  const c = d.chat;
  const safety = checkSafety(text, d.ai.threshold);
  if (safety.level !== 'safe') {
    if (c.mode === 'idle') {
      const named = safety.words.slice(0, 3).map(w => '“' + w + '”').join(', ');
      aiSay(d, 'I noticed ' + (safety.words.length > 1 ? 'the words ' : 'the word ') + named + " — that may land badly with your neighbours. Let's keep our community respectful 💜 Would you like me to help rephrase it?", null, ['Yes, help me rephrase', 'Start over']);
      holdForReview(d, 'AI chat message', text, safety.level === 'block' ? 'Abusive' : 'Aggressive', safety.level === 'block' ? 'High' : 'Medium',
        'Flagged in private AI chat. Only this excerpt is visible to moderators — the rest of the conversation stays private.', 'Private chat with Community Assistant');
    } else {
      aiSay(d, "Let's keep the description respectful so the team can act on it 💜 — please rephrase.", null,
        c.mode === 'issue.loc' ? LOC_CHIPS : c.mode === 'issue.urg' ? URG_CHIPS : DESC_CHIPS);
      if (safety.level === 'block') holdForReview(d, 'AI chat message', text, 'Abusive', 'High',
        'Flagged mid issue-report. Only this excerpt is visible to moderators — the rest of the conversation stays private.', 'Private chat with Community Assistant');
    }
    d.tried.guard = true;
    return;
  }

  const t = text.toLowerCase();
  if (/\b(fire|smoke|gas leak|accident|injured|injury|bleeding|unconscious|emergency|ambulance|intruder|burglar|theft|robbery|108|101)\b/.test(t)) {
    aiSay(d, 'If this is a medical, fire or security emergency, please call now:\n\n• Security Office (24×7) — +91 80 4128 7001\n• Ambulance — 108\n• Fire Brigade — 101\n\nI have not contacted any emergency service, and I am not able to. Once everyone is safe, I can log an issue for the committee.',
      'Community Handbook v3 · §12 Emergency procedure', ['Open the Directory', 'Report an issue', 'Start over']);
    return;
  }

  if (c.mode === 'issue.desc') {
    c.draft.title = text.length > 60 ? text.slice(0, 57) + '…' : text;
    c.draft.desc = text;
    c.draft.cat = guessCategory(t);
    c.mode = 'issue.loc';
    aiSay(d, "Got it — I've categorised this as " + c.draft.cat + '. Where is the problem?', null, LOC_CHIPS);
  } else if (c.mode === 'issue.loc') {
    c.draft.loc = text;
    c.mode = 'issue.urg';
    aiSay(d, 'And how urgent is it?', null, URG_CHIPS);
  } else if (c.mode === 'issue.urg') {
    c.draft.pri = t.includes('high') ? 'High' : t.includes('low') ? 'Low' : 'Medium';
    c.mode = 'issue.preview';
    c.log.push({ who: 'preview', draft: { title: '', desc: '', cat: '', loc: '', pri: 'Medium', ...c.draft } });
  } else if ((t.includes('report') && t.includes('issue')) || t === 'report an issue') {
    if (!d.ai.issueCreate) {
      aiSay(d, 'Issue creation through chat is currently switched off by your society admin. You can still report from the + button below.', null, ['Start over']);
    } else {
      c.mode = 'issue.desc'; c.draft = {};
      c.log = c.log.filter(m => m.who !== 'preview');
      aiSay(d, "I can log that for you. Briefly, what's the problem?", null, DESC_CHIPS);
    }
  } else if (!d.ai.qna && /water|pool|gym|timing|parking/.test(t)) {
    aiSay(d, 'Community Q&A is currently switched off by your society admin. You can still report an issue from here or contact the society office.', null, ['Report an issue', 'Start over']);
  } else if (t.includes('water')) {
    aiSay(d, 'Water supply will be paused on Wednesday 2 September, 10:00 AM – 2:00 PM, for pump-room maintenance in Towers 4 and 5. Your tower (T4) is affected — please store water in advance.',
      'Announcement AN-118 · Admin Office, 29 Aug 2026', ['Report an issue', 'What are the pool timings?']);
    d.tried.ask = true;
  } else if ((t.includes('pool') || t.includes('gym') || t.includes('timing') || t.includes('hours')) && !/(wifi|wi-fi|password|login|booking|book |fee|charge|cost|price)/.test(t)) {
    aiSay(d, 'Pool hours are 6:00–9:00 AM and 4:00–8:00 PM (closed Mondays for cleaning). The gym is open 5:30 AM – 10:00 PM daily. Children under 12 must be accompanied at the pool.',
      'Pool, Gym & Clubhouse Rules 2026 · page 2', ['Report an issue', 'Summarise this week']);
    d.tried.ask = true;
  } else if (t.includes('summar')) {
    if (!d.ai.summaries) {
      aiSay(d, 'Summaries are currently switched off by your society admin.', null, ['Start over']);
    } else {
      const y = d.events.find(e => e.id === 'E-52');
      const seats = y ? y.cap - y.going : 0;
      const myOpen = d.issues.filter(i => i.mine && isOpen(i));
      const openPolls = d.polls.filter(p => !p.closed).length;
      aiSay(d, "Here's your week at Prestige Lakeside:\n• Water shutdown Wed 2 Sep (Towers 4–5) — store water\n• Onam Sadhya Sat 5 Sep · Yoga Sun 6 Sep (" +
        (seats > 0 ? seats + ' seat' + (seats === 1 ? '' : 's') + ' left' : 'full — waitlist open') + ')\n• ' +
        openPolls + ' poll' + (openPolls === 1 ? '' : 's') + ' open: yoga timing & CCTV upgrade\n• ' +
        (myOpen.length ? 'Your open issue' + (myOpen.length > 1 ? 's' : '') + ': ' + myOpen.map(i => i.id + ' (' + i.status + ')').join(', ') : 'You have no open issues right now') +
        '\n\nThis summary is private and visible only to you.',
        'Generated from announcements, events, polls & your issues', ['Report an issue', 'When is the water shutdown?']);
    }
    d.tried.ask = true;
  } else if (t.includes('parking')) {
    aiSay(d, 'Visitor parking is in Basement 2, slots V-01 to V-40, free for the first 6 hours. Resident slots are assigned per unit — misuse can be reported as an issue.',
      'Community Handbook v3 · §7 Parking', ['Report an issue']);
    d.tried.ask = true;
  } else if (t.includes('issue') && (t.includes('status') || t.includes('my'))) {
    const mine = d.issues.filter(i => i.mine);
    const open = mine.filter(isOpen);
    const done = mine.length - open.length;
    aiSay(d, (open.length
      ? 'You have ' + open.length + ' open issue' + (open.length === 1 ? '' : 's') + ': ' + open.map(i => i.id + ' — ' + i.title + ' (' + i.status + (i.vendor !== '—' ? ', ' + i.vendor : '') + ')').join('; ') + '.'
      : 'You have no open issues right now.') + (done ? ' ' + done + ' issue' + (done === 1 ? ' was' : 's were') + ' resolved recently.' : ''),
      'Your issue records', ['Open My Issues']);
  } else if (t === 'yes, help me rephrase') {
    aiSay(d, "Here's a respectful version you could use:\n\n“I'm concerned this hasn't been addressed yet — could the committee please share an update?”\n\nWant me to keep helping, or start over?", null, ['Start over', 'Report an issue']);
  } else if (t === 'start over') {
    c.mode = 'idle'; c.draft = {};
    c.log = c.log.filter(m => m.who !== 'preview');
    aiSay(d, 'No problem — starting fresh. What would you like to do?', null, WELCOME_CHIPS);
  } else {
    aiSay(d, "I couldn't find that in the approved community information, so I won't guess. You can rephrase, or I can connect you to the society office (open 9 AM – 7 PM).", null,
      ['Report an issue', 'When is the water shutdown?', 'What are the pool timings?']);
  }
}
