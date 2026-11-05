import type { Issue, IssueStatus } from '../store/data';

export type TimelineEntry =
  | { kind: 'step'; s: IssueStatus; w: string; n?: string; last?: boolean; ord: number; t: number }
  | { kind: 'internal'; w: string; n: string; ord: number; t: number };

const MONTHS: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };

/** "28 Aug, 2:31 PM" → sortable number; "Just now" sorts last. */
function whenValue(w: string) {
  if (!w || /just now/i.test(w)) return Number.MAX_SAFE_INTEGER;
  const m = /^(\d{1,2})\s+([A-Za-z]{3})(?:,\s*(\d{1,2}):(\d{2})\s*(AM|PM))?/.exec(w.trim());
  if (!m) return 0;
  let h = m[3] ? parseInt(m[3], 10) % 12 : 0;
  if (m[5]?.toUpperCase() === 'PM') h += 12;
  return Date.UTC(2026, MONTHS[m[2]] ?? 0, parseInt(m[1], 10), h, m[4] ? parseInt(m[4], 10) : 0);
}

/** Public steps and internal notes are one record, so show them in real order. */
export function mergeTimeline(i: Issue): TimelineEntry[] {
  const pub: TimelineEntry[] = i.tl.map((t, idx) => ({ kind: 'step', s: t.s, w: t.w, n: t.n, ord: idx, t: whenValue(t.w) }));
  const int: TimelineEntry[] = i.internal.map((t, idx) => ({ kind: 'internal', w: t.w, n: t.n, ord: idx + 0.5, t: whenValue(t.w) }));
  const all = [...pub, ...int].sort((a, b) => (a.t === b.t ? a.ord - b.ord : a.t - b.t));
  for (let k = all.length - 1; k >= 0; k--) {
    const e = all[k];
    if (e.kind === 'step') { e.last = true; break; }
  }
  return all;
}
