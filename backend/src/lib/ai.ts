import OpenAI from 'openai';
import { z } from 'zod';
import type { Config } from '../config.js';
import type { Safety } from './safety.js';
import type { UsageSink } from './usage.js';

/* The AI features, behind one interface. With OPENAI_API_KEY set they run on an OpenAI GPT model;
   without it `enabled` is false and callers fall back to the built-in rules, so the API works either way. */

export type Doc = { title: string; section: string; body: string };
export type Answer = { text: string; sources: string[] };

export interface Ai {
  enabled: boolean;
  /** a second opinion on text the word lists passed; null = no opinion (AI off or unavailable) */
  moderate(text: string): Promise<Safety | null>;
  /** answer strictly from the given documents and records; null = unavailable */
  answer(question: string, context: { docs: Doc[]; today: string; history: { role: 'user' | 'assistant'; text: string }[] }): Promise<Answer | null>;
  /** the same message in another tone, facts intact; null = unavailable */
  rewrite(text: string, tone: string): Promise<string | null>;
  /** free text from instructions and material — summaries, drafts, answers for staff; null = unavailable */
  compose(system: string, user: string): Promise<string | null>;
  /** a reply in a fixed shape, optionally looking at photos; null = unavailable or off-shape */
  extract<T>(o: { name: string; schema: object; check: z.ZodType<T>; system: string; user: string; images?: string[] }): Promise<T | null>;
  /** where each model call's token counts are reported (see lib/usage.ts); providers without a bill ignore it */
  setUsageSink?(sink: UsageSink): void;
}

export const noAi: Ai = { enabled: false, moderate: async () => null, answer: async () => null, rewrite: async () => null, compose: async () => null, extract: async () => null };

/* The model must reply in these shapes (JSON-schema structured output); zod checks what comes back. */
const Verdict = z.object({ level: z.enum(['safe', 'warn', 'block']), phrases: z.array(z.string()) });
const VERDICT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['level', 'phrases'],
  properties: { level: { type: 'string', enum: ['safe', 'warn', 'block'] }, phrases: { type: 'array', items: { type: 'string' } } },
} as const;

const Reply = z.object({ answer: z.string(), sources: z.array(z.string()), found: z.boolean() });
const REPLY_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['answer', 'sources', 'found'],
  properties: {
    answer: { type: 'string' },
    sources: { type: 'array', items: { type: 'string' }, description: 'Titles of the documents actually used; empty when the answer is not in them.' },
    found: { type: 'boolean' },
  },
} as const;

const MODERATION = `You moderate messages in a residential society's community app in India: posts, replies, thank-you notes, and messages residents type to the Community Assistant. Residents write in English, Hindi, Kannada, Tamil, Telugu, Malayalam, Marathi or Bengali - in their own script or in Latin letters - and often mix them (Hinglish, Kanglish, Tanglish). Judge the meaning in whatever language it is written, including disguised spellings ("f*ck", "l0ser", "b c").

Classify one message:
- "block": profanity and sexual slurs in any language, threats, wishing harm, caste or religious slurs, sexual harassment, doxxing, or calls for harm.
- "warn": a rude, insulting or contemptuous message aimed at a person or group - a neighbour, guard, staff, the office, the committee, or the assistant itself - even without any swear word. For example: name-calling (idiot, loafer, nalayak, loosu), accusations (scammer, thief), commands and put-downs ("shut up", "do your job", "get lost", "are you blind?", "nobody cares what you think", "who do you think you are"), mocking or shaming ("sharam karo", "baayi muchko"), or shouting at someone in capitals.
- "safe": everything else. Polite or neutral messages are safe. Frustrated complaints about services, facilities or decisions are safe even when blunt ("the lift is useless", "third time this month", "water has not come since morning").

The line is between attacking or disrespecting people and criticising things. When unsure between safe and warn, choose safe.
In "phrases", quote the exact words that caused a warn or block, as written; leave it empty for safe.`;

