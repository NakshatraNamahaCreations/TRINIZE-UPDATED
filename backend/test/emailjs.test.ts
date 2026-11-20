import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { EmailJsMessenger } from '../src/lib/messenger.js';

const keys = { serviceId: 'service_x', templateId: 'template_y', publicKey: 'pub', privateKey: 'priv' };

/** a stand-in for fetch that records the call and answers with the given status/body */
function fakeFetch(status: number, text = 'OK') {
  const calls: { url: string; body: any }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return new Response(text, { status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('EmailJS messenger', () => {
  it('sends email with the template fields and the private key', async () => {
    const { f, calls } = fakeFetch(200);
    const out = await new EmailJsMessenger(keys, f).send('email', 'sec@society.in', { subject: 'Payment reminder: TRZ-1', body: 'Please pay' });
    expect(out.status).toBe('Sent');
    expect(calls[0].url).toBe('https://api.emailjs.com/api/v1.0/email/send');
    expect(calls[0].body).toMatchObject({
      service_id: 'service_x', template_id: 'template_y', user_id: 'pub', accessToken: 'priv',
      template_params: { to_email: 'sec@society.in', subject: 'Payment reminder: TRZ-1', message: 'Please pay' },
    });
  });

  it('reports a refusal as Failed with EmailJS’s reason', async () => {
    const { f } = fakeFetch(403, 'API calls are disabled for non-browser applications');
    const out = await new EmailJsMessenger(keys, f).send('email', 'a@b.in', { subject: 's', body: 'b' });
    expect(out.status).toBe('Failed');
    expect(out.detail).toContain('non-browser');
  });

  it('leaves WhatsApp and SMS to the log', async () => {
    const { f, calls } = fakeFetch(200);
    const out = await new EmailJsMessenger(keys, f).send('sms', '9876543210', { subject: 's', body: 'b' });
    expect(out.status).toBe('Logged');
    expect(calls).toHaveLength(0);
  });

  it('refuses to start without all four EmailJS settings', () => {
    const base = { JWT_SECRET: 'x'.repeat(32), MESSAGING: 'emailjs' };
    expect(() => loadConfig({ ...base, EMAILJS_SERVICE_ID: 's' })).toThrow(/EMAILJS_/);
    expect(loadConfig({ ...base, EMAILJS_SERVICE_ID: 's', EMAILJS_TEMPLATE_ID: 't', EMAILJS_PUBLIC_KEY: 'p', EMAILJS_PRIVATE_KEY: 'k' }).MESSAGING).toBe('emailjs');
  });
});
