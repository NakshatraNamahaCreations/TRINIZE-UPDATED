import type { Draft } from 'immer';
import type { IconName } from '@/components/Icon';
import { ddm, dm, longDate } from './dates';
import { places, ME, pollClosed, WELCOME_CHIPS, type Issue, type ModItem, type Notif, type Priority, type State, type Tone } from './data';

/* All mutators here take an immer draft, so they stay pure and side-effect free.
   Toasts, confetti and navigation are the caller's job. */

export const isOpen = (i: Issue) => !['Resolved', 'Closed'].includes(i.status);

/* ---- mock safety pipeline (server-side in the real build) ----
   Three lists, so a fair complaint about a service isn't treated like an attack on a person:
   threats/slurs always block; insults aimed at people always warn; harsh words ("useless") only
   warn when they aren't about a facility or service. English, Hinglish, Hindi and Kannada. */
const BLOCK_WORDS = [
  // threats
  'kill you', 'kill him', 'kill her', 'kill them', 'kill yourself', 'i will kill', 'go die', 'hope you die', 'you should die', 'drop dead',
  'hate you', 'beat you', 'slap you', 'finish you',
  // slurs and strong profanity
  'bastard', 'bloody fool', 'scum', 'fuck', 'fucking', 'fucker', 'motherfucker', 'f*ck', 'f**k', 'fck', 'wtf', 'stfu',
  'bitch', 'son of a bitch', 'asshole', 'cunt', 'whore', 'slut', 'dickhead', 'retard', 'retarded',
  // Hinglish / Hindi gaalis
  'harami', 'haramkhor', 'kamina', 'kameena', 'kamine', 'kameene', 'madarchod', 'behenchod', 'bhenchod', 'bhosdike', 'bhosdi', 'bsdk',
  'chutiya', 'chutiye', 'gaandu', 'gandu', 'randi', 'lund', 'lavda', 'lauda', 
  'हरामी', 'हरामखोर', 'कमीना', 'कमीने', 'मादरचोद', 'बहनचोद', 'भोसड़ी', 'चूतिया', 'गांडू', 'रंडी', 'कुत्ती',
  // Kannada
  'ಬೇವರ್ಸಿ', 'ಸೂಳೆ', 'ಬೋಳಿಮಗ', 'ಸೂಳೆಮಗ', 'bevarsi', 'boli maga', 'bolimaga', 'sule maga', 'soolemaga',
  // Kannada (more)
  'ninn amman', 'ninamman', 'nin amman', 'ninn akkan', 'tullu', 'ತುಲ್ಲು', 'ನಿನ್ನಮ್ಮನ್', 'ನಿನ್ ಅಮ್ಮನ್',
  // Tamil
  'punda', 'pundai', 'thevidiya', 'thevdiya', 'otha', 'ommala', 'koothi', 'oombu', 'புண்டை', 'தேவடியா', 'ஓத்த', 'ஒம்மால', 'கூதி', 'ஊம்பு',
  // Telugu
  'lanja', 'lanjakoduka', 'puku', 'erripuka', 'లంజ', 'లంజకొడుకు', 'దెంగు', 'పూకు',
  // Malayalam
  'kunna', 'thayoli', 'myre', 'myru', 'maire', 'pooru', 'poorimone', 'കുണ്ണ', 'തായോളി', 'മൈര്', 'മൈരേ', 'പൂറ്', 'പൂറി',
  // Marathi, Bengali
  'zavadya', 'zhavadya', 'aighala', 'khanki', 'bokachoda', 'haramjada', 'झवाड्या', 'খানকি', 'বোকাচোদা', 'হারামজাদা',
  // rude phrases that wish harm
  'go to hell', 'jaa mar', 'ja mar', 'bhaad mein ja',
];
const INSULTS = [
  'idiot', 'stupid', 'dumb', 'dumbass', 'shameless', 'freeloader', 'loafer', 'loser', 'moron', 'fool', 'jerk', 'rascal', 'rogue', 'scoundrel',
  'idler', 'good for nothing', 'good-for-nothing', 'worthless', 'buffoon', 'jackass', 'ass', 'imbecile', 'nitwit',
  'dimwit', 'numbskull', 'brainless', 'shut up', 'get lost', 
  
  // Hinglish / Hindi
  'bewakoof', 'gadha', 'gadhe', 'nalayak', 'kamchor', 'ullu', 'ullu ka pattha', 'besharam',
  'tharki', 'dhakkan', 'jaahil', 'jahil', 'nikamma', 'nikamme', 'badtameez', 'ghatiya',
  'बेवकूफ', 'गधा', 'गधे', 'नालायक', 'कामचोर', 'उल्लू', 'बेशर्म', 'ठरकी', 'जाहिल', 'निकम्मा', 'बदतमीज़', 'घटिया',
  // Kannada
  'ಮೂರ್ಖ', 'ಹಲ್ಕಾ', 'ದಡ್ಡ', 'ಸೋಮಾರಿ', 'ನಾಚಿಕೆಗೇಡು', 'murkha', 'dadda', 'somari',
  // rude sentences without swear words: aimed at a person, they are disrespectful however they are spelled
  'do your job', 'how dare you', 'who do you think you are', 'none of your business', 'mind your own business', 'nobody cares',
  'are you blind', 'are you deaf', 'are you mad', 'are you crazy', 'have some sense', 'no common sense', 'shame on you',
  'what is wrong with you', 'get out of here', 'idiotic', 'stupidity',
  'sharam karo', 'sharm karo', 'sharam nahi aati', 'sharm nahi aati', 'dimag kharab', 'dimaag kharab', 'akal nahi', 'akkal nahi',
  'nikal yahan se', 'nikal yaha se', 'chup kar', 'chup ho ja', 'teri aukaat', 'aukaat', 'aukat',
  'शर्म करो', 'शर्म नहीं आती', 'दिमाग खराब', 'अक्ल नहीं', 'निकल यहाँ से', 'चुप कर', 'औकात', 'भाड़ में जा',
  'baayi muchko', 'bayi muchko', 'baayi mucchko', 'thale illa', 'tale illa', 'buddhi illa', 'budhi illa', 'maryade illa', 'gube',
  'ಬಾಯಿ ಮುಚ್ಚು', 'ಬಾಯಿ ಮುಚ್ಕೊ', 'ತಲೆ ಇಲ್ಲ', 'ಬುದ್ಧಿ ಇಲ್ಲ', 'ಮರ್ಯಾದೆ ಇಲ್ಲ', 'ಗೂಬೆ',
  // Tamil
  'loosu', 'muttal', 'muttaal', 'porukki', 'kirukku', 'saniyan', 'kazhudhai', 'kenai', 'thendi', 'vaaya moodu', 'vaya moodu', 'arivu illaya', 'arivu kettavan',
  'லூசு', 'நாயே', 'முட்டாள்', 'பொறுக்கி', 'கிறுக்கு', 'சனியன்', 'கழுதை', 'வாயை மூடு', 'அறிவு இல்லையா', 'அறிவு கெட்ட',
  // Telugu
  'vedhava', 'vedava', 'pichodu', 'erri', 'noru moosko', 'nooru moosuko', 'వెధవ', 'పిచ్చోడు', 'ఎర్రి', 'నోరు మూసుకో',
  // Malayalam
  'mandan', 'kazhutha', 'vaayadakku', 'vaa adakk', 'മണ്ടൻ', 'തെണ്ടി', 'കഴുത', 'വായടക്ക്',
  // Marathi, Bengali
  'gadhav', 'gadhava', 'murkh', 'boka', 'गाढव', 'मूर्ख', 'বোকা',
];
const HARSH = ['thief', 'thieves', 'chor', 'चोर', 'ಕಳ್ಳ', 'kalla', 'scammer', 'scam artist', 'fraud', 'fraudster', 'cheat', 'cheater', 'liar', 'crook', 'goon', 'thug', 'parasite', 'pagal', 'पागल', 'ಹುಚ್ಚ', 'huccha', 'saale', 'donga', 'దొంగ', 'useless', 'nonsense', 'pathetic', 'joke', 'worst', 'lazy', 'damn', 'crap', 'hell', 'disgusting', 'shit', 'sh*t', 'bullshit', 'bloody', 'beggar', 'bhikari', 'भिखारी', 'bekaar', 'bakwas', 'बेकार', 'बकवास', 'ಕೆಲಸಕ್ಕೆ ಬಾರದ'];
const PEOPLE = /\b(you|he|she|they|him|her|them|his|tum|tu|aap|nee|neenu|neevu|nuvvu|meeru|avan|aval|avanu|avalu|ningal|tumhi|tumi|guards?|watchman|committee|president|secretary|treasurer|admin|manager|staff|people|neighbou?rs?|members?)\b/;

