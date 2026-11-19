import { createHash, createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const sixDigits = () => String(randomInt(0, 1_000_000)).padStart(6, '0');

/** OTPs are stored keyed to the phone and the server secret, so a leaked table can't be replayed */
export const hashOtp = (secret: string, phone: string, code: string) =>
  createHmac('sha256', secret).update(phone + ':' + code).digest('hex');

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
export const opaqueToken = () => randomBytes(32).toString('base64url');

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** staff passwords: scrypt with a per-password salt, stored as "scrypt$salt$hash" */
export async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  const key = await scryptAsync(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string | null) {
  if (!stored) return false;
  const [kind, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const key = await scryptAsync(pw, Buffer.from(salt, 'base64'), 64);
  return timingSafeEqual(key, Buffer.from(hash, 'base64'));
}
