import type { Config } from '../config.js';
import { HttpError } from './http.js';

/* Each person's AI allowance: a few messages a minute (stops rapid-fire sending) and a daily cap (keeps the
   OpenAI bill bounded) that resets at midnight India time. Counted per signed-in person — not per network
   address, so neighbours on the society Wi-Fi or a mobile network that shares one address don't use up each
   other's allowance. Kept in memory: a restart forgives everyone, and with several API servers each counts
   its own share. 0 turns a limit off. */

export type Bucket = 'chat' | 'rewrite' | 'staff';
type Allowance = { perMinute: number; perDay: number };

/** 429 that says how long to wait; the error handler turns `retryAfter` into a Retry-After header */
export class AiLimitError extends HttpError {
  constructor(message: string, public retryAfter: number, public scope: 'minute' | 'day') {
    super(429, 'ai_limit', message);
  }
}

const IST = 5.5 * 3600_000;
/** the India-time calendar day, e.g. "2026-11-24" */
const dayOf = (now: number) => new Date(now + IST).toISOString().slice(0, 10);
/** seconds until the next midnight in India */
const toMidnight = (now: number) => Math.ceil((86_400_000 - ((now + IST) % 86_400_000)) / 1000);

const WORDS: Record<Bucket, { thing: string; things: string }> = {
  chat: { thing: 'message to the assistant', things: 'messages to the assistant' },
  rewrite: { thing: 'rewrite', things: 'rewrites' },
  staff: { thing: 'assistant request', things: 'assistant requests' },
};

export class AiQuota {
  private seen = new Map<string, { day: string; today: number; recent: number[] }>();
  constructor(private limits: Record<Bucket, Allowance>) {}

  static from(c: Config) {
    // tests send many messages from one person on purpose; a test of the limits passes its own AiQuota
    if (c.NODE_ENV === 'test') return new AiQuota({ chat: { perMinute: 0, perDay: 0 }, rewrite: { perMinute: 0, perDay: 0 }, staff: { perMinute: 0, perDay: 0 } });
    return new AiQuota({
      chat: { perMinute: c.AI_CHAT_PER_MINUTE, perDay: c.AI_CHAT_PER_DAY },
      rewrite: { perMinute: c.AI_REWRITE_PER_MINUTE, perDay: c.AI_REWRITE_PER_DAY },
      staff: { perMinute: c.AI_STAFF_PER_MINUTE, perDay: c.AI_STAFF_PER_DAY },
    });
  }

  /** count one use, or throw AiLimitError when this person has used up their allowance */
  take(bucket: Bucket, userId: string, now = Date.now()) {
    const lim = this.limits[bucket];
    const key = bucket + ':' + userId, day = dayOf(now);
    const was = this.seen.get(key);
    const s = was && was.day === day ? was : { day, today: 0, recent: [] as number[] };
    s.recent = s.recent.filter(t => now - t < 60_000);
    const w = WORDS[bucket];
    if (lim.perDay > 0 && s.today >= lim.perDay) {
      const extra = bucket === 'chat' ? ' You can still report an issue, or contact the society office for anything urgent.' : '';
      throw new AiLimitError(`You’ve reached today’s limit of ${lim.perDay} ${w.things}. It resets at midnight.${extra}`, toMidnight(now), 'day');
    }
    if (lim.perMinute > 0 && s.recent.length >= lim.perMinute) {
      const wait = Math.max(1, Math.ceil((60_000 - (now - s.recent[0]!)) / 1000));
      throw new AiLimitError(`That’s a lot of ${w.things} in a short time — please wait ${wait} second${wait === 1 ? '' : 's'} and try again.`, wait, 'minute');
    }
    s.today++;
    s.recent.push(now);
    this.seen.set(key, s);
    // yesterday's counters are never read again: drop them now and then so memory stays small
    if (this.seen.size > 5_000) for (const [k, v] of this.seen) if (v.day !== day) this.seen.delete(k);
  }
}
