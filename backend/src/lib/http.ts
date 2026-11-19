import type { z } from 'zod';

/** Errors the apps can act on: a stable `code` plus a human message. */
export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export const badRequest = (code: string, msg: string) => new HttpError(400, code, msg);
export const unauthorized = (msg = 'Sign in again.') => new HttpError(401, 'unauthorized', msg);
/** an update that changes nothing is a mistake by the caller, said so plainly — not left for the database to choke on */
export function changes<T extends object>(patch: T): T {
  if (!Object.values(patch).some(v => v !== undefined)) throw badRequest('nothing_to_change', 'Send at least one thing to change.');
  return patch;
}
export const forbidden = (msg = 'You don’t have access to this.') => new HttpError(403, 'forbidden', msg);
export const notFound = (what = 'That') => new HttpError(404, 'not_found', `${what} wasn’t found.`);
export const conflict = (code: string, msg: string) => new HttpError(409, code, msg);

/** Validate a body / params / query against a zod schema, or answer 400 with the first problem. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const i = r.error.issues[0];
    throw badRequest('invalid_input', i ? `${i.path.join('.') || 'input'}: ${i.message}` : 'Invalid input');
  }
  return r.data;
}
