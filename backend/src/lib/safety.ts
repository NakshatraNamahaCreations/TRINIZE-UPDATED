/* The abuse guard, on the server so it can't be bypassed from a modified app. Same rules as the app's
   preview check (resident-app/src/store/logic.ts): threats and slurs block; insults aimed at people warn;
   harsh words about a service ("the lift is useless") are a fair complaint. English, Hinglish, Hindi,
   Kannada. Phase 3 adds an LLM pass behind this for what word lists can't catch. */

const BLOCK_WORDS = ['kill', 'die', 'hate you', 'bastard', 'bloody fool', 'scum', 'harami', 'kamina', 'kameena', 'हरामी', 'कमीना', 'ಬೇವರ್ಸಿ'];
const INSULTS = [
  'idiot', 'idiots', 'stupid', 'dumb', 'shameless', 'freeloader', 'freeloaders',
  'scammer', 'scammers', 'scam artist', 'fraud', 'fraudster', 'cheat', 'cheater', 'thief', 'thieves', 'liar', 'liars', 'crook', 'crooks',
  'bewakoof', 'pagal', 'chor', 'gadha', 'बेवकूफ', 'पागल', 'चोर', 'गधा', 'ಮೂರ್ಖ', 'ಕಳ್ಳ', 'ಹುಚ್ಚ',
];
const HARSH = ['useless', 'nonsense', 'pathetic', 'joke', 'worst', 'bekaar', 'bakwas', 'बेकार', 'बकवास', 'ಕೆಲಸಕ್ಕೆ ಬಾರದ'];
const SERVICE = /\b(lifts?|elevators?|lights?|water|pumps?|power|electricity|generator|gym|pool|ac|parking|garbage|cctv|internet|wifi|wi-fi|service|maintenance|drains?|roads?|gates?|intercom|app|repairs?|plumbing|cleaning|housekeeping|supply)\b/;
const PEOPLE = /\b(you|he|she|they|him|her|them|his|guards?|watchman|committee|president|secretary|treasurer|admin|manager|staff|people|neighbou?rs?|members?)\b/;

export type Threshold = 'Lenient' | 'Standard' | 'Strict';
export type Safety = { level: 'safe' | 'warn' | 'block'; words: string[] };

const latin = /^[a-z -]+$/;
const hits = (t: string, list: string[]) =>
  list.filter(w => (latin.test(w) ? new RegExp('[^a-z]' + w.replace(/ /g, '\\s+') + '[^a-z]').test(t) : t.includes(w)));

export function checkSafety(text: string, threshold: Threshold): Safety {
  const t = ' ' + text.toLowerCase() + ' ';
  const block = hits(t, BLOCK_WORDS);
  if (block.length) return { level: 'block', words: block };
  const insults = hits(t, INSULTS);
  const aboutService = SERVICE.test(t) && !PEOPLE.test(t);
  const harsh = threshold === 'Lenient' || (threshold === 'Standard' && aboutService) ? [] : hits(t, HARSH);
  const words = [...insults, ...harsh];
  if (words.length) return { level: threshold === 'Strict' ? 'block' : 'warn', words };
  return { level: 'safe', words: [] };
}
