import { OpenAiProvider, type Doc } from '../src/lib/ai.js';

/* npm run ai:bench -- <model[:effort]> [more models…]
   Runs the same fixed checks against each model and prints accuracy and speed, so the choice of
   AI_MODEL / AI_MODEL_FAST is made on evidence. Costs a few cents per model. */

const key = process.env.OPENAI_API_KEY;
if (!key) throw new Error('OPENAI_API_KEY is not set');

const TODAY = 'Mon, 16 Nov, 9:00 am';
const DOCS: Doc[] = [
  { title: 'Pool, Gym & Clubhouse Rules 2026', section: 'page 2', body: 'Pool hours are 6:00–9:00 AM and 4:00–8:00 PM. The pool is closed on Mondays for cleaning. The gym is open 5:30 AM – 10:00 PM daily. Children under 12 must be accompanied by an adult at the pool. Clubhouse bookings for private events need three days notice at the society office.' },
  { title: 'Community Handbook v3', section: '§7 Parking', body: 'Visitor parking is in Basement 2, slots V-01 to V-40, and is free for the first 6 hours. Resident parking slots are assigned per unit and cannot be sublet. Car stickers are renewed every April at the society office.' },
  { title: 'Community Handbook v3', section: '§9 Waste', body: 'Waste is segregated into three bins: wet, dry and reject. Wet waste is collected daily before 9:00 AM. Dry waste is collected on Wednesdays and Saturdays. E-waste and bulky items are collected on the first Sunday of each month from the Tower 1 basement.' },
  { title: 'Announcement AN-118', section: 'Water supply maintenance', body: 'Water supply will be paused from 10:00 AM to 2:00 PM for pump-room maintenance in Towers 4 and 5. Please store water in advance. (For: Towers 4 & 5. From Admin Office, published Sun, 15 Nov.) The shutdown is on Thu, 19 Nov.' },
  { title: 'Upcoming events', section: '', body: '- Badminton Court Finals: Tue, 17 Nov, 6:00 pm, Indoor court, capacity 24.\n- Community Sadhya Lunch: Sun, 22 Nov, 12:30 pm, Community Hall, capacity 250.\n- Yoga by the Lake: Mon, 23 Nov, 7:00 am, Lakeside lawn, capacity 40.\n- Annual General Meeting: Tue, 1 Dec, 10:00 am, Community Hall, capacity 300.' },
  { title: 'Open polls', section: '', body: '- Best timing for the weekend yoga session? (closes Wed, 25 Nov)' },
  { title: 'Your issues', section: '', body: '- ISS-1043 Corridor light flickering — Tower 4, floor 11: Assigned, reported Sat, 14 Nov' },
];

type A = { text: string; sources: string[] };
const has = (...parts: (string | RegExp)[]) => (a: A) => parts.every(p => (typeof p === 'string' ? a.text.toLowerCase().includes(p.toLowerCase()) : p.test(a.text)));
const cites = (title: string) => (a: A) => a.sources.some(s => s.startsWith(title));
const all = (...fs: ((a: A) => boolean)[]) => (a: A) => fs.every(f => f(a));

