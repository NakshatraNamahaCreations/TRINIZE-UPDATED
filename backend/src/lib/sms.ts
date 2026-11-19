import type { Config } from '../config.js';

/** Where one-time codes go. Swapped by SMS_PROVIDER; the rest of the API never knows which. */
export interface SmsProvider {
  sendOtp(phone: string, code: string): Promise<void>;
}

/** development: the code is printed in the server log */
class ConsoleSms implements SmsProvider {
  async sendOtp(phone: string, code: string) {
    console.log(`[sms] OTP for +91 ${phone}: ${code}`);
  }
}

/** tests: codes are kept so a test can read the last one */
export class MemorySms implements SmsProvider {
  sent: { phone: string; code: string }[] = [];
  async sendOtp(phone: string, code: string) {
    this.sent.push({ phone, code });
  }
  last(phone: string) {
    return [...this.sent].reverse().find(m => m.phone === phone)?.code;
  }
}

/**
 * MSG91 OTP API. Needs a DLT-approved sender and template (India). The template should end with the
 * app's SMS Retriever hash so Android can read the code without the resident typing it.
 */
class Msg91Sms implements SmsProvider {
  constructor(private authKey: string, private templateId: string) {}
  async sendOtp(phone: string, code: string) {
    const res = await fetch('https://control.msg91.com/api/v5/otp?' + new URLSearchParams({
      template_id: this.templateId, mobile: '91' + phone, otp: code,
    }), { method: 'POST', headers: { authkey: this.authKey, 'content-type': 'application/json' } });
    if (!res.ok) throw new Error(`MSG91 responded ${res.status}`);
  }
}

export function smsFrom(config: Config): SmsProvider {
  if (config.SMS_PROVIDER === 'msg91') {
    if (!config.MSG91_AUTH_KEY || !config.MSG91_TEMPLATE_ID) throw new Error('MSG91_AUTH_KEY and MSG91_TEMPLATE_ID are required');
    return new Msg91Sms(config.MSG91_AUTH_KEY, config.MSG91_TEMPLATE_ID);
  }
  if (config.SMS_PROVIDER === 'memory') return new MemorySms();
  return new ConsoleSms();
}
