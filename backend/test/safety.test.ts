import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEMO } from '../src/db/seed.js';
import { isEmergency, understand } from '../src/lib/assistant.js';
import { safetyFloor } from '../src/lib/issues.js';
import { testApp } from './helpers.js';

let t: Awaited<ReturnType<typeof testApp>>;
let resident: string;
beforeAll(async () => {
  t = await testApp();
  resident = (await t.signIn(DEMO.residentPhone)).accessToken;
});
afterAll(() => t.close());

describe('someone stuck in a lift', () => {
  it('is read as an emergency in English, Hinglish, Hindi and Kannada — and a lift that simply stopped is not', () => {
    for (const q of ['Someone is stuck in the lift in Tower 4', 'lift mein phas gaye hain, help karo', 'Lift me atka hua hai bachcha', 'लिफ्ट में फंस गए हैं', 'ಲಿಫ್ಟ್‌ನಲ್ಲಿ ಸಿಕ್ಕಿ ಹಾಕಿಕೊಂಡಿದ್ದೇವೆ', 'My father is trapped in the elevator', 'call 112']) {
      expect(isEmergency(understand(q)), q).toBe(true);
    }
    // ordinary words that look like the Hinglish ones, and numbers that aren't a call for help
    for (const q of ['Lift not working in Tower 2', 'What are the lift maintenance timings?', 'lift band hai', 'Are the clubhouse fans working?', 'Which phase is the handover?', 'Is flat 112 occupied?', 'Flat 101 has a leak', 'The lift is too fast']) {
      expect(isEmergency(understand(q)), q).toBe(false);
    }
  });

  it('gets SOS first and 112 in the Assistant, never a handbook answer', async () => {
    const r = await t.call('POST', '/v1/assistant/chat', { token: resident, body: { text: 'Someone is stuck in the lift in Tower 4' } });
    expect(r.status).toBe(200);
    expect(r.body.sos).toBe(true);
    expect(r.body.text).toMatch(/^Press SOS/);
    expect(r.body.calls.map((c: [string, string]) => c[1])).toContain('112');
  });

  it('lists 112 on the emergency screen', async () => {
    const r = await t.call('GET', '/v1/emergency', { token: resident });
    expect(r.body.contacts.some((c: { phone: string }) => c.phone === '112')).toBe(true);
  });
});

describe('lift faults are never filed below High', () => {
  it('raises a lift fault to High and someone trapped to Emergency, and leaves other requests alone', () => {
    expect(safetyFloor({ priority: 'Medium', category: 'Lifts', title: 'Lift not working' })).toBe('High');
    expect(safetyFloor({ priority: 'Low', category: 'General maintenance', asset: 'Lift', title: 'Display broken' })).toBe('High');
    expect(safetyFloor({ priority: 'Medium', category: 'Lifts', title: 'Lift stuck between floors', details: 'two people trapped inside' })).toBe('Emergency');
    expect(safetyFloor({ priority: 'Emergency', category: 'Lifts', title: 'Lift not working' })).toBe('Emergency');
    expect(safetyFloor({ priority: 'Medium', category: 'Plumbing', title: 'Tap leaking' })).toBe('Medium');
    // a lift fault that names no one stuck is High, not Emergency
    expect(safetyFloor({ priority: 'Medium', category: 'Lifts', title: 'Lift phase failure' })).toBe('High');
    expect(safetyFloor({ priority: 'Medium', category: 'Lifts', title: 'Lift moving too fast', details: 'the fans in the cabin are off' })).toBe('High');
  });

  it('applies when a resident raises one as Medium, with the faster response time', async () => {
    const r = await t.call('POST', '/v1/issues', { token: resident, body: { title: 'Lift not working', category: 'Lifts', location: 'Tower 4', priority: 'Medium', via: 'form' } });
    expect(r.status).toBe(201);
    expect(r.body.priority ?? r.body.pri).toBe('High');
    const hours = (Date.parse(r.body.slaDueAt) - Date.now()) / 3600e3;
    expect(hours).toBeLessThanOrEqual(24);
  });
});
