import type { Config } from '../config.js';
import type { DeliveryStatus } from '../db/schema.js';

/* The channels that leave the app: WhatsApp, SMS and email. Each needs an outside account
   (WhatsApp Business API, a DLT-registered SMS sender, a mail service). Until one is connected the
   message is written to the server log and recorded as "Logged", never as sent. */

export type Outside = 'whatsapp' | 'sms' | 'email';
export type Outcome = { status: DeliveryStatus; detail: string };
export interface Messenger {
  /** `to` is a 10-digit mobile number for whatsapp/sms and an address for email */
  send(channel: Outside, to: string, m: { subject: string; body: string; attachmentUrl?: string | null }): Promise<Outcome>;
}

const NAMES: Record<Outside, string> = { whatsapp: 'WhatsApp', sms: 'SMS', email: 'Email' };

/** development: nothing leaves the machine */
class ConsoleMessenger implements Messenger {
  async send(channel: Outside, to: string, m: { subject: string; body: string }): Promise<Outcome> {
    console.log(`[${channel}] to ${to.replace(/^(.{2}).*(.{2})$/, '$1…$2')} · ${m.subject}`);
    return { status: 'Logged', detail: `${NAMES[channel]} provider not connected — written to the server log` };
  }
}

/** tests: messages are kept so a test can read them; an address containing "bounce" fails like a real refusal */
export class MemoryMessenger implements Messenger {
  sent: { channel: Outside; to: string; subject: string; body: string }[] = [];
  async send(channel: Outside, to: string, m: { subject: string; body: string }): Promise<Outcome> {
    if (to.includes('bounce')) return { status: 'Failed', detail: 'The provider refused this address' };
    this.sent.push({ channel, to, subject: m.subject, body: m.body });
    return { status: 'Sent', detail: '' };
  }
}

class OffMessenger implements Messenger {
  async send(channel: Outside): Promise<Outcome> {
    return { status: 'Skipped', detail: `${NAMES[channel]} is switched off on this server` };
  }
}

/**
 * Email through EmailJS's REST API; WhatsApp and SMS still go to the log until they have providers.
 * The EmailJS template must use {{to_email}} as its "To Email", {{subject}} as its subject and {{message}}
 * as its content ({{attachment_url}} is also passed). EmailJS only accepts server calls when
 * Account → Security → "Allow EmailJS API for non-browser applications" is switched on.
 */
export class EmailJsMessenger implements Messenger {
  private log = new ConsoleMessenger();
  constructor(private c: { serviceId: string; templateId: string; publicKey: string; privateKey: string }, private post: typeof fetch = fetch) {}
  async send(channel: Outside, to: string, m: { subject: string; body: string; attachmentUrl?: string | null }): Promise<Outcome> {
    if (channel !== 'email') return this.log.send(channel, to, m);
    try {
      const res = await this.post('https://api.emailjs.com/api/v1.0/email/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          service_id: this.c.serviceId, template_id: this.c.templateId, user_id: this.c.publicKey, accessToken: this.c.privateKey,
          template_params: { to_email: to, subject: m.subject, message: m.body, attachment_url: m.attachmentUrl ?? '' },
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) return { status: 'Sent', detail: 'Sent through EmailJS' };
      const why = (await res.text().catch(() => '')).trim().slice(0, 200);
      console.error(`[email] EmailJS refused (${res.status}): ${why}`);
      return { status: 'Failed', detail: `EmailJS refused it (${res.status})${why ? ': ' + why : ''}` };
    } catch (e) {
      console.error('[email] EmailJS unreachable:', (e as Error).message);
      return { status: 'Failed', detail: 'Could not reach EmailJS' };
    }
  }
}

export function messengerFrom(config: Config): Messenger {
  if (config.MESSAGING === 'emailjs') return new EmailJsMessenger({ serviceId: config.EMAILJS_SERVICE_ID, templateId: config.EMAILJS_TEMPLATE_ID, publicKey: config.EMAILJS_PUBLIC_KEY, privateKey: config.EMAILJS_PRIVATE_KEY });
  return config.MESSAGING === 'memory' ? new MemoryMessenger() : config.MESSAGING === 'off' ? new OffMessenger() : new ConsoleMessenger();
}
