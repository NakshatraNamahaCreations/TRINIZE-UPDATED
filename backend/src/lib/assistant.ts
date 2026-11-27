import type { Doc } from './ai.js';

/* The parts of the assistant that never go to a model: understanding mixed-language keywords,
   spotting emergencies, picking which documents are relevant, and a rule-based tone rewrite used
   when no AI key is configured. */

/** Residents mix languages ("paani kab band hoga"): add the English keyword for words we recognise. */
const SYNONYMS: [RegExp, string][] = [
  [/\b(paani|pani|neeru)\b|पानी|जल आपूर्ति|ನೀರು/, 'water'],
  [/\b(swimming)\b|स्विमिंग|तरणताल|ಈಜು/, 'pool'],
  [/जिम|ಜಿಮ್/, 'gym'],
  [/\b(gaadi|gaddi)\b|पार्किंग|गाड़ी|ಪಾರ್ಕಿಂಗ್|ವಾಹನ/, 'parking'],
  [/\b(kachra|kooda)\b|कचरा|कूड़ा|ಕಸ/, 'waste garbage'],
  [/\b(mehmaan|atithi)\b|मेहमान|अतिथि|ಅತಿಥಿ/, 'visitor guest'],
  [/\b(aag|dhuan)\b|आग|धुआं|ಬೆಂಕಿ|ಹೊಗೆ/, 'fire'],
  [/\b(madad|bachao)\b|मदद|बचाओ|ಸಹಾಯ ಮಾಡಿ|ಕಾಪಾಡಿ/, 'emergency'],
  [/\b(samay|kitne baje)\b|समय|ಸಮಯ/, 'hours'],
];
export function understand(text: string) {
  const raw = text.toLowerCase();
  let t = raw;
  for (const [re, word] of SYNONYMS) if (re.test(raw)) t += ' ' + word;
  return t;
}

/** never answered by a model: the resident gets SOS and the numbers to call, immediately — including anyone stuck or trapped in a lift */
export const isEmergency = (understood: string) =>
  /\b(fire|smoke|gas leak|accident|injured|injury|bleeding|unconscious|emergency|ambulance|intruder|burglar|theft|robbery|heart attack|trapped)\b/.test(understood)
  // a number only when someone asks to call it — "call 112", "dial 108" — never "flat 112"
  || /\b(call|dial|ring|phone)\s+(1(01|08|12))\b/.test(understood)
  || liftTrap(understood);
const LIFT = /\b(lift|elevator)s?\b|लिफ्ट|ಲಿಫ್ಟ್/;
const STUCK = /\b(stuck|trapped|phas|phasa|phasi|phans|phansa|phanse|phansi|fasa|fasi|atak|atka|atke|atki)\b|फंस|फँस|अटक|ಸಿಕ್ಕಿ|ಸಿಲುಕಿ/;
/** someone stuck in a lift, in one sentence: "Someone is stuck in the lift", "lift mein phas gaye", "लिफ्ट में फंस गए" */
export const liftTrap = (text: string) => text.toLowerCase().split(/[.?!\n]/).some(s => LIFT.test(s) && STUCK.test(s));

const STOP = new Set('the a an is are was were be to of in on at for and or what when where which who how much many do does can i my me we our it this that there with from by about any please tell'.split(' '));
/** crude stemming so "visitors park" meets "visitor parking": plural, -ing, -ed */
const stem = (w: string) => (w.length > 4 ? w.replace(/s$/, '').replace(/(ing|ed)$/, '') : w);
const words = (s: string) => [...new Set(s.toLowerCase().match(/[a-z0-9]{3,}/g)?.filter(w => !STOP.has(w)).map(stem) ?? [])];

/**
 * What the question is about, as words to look for. A mixed-language question is reduced to the
 * English keywords we recognised plus any of its words the library itself uses — "paani kab band hoga"
 * is a question about "water", and "kab", "band", "hoga" shouldn't count against a match.
 */
function queryWords(question: string, docs: Doc[]) {
  const raw = question.toLowerCase();
  const mapped = SYNONYMS.filter(([re]) => re.test(raw)).flatMap(([, w]) => words(w));
  const all = words(question.replace(/\btimings?\b/gi, 'hours'));
  if (!mapped.length) return all;
  const vocab = new Set(docs.flatMap(d => words(d.title + ' ' + d.section + ' ' + d.body)));
  return [...new Set([...mapped, ...all.filter(w => vocab.has(w))])];
}