const ASSISTANT = `You are the Community Assistant inside a residential society's app. You answer residents' questions about their own society.

Ground rules:
- Answer only from the documents provided in the user turn. They are the society's approved information and live records (notices, events, polls, the resident's own issues).
- The user turn gives today's date. Use it for anything about "today", "tomorrow", "this week" or "next week" - a week runs Monday to Sunday.
- Never assume when something happens. If a notice or record does not state its date or day, give what it does say and add that the date is not stated - do not treat it as today.
- If the answer is not there, set "found" to false and say you couldn't find it in the approved community information and that the society office can help. Do not guess, and do not use outside knowledge about rules, timings, fees or contacts.
- Reply in the language the resident wrote in (English, Hindi, Kannada, or Hinglish in Latin script).
- Keep it short: the answer first, then any detail the resident needs to act on it. Plain text, no markdown.
- You cannot post, create issues, or contact anyone. If asked to, say the resident can do it from the app.
- In "sources", list only the titles of the documents your answer actually came from, copied exactly. One or two is normal.`;

/** identical text gets the same verdict — a repost or a retry shouldn't cost a second call */
const VERDICT_CACHE_MAX = 500;

export class OpenAiProvider implements Ai {
  enabled = true;
  private client: OpenAI;
  private verdicts = new Map<string, Safety>();
  private sink: UsageSink | null = null;
  setUsageSink(sink: UsageSink) { this.sink = sink; }
  /** report what a call used — a refused or off-shape reply is still billed, so this runs before the reply is checked */
  private async track(feature: string, model: string, res: { usage?: OpenAI.CompletionUsage | null }) {
    const u = res.usage;
    if (!this.sink || !u) return;
    await this.sink({ feature, model, inputTokens: u.prompt_tokens ?? 0, cachedInputTokens: u.prompt_tokens_details?.cached_tokens ?? 0, outputTokens: u.completion_tokens ?? 0 });
  }
  /** `model` answers questions; `fast` handles moderation and rewrite; `effort` is sent only when set */
  constructor(apiKey: string, private model: string, private fast: string = model, private effort: string = '') {
    this.client = new OpenAI({ apiKey });
  }
  /** reasoning effort goes only to models that have it — the gpt-4 family rejects the parameter */
  private extra(model: string) {
    return this.effort && !/^gpt-4/.test(model) ? { reasoning_effort: this.effort as OpenAI.ReasoningEffort } : {};
  }