const ANSWERS: [string, (a: A) => boolean][] = [
  ['What are the pool timings, and can my 9 year old go alone?', all(has('6:00', '4:00'), has(/accompan|adult|cannot|can’t|can't|not/i), cites('Pool, Gym'))],
  ['paani kab band hoga?', all(has('10', '2'), has(/19|thu|guru/i), cites('Announcement AN-118'))],
  ['What is the clubhouse wifi password?', a => a.sources.length === 0],
  ['ಒಣ ಕಸ ಯಾವ ದಿನ ತೆಗೆದುಕೊಂಡು ಹೋಗುತ್ತಾರೆ?', all(has('ಬುಧವಾರ', 'ಶನಿವಾರ'), cites('Community Handbook v3 · §9'))],
  ['Which events are on this week?', all(has('Badminton', 'Sadhya'), a => !/yoga|annual general/i.test(a.text), cites('Upcoming events'))],
  ['What is happening with my complaint?', all(has('ISS-1043', 'assigned'), cites('Your issues'))],
  ['How long can my guest park for free?', all(has('6 hours'), cites('Community Handbook v3 · §7'))],
  ['जिम कितने बजे खुलता है?', all(has('5:30'), cites('Pool, Gym'))],
  ['Can I book the clubhouse for a party tomorrow?', has(/three days|3 days/i)],
  ['How much is the monthly maintenance fee?', a => a.sources.length === 0],
];

const MODERATION: [string, 'safe' | 'warn' | 'block'][] = [
  ['Gym AC has not worked for two weeks. Can the office share a repair date?', 'safe'],
  ['The T4 lift is useless, third breakdown this month', 'safe'],
  ['Honestly the new parking rule is ridiculous and nobody asked us', 'safe'],
  ['The family in T2-0704 should be thrown out of this society, nobody wants them here', 'warn'],
  ['Our secretary is pocketing the maintenance money, everyone knows it', 'warn'],
  ['Woh guard ekdum nikamma hai, usko nikaal do', 'warn'],
  ['If that dog comes near my kids again I will poison it and then deal with the owner', 'block'],
  ['Thanks to everyone who helped at the plantation drive!', 'safe'],
];

const REWRITES = ['The T4 lift is useless, third breakdown this month and the committee does nothing!!', 'Whoever keeps parking in slot B2-114 is a shameless idiot. Move your car.'];
const KEEP = [['T4', /third/i], ['B2-114', /park/i]] as const;

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

async function bench(spec: string) {
  const [model, effort = ''] = spec.split(':');
  const ai = new OpenAiProvider(key!, model!, model!, effort);
  const timed = async <T>(f: () => Promise<T>) => { const t0 = Date.now(); const out = await f(); return { out, ms: Date.now() - t0 }; };

  const ans = await Promise.all(ANSWERS.map(([q]) => timed(() => ai.answer(q, { docs: DOCS, today: TODAY, history: [] }))));
  const mod = await Promise.all(MODERATION.map(([t]) => timed(() => ai.moderate(t))));
  const rew = await Promise.all(REWRITES.map(t => timed(() => ai.rewrite(t, 'Polite'))));

  const ansFail = ANSWERS.flatMap(([q, ok], i) => (ans[i]!.out && ok(ans[i]!.out!) ? [] : [`    ✗ ${q}\n        → ${ans[i]!.out ? ans[i]!.out!.text.slice(0, 140).replace(/\n/g, ' ') + '  [' + ans[i]!.out!.sources.join(' | ') + ']' : '(no reply)'}`]));
  const modFail = MODERATION.flatMap(([t, want], i) => (mod[i]!.out?.level === want ? [] : [`    ✗ wanted ${want}, got ${mod[i]!.out?.level ?? 'none'}: ${t.slice(0, 70)}`]));
  const rewFail = REWRITES.flatMap((t, i) => {
    const r = rew[i]!.out ?? '';
    const ok = r.includes(KEEP[i]![0]) && KEEP[i]![1].test(r) && !/useless|idiot|shameless/i.test(r) && r.length < t.length * 2.5;
    return ok ? [] : [`    ✗ rewrite: ${r.slice(0, 160).replace(/\n/g, ' ')}`];
  });

  console.log(`\n${spec.padEnd(22)} answers ${ANSWERS.length - ansFail.length}/${ANSWERS.length}  moderation ${MODERATION.length - modFail.length}/${MODERATION.length}  rewrite ${REWRITES.length - rewFail.length}/${REWRITES.length}` +
    `   median: answer ${median(ans.map(x => x.ms))} ms · moderation ${median(mod.map(x => x.ms))} ms · rewrite ${median(rew.map(x => x.ms))} ms`);
  [...ansFail, ...modFail, ...rewFail].forEach(l => console.log(l));
}

const specs = process.argv.slice(2);
if (!specs.length) throw new Error('usage: npm run ai:bench -- gpt-4o-mini gpt-5-mini:low …');
for (const s of specs) await bench(s).catch(e => console.log(`\n${s}: failed — ${e instanceof Error ? e.message : e}`));