/**
 * The few documents most likely to hold the answer (keyword overlap; pgvector can replace this later).
 * A document must cover more than half of what was asked — one shared word ("clubhouse") isn't a match.
 */
export function relevant(question: string, docs: Doc[], max = 4, { strict = true } = {}): Doc[] {
  const q = queryWords(question, docs);
  if (!q.length) return [];
  return docs
    .map(d => {
      const title = new Set(words(d.title + ' ' + d.section));
      const body = new Set(words(d.body));
      let score = 0, covered = 0;
      for (const w of q) {
        if (title.has(w) || body.has(w)) covered++;
        score += (title.has(w) ? 3 : 0) + (body.has(w) ? 1 : 0);
      }
      return { d, score, covered };
    })
    // strict: the no-AI path quotes the top document as the answer, so it must really match.
    // loose: a model reads the candidates and decides for itself, so anything related may go in.
    .filter(x => (strict ? x.covered * 2 > q.length : x.covered > 0))
    .sort((a, b) => b.covered - a.covered || b.score - a.score)
    .slice(0, max)
    .map(x => x.d);
}

/** Without a model: the best-matching passage, quoted as written — no paraphrasing, no guessing. */
export function extractAnswer(question: string, docs: Doc[]): { text: string; source: string } | null {
  const [best] = relevant(question, docs, 1);
  if (!best) return null;
  const q = new Set(queryWords(question, docs));
  const sentences = best.body.split(/(?<=[.!?])\s+/);
  const scored = sentences.map((s, i) => ({ s, i, n: words(s).filter(w => q.has(w)).length })).filter(x => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 3).sort((a, b) => a.i - b.i);
  const text = (scored.length ? scored.map(x => x.s).join(' ') : sentences.slice(0, 2).join(' ')).trim();
  return { text, source: best.title + (best.section ? ' · ' + best.section : '') };
}

/* ---------- rule-based tone rewrite (same behaviour as the app's offline preview) ---------- */
function cool(text: string) {
  let s = text;
  s = s.replace(/\b(is|are|was|were)\s+(so\s+|totally\s+|completely\s+|absolutely\s+|just\s+)?(useless|pathetic|a joke|nonsense|the worst)\b/gi, '$1 not working properly');
  s = s.replace(/\bwhat an? (joke|nonsense)\b[.!]*/gi, '');
  s = s.replace(/\b(you\s+)?(bloody\s+)?(idiots?|stupid|dumb|shameless|freeloaders?|scammers?|fraud(ster)?s?|cheat(er)?s?|thie(f|ves)|liars?|crooks?|bewakoof|pagal|chor)\b/gi, '');
  return s.replace(/\b(useless|pathetic|nonsense|worst|joke|bekaar|bakwas)\b/gi, '');
}
const tidy = (s: string) => s.replace(/\s+/g, ' ').replace(/\s+([,.!?])/g, '$1').replace(/([,.!?])[,.!?]+/g, '$1').replace(/^[\s,.!?]+/, '').trim();
const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) && !/^I\b/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s);
const endStop = (s: string) => (/[.!?]$/.test(s) ? s : s + '.');

export function ruleRewrite(text: string, tone: string): string {
  const seed = text.trim().replace(/\s+/g, ' ');
  const cooled = cool(seed);
  const heated = cooled !== seed;
  const body = endStop(tidy(heated ? cooled : seed).replace(/!+/g, '.'));
  if (heated && body.length < 8) return 'I’m concerned this hasn’t been addressed yet. Could the committee please share an update?';
  if (tone === 'Friendly') return 'Hey everyone 👋 ' + body + (heated ? ' Any update would be really appreciated!' : ' Would love your thoughts!');
  if (tone === 'Funny') return body.replace(/[.!?]$/, '') + (heated ? ' — my patience is running low, but my hopes are high 😄 Any update?' : ' — asking for a friend who is definitely not me 😄');
  if (tone === 'Short & Clear') return body.split(/(?<=[.?])\s+/).slice(0, 2).join(' ') + (heated ? ' Requesting an update.' : '');
  return 'Dear neighbours, ' + lowerFirst(body) + (heated ? ' Could we please get an update on this? Thank you.' : ' Thank you for your time and support.');
}
