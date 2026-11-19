import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import type { Config } from '../config.js';
import type { Deps } from '../app.js';
import { userIdFrom } from '../lib/auth.js';
import { badRequest } from '../lib/http.js';

/** what we accept, checked against the file's own first bytes (not the name or the declared type) */
const SIGNATURES: [string, (b: Buffer) => boolean][] = [
  ['jpg', b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['png', b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ['webp', b => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP'],
  ['heic', b => b.subarray(4, 8).toString() === 'ftyp' && /^(heic|heix|mif1|msf1)$/.test(b.subarray(8, 12).toString())],
  // notices, receipts and invoices attached to messages
  ['pdf', b => b.subarray(0, 5).toString() === '%PDF-'],
];

/** Check a file by its own first bytes and keep it; answers with its address. Shared by every route that accepts a file. */
export async function saveUpload(config: Config, buf: Buffer) {
  const ext = SIGNATURES.find(([, test]) => test(buf))?.[0];
  if (!ext) throw badRequest('not_an_image', 'Only JPEG, PNG, WebP or HEIC photos and PDF documents can be attached.');
  const name = `${randomUUID()}.${ext}`;
  await writeFile(join(resolve(config.UPLOAD_DIR), name), buf);
  return { url: `${config.PUBLIC_URL}/files/${name}`, bytes: buf.length };
}

/**
 * Photo upload for issues. Local disk in development; the same route will hand out S3 pre-signed
 * URLs in staging/production, so the apps won't change.
 */
export const uploadRoutes = ({ config }: Deps): FastifyPluginAsync => async app => {
  app.post('/', { config: { rateLimit: { max: 80, timeWindow: '1 minute' } } }, async (req, reply) => {
    await userIdFrom(req, config.JWT_SECRET);
    const file = await req.file();
    if (!file) throw badRequest('no_file', 'Attach a photo.');
    const buf = await file.toBuffer(); // throws past the 8 MB limit
    return reply.status(201).send(await saveUpload(config, buf));
  });
};
