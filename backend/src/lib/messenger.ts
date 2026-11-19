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

export function messengerFrom(config: Config): Messenger {
  return config.MESSAGING === 'memory' ? new MemoryMessenger() : config.MESSAGING === 'off' ? new OffMessenger() : new ConsoleMessenger();
}
