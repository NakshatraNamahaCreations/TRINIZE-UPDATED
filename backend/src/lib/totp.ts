import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/* Time-based one-time passwords (RFC 6238) for staff two-step sign-in — works with Google
   Authenticator, Microsoft Authenticator, 1Password and the like. SHA-1, 6 digits, 30-second steps. */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function newSecret(): string {
  const bytes = randomBytes(20);
  let bits = '', out = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i < bits.length; i += 5) out += ALPHABET[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
}

function decode(secret: string): Buffer {
  let bits = '';
  for (const c of secret.replace(/=+$/, '').toUpperCase()) {
    const v = ALPHABET.indexOf(c);
    if (v < 0) throw new Error('invalid base32');
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

export function codeAt(secret: string, time = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 30_000)));
  const h = createHmac('sha1', decode(secret)).update(counter).digest();
  const o = h[h.length - 1]! & 0xf;
  const n = ((h[o]! & 0x7f) << 24) | (h[o + 1]! << 16) | (h[o + 2]! << 8) | h[o + 3]!;
  return String(n % 1_000_000).padStart(6, '0');
}

/** accepts the current code and one step either side, for clocks that are slightly off */
export function verifyCode(secret: string, code: string, time = Date.now()): boolean {
  return [-1, 0, 1].some(step => {
    const expected = Buffer.from(codeAt(secret, time + step * 30_000));
    const given = Buffer.from(code);
    return expected.length === given.length && timingSafeEqual(expected, given);
  });
}

/** what the authenticator app scans */
export const otpauthUrl = (secret: string, account: string) =>
  `otpauth://totp/${encodeURIComponent('Trinize:' + account)}?secret=${secret}&issuer=Trinize&algorithm=SHA1&digits=6&period=30`;