  /** one structured-output call; null when the model refused, was cut off, or returned something off-schema */
  private async structured<T>(model: string, limits: { timeout: number; maxRetries: number }, name: string, schema: object, check: z.ZodType<T>, messages: OpenAI.Chat.ChatCompletionMessageParam[]): Promise<T | null> {
    const res = await this.client.chat.completions.create({
      model,
      messages,
      ...this.extra(model),
      response_format: { type: 'json_schema', json_schema: { name, strict: true, schema: schema as Record<string, unknown> } },
    }, limits);
    await this.track(name === 'verdict' ? 'moderate' : name === 'reply' ? 'answer' : 'extract:' + name, model, res);
    const msg = res.choices[0]?.message;
    if (!msg || msg.refusal || !msg.content) return null;
    try {
      const parsed = check.safeParse(JSON.parse(msg.content));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  async moderate(text: string): Promise<Safety | null> {
    try {
      // a refusal or an unparseable reply is "no opinion": the word lists already ran
      const key = text.trim().toLowerCase().replace(/\s+/g, ' ');
      const known = this.verdicts.get(key);
      if (known) return known;
      // posting waits on this, so it gets a short leash: 8 seconds, one retry, then the word lists' verdict stands
      const v = await this.structured(this.fast, { timeout: 8_000, maxRetries: 1 }, 'verdict', VERDICT_SCHEMA, Verdict, [{ role: 'system', content: MODERATION }, { role: 'user', content: text }]);
      if (!v) return null;
      const verdict: Safety = { level: v.level, words: v.phrases.slice(0, 5) };
      if (this.verdicts.size >= VERDICT_CACHE_MAX) this.verdicts.delete(this.verdicts.keys().next().value!);
      this.verdicts.set(key, verdict);
      return verdict;
    } catch (e) {
      this.log('moderate', e);
      return null;
    }
  }

  async answer(question: string, ctx: { docs: Doc[]; today: string; history: { role: 'user' | 'assistant'; text: string }[] }): Promise<Answer | null> {
    const titleOf = (d: Doc) => d.title + (d.section ? ' · ' + d.section : '');
    const library = ctx.docs.map(d => `<document title="${titleOf(d)}">\n${d.body}\n</document>`).join('\n\n');
    try {
      const out = await this.structured(this.model, { timeout: 25_000, maxRetries: 2 }, 'reply', REPLY_SCHEMA, Reply, [
        { role: 'system', content: ASSISTANT },
        ...ctx.history.map(m => ({ role: m.role, content: m.text })),
        { role: 'user', content: `<documents>\n${library || '(none)'}\n</documents>\n\nToday is ${ctx.today}.\n\nResident's question: ${question}` },
      ]);
      if (!out) return null;
      // a source the model names must be one we actually gave it — an invented citation is dropped
      const known = new Set(ctx.docs.map(titleOf));
      return { text: out.answer, sources: out.found ? out.sources.filter(s => known.has(s)) : [] };
    } catch (e) {
      this.log('answer', e);
      return null;
    }
  }

  async rewrite(text: string, tone: string): Promise<string | null> {
    try {
      const res = await this.client.chat.completions.create({
        model: this.fast,
        ...this.extra(this.fast),
        messages: [
          { role: 'system', content: `Rewrite a resident's message for their society's community feed in a ${tone} tone. Keep every fact exactly: names, places, flat and tower numbers, dates, counts and what was asked for. Remove insults and hostility, keep the complaint. Same language as the original. About the same length as the original — a community post, not a letter: no greeting line, no sign-off. Reply with the rewritten message only.` },
          { role: 'user', content: text },
        ],
      }, { timeout: 15_000, maxRetries: 1 });
      await this.track('rewrite', this.fast, res);
      const msg = res.choices[0]?.message;
      if (!msg || msg.refusal) return null;
      return msg.content?.trim() || null;
    } catch (e) {
      this.log('rewrite', e);
      return null;
    }
  }

  async compose(system: string, user: string): Promise<string | null> {
    try {
      const res = await this.client.chat.completions.create({ model: this.model, ...this.extra(this.model), messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }, { timeout: 30_000, maxRetries: 1 });
      await this.track('compose', this.model, res);
      const msg = res.choices[0]?.message;
      return !msg || msg.refusal ? null : msg.content?.trim() || null;
    } catch (e) {
      this.log('compose', e);
      return null;
    }
  }

  async extract<T>(o: { name: string; schema: object; check: z.ZodType<T>; system: string; user: string; images?: string[] }): Promise<T | null> {
    try {
      // photos go in as data URLs, so files on this server never need a public address
      const content: OpenAI.Chat.ChatCompletionContentPart[] = [{ type: 'text', text: o.user }, ...(o.images ?? []).map(url => ({ type: 'image_url' as const, image_url: { url, detail: 'low' as const } }))];
      return await this.structured(o.images?.length ? this.model : this.fast, { timeout: 30_000, maxRetries: 1 }, o.name, o.schema, o.check, [{ role: 'system', content: o.system }, { role: 'user', content: o.images?.length ? content : o.user }]);
    } catch (e) {
      this.log(o.name, e);
      return null;
    }
  }

  private log(what: string, e: unknown) {
    if (e instanceof OpenAI.RateLimitError) console.warn(`[ai] ${what}: rate limited — falling back to rules`);
    else if (e instanceof OpenAI.AuthenticationError) console.error(`[ai] ${what}: OPENAI_API_KEY was rejected`);
    else if (e instanceof OpenAI.NotFoundError) console.error(`[ai] ${what}: model "${this.model}" isn't available to this key — set AI_MODEL`);
    else if (e instanceof OpenAI.APIError) console.warn(`[ai] ${what}: API error ${e.status} — falling back to rules`);
    else console.warn(`[ai] ${what}: ${e instanceof Error ? e.message : e}`);
  }
}

export function aiFrom(config: Config): Ai {
  return config.OPENAI_API_KEY ? new OpenAiProvider(config.OPENAI_API_KEY, config.AI_MODEL, config.AI_MODEL_FAST || config.AI_MODEL, config.AI_REASONING) : noAi;
}
