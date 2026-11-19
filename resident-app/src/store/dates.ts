/* Demo records are written relative to "day 0" — the day the seed is built — so the app never
   opens on a stale calendar. Persisted stores keep the dates they were created with. */

const DAY = 86_400_000;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const start = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const BASE = start();

/** midnight, `n` days from day 0 (negative = in the past) */
export const day = (n: number) => new Date(BASE.getTime() + n * DAY);
const pad = (x: number) => String(x).padStart(2, '0');

/** "31 Aug" */
export const dm = (n: number) => { const d = day(n); return `${d.getDate()} ${MON[d.getMonth()]}`; };
/** "Mon 31 Aug" */
export const ddm = (n: number) => `${DOW[day(n).getDay()]} ${dm(n)}`;
/** "Monday 31 August" */
export const longDate = (n: number) => { const d = day(n); return `${DOW_LONG[d.getDay()]} ${d.getDate()} ${MON_LONG[d.getMonth()]}`; };
/** "Monday" */
export const weekday = (n: number) => DOW_LONG[day(n).getDay()];
/** "6:00 PM" */
export const hm = (h: number, m = 0) => `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;
/** "28 Aug, 9:12 AM" */
export const stamp = (n: number, h: number, m = 0) => `${dm(n)}, ${hm(h, m)}`;
/** local ISO without zone, "2026-08-31T18:00" — what CommunityEvent.at holds */
export const iso = (n: number, h: number, m = 0) => {
  const d = day(n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(h)}:${pad(m)}`;
};
/** "Sun 30 Aug 2026" */
export const fullDate = (n = 0) => `${ddm(n)} ${day(n).getFullYear()}`;

/** "Sat 21 Nov" for any date */
export const fmtDay = (d: Date) => `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;
/** the next `count` days starting tomorrow — choices for the Suggest-an-event date picker */
export const nextDays = (count: number, from = new Date()) =>
  Array.from({ length: count }, (_, i) => { const d = new Date(from); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + i + 1); return fmtDay(d); });
/** "Mon 16 Nov 2026" for the moment it's called — for stamps recorded at the time of an action */
export const todayStamp = (now = new Date()) => `${fmtDay(now)} ${now.getFullYear()}`;
