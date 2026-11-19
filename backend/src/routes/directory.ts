import { and, asc, eq, sql } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Deps } from '../app.js';
import type { DB } from '../db/client.js';
import { contacts, vendors, type StaffRole } from '../db/schema.js';
import { audit } from '../lib/audit.js';
import { staffOf, userIdFrom } from '../lib/auth.js';
import { conflict, notFound, parse } from '../lib/http.js';

const GROUPS = ['committee', 'emergency', 'vendors'] as const;
type Group = (typeof GROUPS)[number];
const GROUP_NAME: Record<Group, string> = { committee: 'Managing committee', emergency: 'Emergency', vendors: 'Approved vendors' };
const Aid = z.object({ aid: z.uuid() });
const AidId = Aid.extend({ id: z.uuid() });
const Contact = { name: z.string().trim().min(2).max(80), role: z.string().trim().max(60).default(''), phone: z.string().trim().min(3).max(24).regex(/^[0-9+() -]+$/, 'A phone number has digits, spaces, + ( ) and - only') };

/** the helplines every society's residents need on day one; the admin adds the security office and the rest */
export const DEFAULT_CONTACTS: [Group, string, string, string][] = [
  ['emergency', 'Ambulance', 'Government helpline', '108'],
  ['emergency', 'Fire Brigade', 'Government helpline', '101'],
  ['emergency', 'Police', 'Government helpline', '100'],
];
export const defaultContacts = (associationId: string) => DEFAULT_CONTACTS.map(([group, name, role, phone], position) => ({ associationId, group, name, role, phone, position }));

/**
 * The residents' Directory — the committee, the emergency numbers and the approved vendors — kept by the society office.
 * The same emergency numbers are what the app's Emergency screen offers to call.
 *   GET    /v1/admin/:aid/directory                   every contact, in the order residents see them
 *   POST   /v1/admin/:aid/directory                   add one
 *   PUT    /v1/admin/:aid/directory/:id               change it
 *   POST   /v1/admin/:aid/directory/:id/move          one place up or down within its group
 *   DELETE /v1/admin/:aid/directory/:id
 *   POST   /v1/admin/:aid/directory/import-vendors    copy the active vendors from Maintenance that are not listed yet
 */
export const directoryRoutes = ({ config, db }: Deps): FastifyPluginAsync => async app => {
  const staff = async (req: FastifyRequest, roles: StaffRole[] = ['admin', 'operator']) => {
    const { aid } = parse(Aid, req.params);
    return { aid, s: await staffOf(db, await userIdFrom(req, config.JWT_SECRET), aid, roles) };
  };
  const list = (aid: string, tx: Pick<DB, 'select'> = db) => tx.select({ id: contacts.id, group: contacts.group, name: contacts.name, role: contacts.role, phone: contacts.phone, position: contacts.position })
    .from(contacts).where(eq(contacts.associationId, aid)).orderBy(asc(contacts.position), asc(contacts.name));
  const one = async (aid: string, id: string) => {
    const [c] = await db.select().from(contacts).where(and(eq(contacts.id, id), eq(contacts.associationId, aid)));
    if (!c) throw notFound('That contact');
    return c;
  };
  const nextPosition = async (aid: string, tx: Pick<DB, 'select'> = db) =>
    ((await tx.select({ n: sql<number>`coalesce(max(${contacts.position}), -1)::int` }).from(contacts).where(eq(contacts.associationId, aid)))[0]?.n ?? -1) + 1;

  app.get('/admin/:aid/directory', async req => { const { aid } = await staff(req, ['admin', 'committee', 'operator']); return list(aid); });

  app.post('/admin/:aid/directory', async (req, reply) => {
    const { aid, s } = await staff(req);
    const b = parse(z.object({ group: z.enum(GROUPS), ...Contact }), req.body);
    const [dup] = await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.associationId, aid), eq(contacts.group, b.group), sql`lower(${contacts.name}) = ${b.name.toLowerCase()}`));
    if (dup) throw conflict('already_listed', `${b.name} is already listed under ${GROUP_NAME[b.group]}.`);
    const [c] = await db.insert(contacts).values({ associationId: aid, ...b, position: await nextPosition(aid) }).returning();
    await audit(db, aid, s.userId, s.name, `directory · added ${b.name} to ${GROUP_NAME[b.group]}`);
    return reply.status(201).send(c);
  });

  app.put('/admin/:aid/directory/:id', async req => {
    const { aid, s } = await staff(req);
    const { id } = parse(AidId, req.params);
    const b = parse(z.object(Contact), req.body);
    const cur = await one(aid, id);
    const [c] = await db.update(contacts).set(b).where(eq(contacts.id, id)).returning();
    await audit(db, aid, s.userId, s.name, `directory · updated ${cur.name}`);
    return c;
  });

  /** swap places with the neighbour above or below in the same group */
  app.post('/admin/:aid/directory/:id/move', async req => {
    const { aid } = await staff(req);
    const { id } = parse(AidId, req.params);
    const { dir } = parse(z.object({ dir: z.enum(['up', 'down']) }), req.body);
    const cur = await one(aid, id);
    const group = (await list(aid)).filter(c => c.group === cur.group);
    const at = group.findIndex(c => c.id === id), other = group[at + (dir === 'up' ? -1 : 1)];
    if (other) {
      // positions can tie in older data, so give the whole group a clean order with the two swapped
      const order = [...group];
      order[at] = other; order[at + (dir === 'up' ? -1 : 1)] = group[at]!;
      const base = Math.min(...group.map(c => c.position));
      await db.transaction(async tx => { for (const [i, c] of order.entries()) await tx.update(contacts).set({ position: base + i }).where(eq(contacts.id, c.id)); });
    }
    return list(aid);
  });

  app.delete('/admin/:aid/directory/:id', async (req, reply) => {
    const { aid, s } = await staff(req);
    const { id } = parse(AidId, req.params);
    const cur = await one(aid, id);
    await db.delete(contacts).where(eq(contacts.id, id));
    await audit(db, aid, s.userId, s.name, `directory · removed ${cur.name} from ${GROUP_NAME[cur.group]}`);
    return reply.status(204).send();
  });

  app.post('/admin/:aid/directory/import-vendors', async req => {
    const { aid, s } = await staff(req);
    const added = await db.transaction(async tx => {
      const have = new Set((await list(aid, tx)).filter(c => c.group === 'vendors').map(c => c.name.toLowerCase()));
      const fresh = (await tx.select({ name: vendors.name, category: vendors.category, phone: vendors.phone, active: vendors.active }).from(vendors).where(eq(vendors.associationId, aid)).orderBy(asc(vendors.name)))
        .filter(v => v.active && v.phone.trim() && !have.has(v.name.toLowerCase()));
      if (!fresh.length) return 0;
      const start = await nextPosition(aid, tx);
      await tx.insert(contacts).values(fresh.map((v, i) => ({ associationId: aid, group: 'vendors' as const, name: v.name, role: `${v.category} · approved`, phone: v.phone.trim(), position: start + i })));
      return fresh.length;
    });
    if (added) await audit(db, aid, s.userId, s.name, `directory · ${added} vendor${added === 1 ? '' : 's'} added from Maintenance`);
    return { added, contacts: await list(aid) };
  });
};
