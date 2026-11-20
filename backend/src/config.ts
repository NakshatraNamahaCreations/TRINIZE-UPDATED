import { z } from 'zod';

/** Every setting comes from the environment and is checked once, at start-up. */
const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  /** postgres://… for a real server; "pglite" (or empty in tests) for an in-process Postgres */
  DATABASE_URL: z.string().default('pglite'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  CORS_ORIGINS: z.string().default(''),
  SMS_PROVIDER: z.enum(['console', 'msg91', 'memory']).default('console'),
  /** WhatsApp / SMS / email leaving the app. console = written to the server log (no provider connected yet) */
  MESSAGING: z.enum(['console', 'memory', 'off', 'emailjs']).default('console'),
  /** MESSAGING=emailjs: email goes out through EmailJS (dashboard.emailjs.com); WhatsApp and SMS are still only logged */
  EMAILJS_SERVICE_ID: z.string().default(''),
  EMAILJS_TEMPLATE_ID: z.string().default(''),
  EMAILJS_PUBLIC_KEY: z.string().default(''),
  EMAILJS_PRIVATE_KEY: z.string().default(''),
  /** paying dues in the app. off = no gateway connected; mock = a stand-in gateway for development and tests */
  PAYMENTS: z.enum(['off', 'mock']).default('off'),
  MSG91_AUTH_KEY: z.string().default(''),
  MSG91_TEMPLATE_ID: z.string().default(''),
  FIXED_OTP: z.string().regex(/^\d{6}$/).or(z.literal('')).default(''),
  PUBLIC_URL: z.string().default('http://localhost:4000'),
  UPLOAD_DIR: z.string().default('uploads'),
  /** optional: switches the assistant, AI moderation and tone rewrite from built-in rules to an OpenAI GPT model */
  OPENAI_API_KEY: z.string().default(''),
  /** the model that answers residents' questions — quality matters most here */
  AI_MODEL: z.string().default('gpt-5.4-mini'),
  /** the model for the quick, high-volume jobs (moderation on every post, tone rewrite); defaults to AI_MODEL */
  AI_MODEL_FAST: z.string().default('gpt-5.4-nano'),
  /** reasoning effort for models that have it (gpt-5 family and later): none | minimal | low | medium | high. Empty = don't send it. */
  AI_REASONING: z.string().default('low'),
});

export type Config = z.infer<typeof Env> & { fixedOtp: string | null };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const c = Env.parse(env);
  if (c.NODE_ENV === 'production' && c.SMS_PROVIDER !== 'msg91') throw new Error('production must send real SMS (SMS_PROVIDER=msg91)');
  if (c.MESSAGING === 'emailjs' && !(c.EMAILJS_SERVICE_ID && c.EMAILJS_TEMPLATE_ID && c.EMAILJS_PUBLIC_KEY && c.EMAILJS_PRIVATE_KEY))
    throw new Error('MESSAGING=emailjs needs EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, EMAILJS_PUBLIC_KEY and EMAILJS_PRIVATE_KEY');
  if (c.NODE_ENV === 'production' && c.PAYMENTS === 'mock') throw new Error('the stand-in payment gateway (PAYMENTS=mock) must never run in production');
  // a fixed code is a staging convenience — never honoured in production
  return { ...c, fixedOtp: c.NODE_ENV === 'production' || !c.FIXED_OTP ? null : c.FIXED_OTP };
}