export type Safety = { level: 'safe' | 'warn' | 'block'; words: string[] };

const latin = /^[a-z -]+$/;
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's' };
const MASK = /[*#%]/;

/** Undo the usual disguises before matching: "f.u.c.k" / "f u c k" → "fuck", "l0ser" / "@ss" → "loser" / "ass". */
function normalize(text: string): string {
  let t = text.toLowerCase();
  // three or more single letters with dots, spaces, dashes or underscores between them
  t = t.replace(/(?<![a-z])(?:[a-z][\s._-]){2,}[a-z](?![a-z])/g, m => m.replace(/[\s._-]/g, ''));
  // numbers and symbols standing in for letters — only inside a word that also has letters, so "T4 lift" or "108" stay as they are
  return t.replace(/[a-z0-9@$]+/g, w => (/[a-z]/.test(w) && /[0-9@$]/.test(w) && !/^[a-z]\d+$/.test(w) ? w.replace(/[0-9@$]/g, c => LEET[c] ?? c) : w));
}

const compiled = new Map<string, RegExp>();
/** Latin words need a non-letter on each side ("die" mustn't match "diesel"), may be stretched ("fuuuck") and may be plural. */
const pattern = (w: string) => compiled.get(w) ?? compiled.set(w, new RegExp('[^a-z]' + [...w].map(ch => (ch === ' ' ? '\\s+' : ch === '-' ? '[\\s-]?' : ch + '+')).join('') + '(?:s|es)?[^a-z]')).get(w)!;

/** a word with letters hidden ("fu*k", "f**k", "b**ch") matches a listed word of the same length when the first letter and at least two letters show */
function masked(t: string, list: string[]): string[] {
  const toks = (t.match(/[a-z*#%]+/g) ?? []).filter(k => MASK.test(k) && !MASK.test(k[0]!) && k.replace(/[*#%]/g, '').length >= 2);
  return list.filter(w => !w.includes(' ') && latin.test(w) && toks.some(k => k.length === w.length && [...k].every((c, i) => MASK.test(c) || c === w[i])));
}

/** letters and digits of English and the Indian scripts (Devanagari to Malayalam) — a word ends where these stop */
const WORDCH = /[a-z0-9\u0900-\u0DFF]/;
/** Indian-script words are matched whole: "चोर" (thief) is not found inside "चोरी" (theft), nor "ಕಳ್ಳ" inside "ಕಳ್ಳತನ" */
function whole(t: string, w: string): boolean {
  for (let i = t.indexOf(w); i >= 0; i = t.indexOf(w, i + 1)) {
    if (!WORDCH.test(t[i - 1] ?? ' ') && !WORDCH.test(t[i + w.length] ?? ' ')) return true;
  }
  return false;
}

function hits(t: string, list: string[]): string[] {
  const found = list.filter(w => (latin.test(w) ? pattern(w).test(t) : whole(t, w)));
  return [...new Set([...found, ...masked(t, list)])];
}

/** "you", "he", "the guard", "तुम", "ನೀನು", "நீ"… — is the message aimed at someone? */
const PEOPLE_SCRIPT = ['तुम', 'तू', 'आप', 'तुम्हें', 'तुझे', 'वो', 'ನೀನು', 'ನೀವು', 'ನಿನಗೆ', 'ಅವನು', 'ಅವಳು', 'நீ', 'நீங்க', 'நீங்கள்', 'உனக்கு', 'அவன்', 'அவள்',
  'నువ్వు', 'మీరు', 'నీకు', 'వాడు', 'ఆమె', 'നീ', 'നിങ്ങൾ', 'നിനക്ക്', 'അവൻ', 'അവൾ', 'তুমি', 'তুই', 'আপনি'];
const aimed = (t: string) => PEOPLE.test(t) || PEOPLE_SCRIPT.some(w => whole(t, w));

export function checkSafety(text: string, threshold: State['ai']['threshold']): Safety {
  const t = ' ' + normalize(text) + ' ';
  const block = hits(t, BLOCK_WORDS);
  if (block.length) return { level: 'block', words: block };
  const insults = hits(t, INSULTS);
  // harsh words are a fair complaint about a thing ("the lift is useless", "a thief entered T3") and an insult only when aimed at someone
  const harsh = threshold === 'Lenient' || (threshold === 'Standard' && !aimed(t)) ? [] : hits(t, HARSH);
  const words = [...insults, ...harsh];
  if (words.length) return { level: threshold === 'Strict' ? 'block' : 'warn', words };
  return { level: 'safe', words: [] };
}

/* ---- mock tone rewrite ---- */
export const TONE_META: Record<Tone, [IconName, string]> = {
  Polite: ['rose-outline', 'Kind, respectful & professional'],
  Friendly: ['hand-left-outline', 'Warm & casual'],
  Funny: ['happy-outline', 'Light-hearted & humorous'],
  'Short & Clear': ['flash-outline', 'Straight to the point'],
};

/** Takes the heat out but keeps the facts — names, places, numbers stay exactly as written. */
function cool(text: string): string {
  let s = text;
  s = s.replace(/\b(is|are|was|were)\s+(so\s+|totally\s+|completely\s+|absolutely\s+|just\s+)?(useless|pathetic|a joke|nonsense|the worst)\b/gi, '$1 not working properly');
  s = s.replace(/\bwhat an? (joke|nonsense)\b[.!]*/gi, '');
  s = s.replace(/\b(you\s+)?(bloody\s+)?(idiots?|stupid|dumb|shameless|freeloaders?|scammers?|fraud(ster)?s?|cheat(er)?s?|thie(f|ves)|liars?|crooks?|bewakoof|pagal|chor)\b/gi, '');
  return s.replace(/\b(useless|pathetic|nonsense|worst|joke|bekaar|bakwas)\b/gi, '');
}
const tidy = (s: string) =>
  s.replace(/\s+/g, ' ').replace(/\s+([,.!?])/g, '$1').replace(/([,.!?])[,.!?]+/g, '$1').replace(/^[\s,.!?]+/, '').trim();

/** The text with the heat taken out, or null when there was none to take out. */
export function soften(text: string): string | null {
  const t = text.replace(/\s+/g, ' ').trim();
  const c = cool(t);
  return c === t ? null : tidy(c);
}

/** lower-case the first letter for "Dear neighbours, …" unless it's "I", a name like "T4" or an acronym */
const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) && !/^I\b/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
const endStop = (s: string) => (/[.!?]$/.test(s) ? s : s + '.');

export function rewrite(text: string, tone: Tone): string {
  const seed = text.trim().replace(/\s+/g, ' ');
  const soft = soften(seed);
  if (soft !== null) {
    // there was heat in it: keep what the resident actually reported, then ask for an update
    if (soft.length < 8) {
      if (tone === 'Friendly') return "Hey everyone 👋 — could we please get an update on this? It's been pending a while.";
      if (tone === 'Funny') return 'My patience is running low but my hopes are high 😄 — any update for us?';
      if (tone === 'Short & Clear') return 'Requesting a status update — this has been pending for a while.';
      return "I'm concerned this hasn't been addressed yet. Could the committee please share an update?";
    }
    const body = endStop(soft.replace(/!+/g, '.'));
    if (tone === 'Friendly') return 'Hey everyone 👋 ' + body + ' Any update would be really appreciated!';
    if (tone === 'Funny') return body.replace(/[.!?]$/, '') + ' — my patience is running low, but my hopes are high 😄 Any update?';
    if (tone === 'Short & Clear') return body.split(/(?<=[.?])\s+/).slice(0, 2).join(' ') + ' Requesting an update.';
    return 'Dear neighbours, ' + lowerFirst(body) + ' Could we please get an update on this? Thank you.';
  }
  if (tone === 'Polite') return 'Dear neighbours, ' + lowerFirst(endStop(seed.replace(/!+/g, '.'))) + ' Thank you for your time and support.';
  if (tone === 'Friendly') return 'Hey everyone 👋 ' + endStop(seed.replace(/!+/g, '!')) + ' Would love your thoughts!';
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

export function createIssue(d: Draft<State>, o: { title: string; cat: string; loc: string; pri: Priority; via: 'chat' | 'app'; desc?: string; photo?: string }): string {
  const id = 'ISS-' + d.issueSeq++;
  // the description (when it says more than the title) and the photo travel with the ticket
  const desc = o.desc && o.desc.trim() !== o.title.trim() ? o.desc.trim() : '';
  d.issues.unshift({
    id, title: o.title, cat: o.cat, loc: o.loc, pri: o.pri, by: ME.name, unit: ME.unit, mine: true,
    when: 'Just now', status: 'Submitted', vendor: '—', sla: 'Response due in 24h', slaState: 'ok',
    tl: [{ s: 'Submitted', w: 'Just now', n: o.via === 'chat' ? 'Reported via chatbot' : 'Reported with the form' }], internal: [],
    updates: desc || o.photo ? [{ text: desc, when: 'Just now', photo: o.photo }] : undefined,
  });
  notify(d, { icon: 'ticket-outline', c: '#F1ECFE', tc: '#7C55F7', t: id + ' created', s: o.title, goTo: 'issues', href: '/issues/' + id });
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
const URG_CHIPS = ['Low — whenever possible', 'Medium — this week', 'High — needs attention today'];
const DESC_CHIPS = ['Streetlight near Gate 2 not working', 'Lift making noise', 'Garbage not collected today', 'Use a form instead'];
/** chips the chat screen handles itself (photo picker, navigation) rather than sending to the assistant */
export const CHIP_PHOTO = 'Add a photo';
export const CHIP_SKIP_PHOTO = 'Skip photo';
export const CHIP_FORM = 'Use a form instead';

/** tappable numbers under the emergency answer */
export const EMERGENCY_CALLS: [string, string][] = [['Security (24×7)', '+918041287001'], ['Ambulance 108', '108'], ['Fire 101', '101'], ['National emergency · 112', '112']];

function aiSay(d: Draft<State>, text: string, src: string | null, chips?: string[], calls?: [string, string][], sos?: boolean) {
  d.chat.log.push({ who: 'ai', text, src, chips, calls, sos });
}

export const CATEGORIES = ['Electrical', 'Plumbing', 'Lifts', 'Sanitation', 'HVAC', 'General maintenance'];

export function guessCategory(t: string) {
  t = t.toLowerCase();
  if (t.includes('light') || t.includes('electric') || t.includes('power') || t.includes('bijli')) return 'Electrical';
  if (t.includes('water') || t.includes('leak') || t.includes('seep') || t.includes('tap') || t.includes('paani')) return 'Plumbing';
  if (t.includes('lift') || t.includes('elevator')) return 'Lifts';
  if (t.includes('garbage') || t.includes('dustbin') || t.includes('trash') || t.includes('kachra')) return 'Sanitation';
  if (t.includes('ac ') || t.endsWith(' ac') || t.includes('cooling')) return 'HVAC';
  return 'General maintenance';
}

/* Residents mix languages ("paani kab band hoga"). Before matching an intent, add the English keyword
   for each Hindi / Hinglish / Kannada word we recognise. The resident's own words are kept for drafts. */
const SYNONYMS: [RegExp, string][] = [
  [/\b(paani|pani|neeru)\b|पानी|जल आपूर्ति|ನೀರು/, 'water'],
  [/\b(swimming)\b|स्विमिंग|तरणताल|ಈಜು/, 'pool'],
  [/जिम|ಜಿಮ್/, 'gym'],
  [/\b(gaadi|gaddi)\b|पार्किंग|गाड़ी|ಪಾರ್ಕಿಂಗ್|ವಾಹನ/, 'parking'],
  [/\b(saransh)\b|सारांश|इस हफ्ते|ಸಾರಾಂಶ|ಈ ವಾರ/, 'summarise'],
  [/\b(aag|dhuan)\b|आग|धुआं|ಬೆಂಕಿ|ಹೊಗೆ/, 'fire'],
  [/\b(madad|bachao)\b|मदद|बचाओ|ಸಹಾಯ ಮಾಡಿ|ಕಾಪಾಡಿ/, 'emergency'],
];
function understand(text: string): string {
  const raw = text.toLowerCase();
  let t = raw;
  for (const [re, word] of SYNONYMS) if (re.test(raw)) t += ' ' + word;
  // "my complaint" asks for status; "complaint" alone starts a new report
  if (/\b(meri|mera) (shikayat|complaint)\b|मेरी शिकायत|ನನ್ನ ದೂರು/.test(raw)) t += ' my issue status';
  else if (/\b(shikayat|complaint|samasya)\b|शिकायत|समस्या|ದೂರು|ಸಮಸ್ಯೆ/.test(raw)) t += ' report an issue';
  return t;
}

function showPreview(d: Draft<State>) {
  d.chat.mode = 'issue.preview';
  d.chat.log.push({ who: 'preview', draft: { title: '', desc: '', cat: '', loc: '', pri: 'Medium', ...d.chat.draft } });
}

/** the chat's photo step: the screen picked an image, so attach it and show the preview */
export function attachChatPhoto(d: Draft<State>, uri: string) {
  if (d.chat.mode !== 'issue.photo') return;
  d.chat.draft.photo = uri;
  d.chat.log.push({ who: 'me', text: '📷 Photo added' });
  showPreview(d);
}

/**
 * Connected to the API, questions go to the server's assistant. These stay in the app: the guided
 * issue-report conversation (it is a form, step by step) and the chat's own controls.
 */
export function handledInApp(chat: State['chat'], text: string): boolean {
  if (chat.mode !== 'idle') return true;
  const t = understand(text);
  return (t.includes('report') && t.includes('issue')) || t === 'start over' || t === 'yes, help me rephrase';
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
        c.mode === 'issue.loc' ? places() : c.mode === 'issue.urg' ? URG_CHIPS : DESC_CHIPS);
      if (safety.level === 'block') holdForReview(d, 'AI chat message', text, 'Abusive', 'High',
        'Flagged mid issue-report. Only this excerpt is visible to moderators — the rest of the conversation stays private.', 'Private chat with Community Assistant');
    }
    d.tried.guard = true;
    return;
  }

  const t = understand(text);
  // the same rules as the server (backend lib/assistant.ts): someone stuck in a lift, and numbers only when asked to call them
  const LIFT = /\b(lift|elevator)s?\b|लिफ्ट|ಲಿಫ್ಟ್/, STUCK = /\b(stuck|trapped|phas|phasa|phasi|phans|phansa|phanse|phansi|fasa|fasi|atak|atka|atke|atki)\b|फंस|फँस|अटक|ಸಿಕ್ಕಿ|ಸಿಲುಕಿ/;
  const liftTrap = t.split(/[.?!\n]/).some(x => LIFT.test(x) && STUCK.test(x));
  if (/\b(fire|smoke|gas leak|accident|injured|injury|bleeding|unconscious|emergency|ambulance|intruder|burglar|theft|robbery|trapped)\b/.test(t)
    || /\b(call|dial|ring|phone)\s+(1(01|08|12))\b/.test(t) || liftTrap) {
    aiSay(d, 'Press SOS to alert the security team right now — they see it at the gate at once. If someone is hurt, in danger or stuck in a lift, also call a number below.\n\nI have not contacted any emergency service myself. Once everyone is safe, I can log an issue for the committee.',
      'Community Handbook v3 · §12 Emergency procedure', ['Open the Directory', 'Report an issue', 'Start over'], EMERGENCY_CALLS, true);
    return;
  }

  if (c.mode === 'issue.desc') {
    c.draft.title = text.length > 60 ? text.slice(0, 57) + '…' : text;
    c.draft.desc = text;
    c.draft.cat = guessCategory(t);
    c.mode = 'issue.loc';
    aiSay(d, "Got it — I've categorised this as " + c.draft.cat + '. Where is the problem?', null, places());
  } else if (c.mode === 'issue.loc') {
    c.draft.loc = text;
    c.mode = 'issue.urg';
    aiSay(d, 'And how urgent is it?', null, URG_CHIPS);
  } else if (c.mode === 'issue.urg') {
    c.draft.pri = t.includes('high') ? 'High' : t.includes('low') ? 'Low' : 'Medium';
    c.mode = 'issue.photo';
    aiSay(d, 'Would you like to add a photo? It helps the team fix it faster.', null, [CHIP_PHOTO, CHIP_SKIP_PHOTO]);
  } else if (c.mode === 'issue.photo') {
    // anything other than picking a photo moves on without one
    showPreview(d);
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
    aiSay(d, `Water supply will be paused on ${longDate(3)}, 10:00 AM – 2:00 PM, for pump-room maintenance in Towers 4 and 5. Your tower (T4) is affected — please store water in advance.`,
      `Announcement AN-118 · Admin Office, ${dm(-1)}`, ['Report an issue', 'What are the pool timings?']);
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
      const openPolls = d.polls.filter(p => !pollClosed(p)).length;
      aiSay(d, "Here's your week at Prestige Lakeside:\n• Water shutdown " + ddm(3) + " (Towers 4–5) — store water\n• Sadhya lunch " + ddm(6) + " · Yoga " + ddm(7) + " (" +
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
