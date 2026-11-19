/* The handful of things every resident asks: when is the office open, when can I swim, which day is dry waste.
   Trinize can note them while onboarding a society; each becomes a document the assistant answers from and
   cites ("Society facts · Pool"), which the society's admin can replace later under AI controls. */

export const FACTS = [
  { key: 'office', section: 'Office hours', label: 'Society office hours', hint: 'Mon–Sat, 9:30 AM – 6:00 PM', say: (v: string) => `The society office is open ${v}.` },
  { key: 'pool', section: 'Pool', label: 'Swimming pool timings', hint: '6:00–9:00 AM and 4:00–8:00 PM, closed on Mondays', say: (v: string) => `Swimming pool timings: ${v}.` },
  { key: 'gym', section: 'Gym', label: 'Gym timings', hint: '5:30 AM – 10:00 PM daily', say: (v: string) => `Gym timings: ${v}.` },
  { key: 'clubhouse', section: 'Clubhouse', label: 'Clubhouse / hall timings and booking', hint: '9 AM – 10 PM; book at the office 3 days ahead', say: (v: string) => `Clubhouse and community hall: ${v}.` },
  { key: 'waste', section: 'Waste collection', label: 'Waste collection', hint: 'Wet waste daily before 9 AM; dry waste Wed and Sat', say: (v: string) => `Waste collection: ${v}.` },
  { key: 'parking', section: 'Visitor parking', label: 'Visitor parking', hint: 'Basement 2, slots V-01 to V-40, free for 6 hours', say: (v: string) => `Visitor parking: ${v}.` },
  { key: 'deliveries', section: 'Visitors & deliveries', label: 'Visitor and delivery hours', hint: 'Deliveries 7 AM – 10 PM; guests approved in the app', say: (v: string) => `Visitors and deliveries: ${v}.` },
  { key: 'water', section: 'Water & power', label: 'Water supply and power backup', hint: 'Water 24 hours; generator backup for lifts and common areas', say: (v: string) => `Water supply and power backup: ${v}.` },
  { key: 'other', section: 'Other rules', label: 'Anything else residents should know', hint: 'Quiet hours, pets, moving in and out…', say: (v: string) => v },
] as const;
export type FactKey = (typeof FACTS)[number]['key'];
export const FACTS_TITLE = 'Society facts';

/** the documents to store for whichever facts were filled in */
export function factDocs(associationId: string, facts: Partial<Record<FactKey, string>>) {
  return FACTS.flatMap(f => {
    const v = (facts[f.key] ?? '').trim().replace(/\.+$/, '');
    return v ? [{ associationId, title: FACTS_TITLE, section: f.section, body: f.say(v) }] : [];
  });
}

/** what was typed for a fact, read back out of its stored sentence */
export function factValue(key: FactKey, body: string) {
  const f = FACTS.find(x => x.key === key)!;
  const [pre, post] = f.say('\u0000').split('\u0000') as [string, string];
  return body.startsWith(pre) && body.endsWith(post) ? body.slice(pre.length, body.length - post.length) : body;
}
