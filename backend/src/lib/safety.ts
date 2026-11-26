/* The abuse guard, on the server so it can't be bypassed from a modified app. Same rules as the app's
   preview check (resident-app/src/store/logic.ts): threats and slurs block; insults aimed at people warn;
   harsh words about a service ("the lift is useless") are a fair complaint. English, Hinglish, Hindi,
   Kannada. Phase 3 adds an LLM pass behind this for what word lists can't catch. */

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

export type Threshold = 'Lenient' | 'Standard' | 'Strict';
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

export function checkSafety(text: string, threshold: Threshold): Safety {
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
