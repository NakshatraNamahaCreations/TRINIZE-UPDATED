import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { loadConfig } from '../config.js';
import { openDb } from './client.js';
import { associations, knowledgeDocs, staffRoles, subscriptions, users, vendors } from './schema.js';
import { DEMO } from './seed.js';
import { GATE_DEMO, seedGate } from './seed-gate.js';
import { seedKnowledge, seedOps } from './seed2.js';

/* npm run db:seed:phases — adds the Phase 3–4 demo data (assistant documents, operator portfolio) to a
   database that was seeded before those phases existed. Safe to run twice: it only fills what's missing. */

const url = loadConfig().DATABASE_URL;
const h = await openDb(url, { migrate: url.startsWith('pglite') });
const [a] = await h.db.select().from(associations).where(eq(associations.name, 'Prestige Lakeside Habitat'));
if (!a) throw new Error('Run `npm run db:seed` first — the demo society is missing.');

const count = async (t: typeof knowledgeDocs | typeof subscriptions) =>
  ((await h.db.select({ n: sql<number>`count(*)::int` }).from(t)) as [{ n: number }])[0].n;

if ((await count(knowledgeDocs)) === 0) { await seedKnowledge(h.db, a.id); console.log('assistant documents added'); }
else console.log('assistant documents already present');
if ((await count(subscriptions)) === 0) { await seedOps(h.db, a.id); console.log('operator portfolio added'); }
else console.log('operator portfolio already present');
// vendors don't sign in: undo the vendor login an earlier build of this script added
const linked = await h.db.select({ id: vendors.id, userId: vendors.userId }).from(vendors).where(isNotNull(vendors.userId));
for (const v of linked) {
  await h.db.update(vendors).set({ userId: null }).where(eq(vendors.id, v.id));
  await h.db.delete(users).where(and(eq(users.id, v.userId!), eq(users.phone, '9811100001')));
}
if (linked.length) console.log('vendor logins removed');

// a Virtual Property Manager for two societies, to show the VPM app
const [hasVpm] = await h.db.select().from(staffRoles).where(eq(staffRoles.role, 'vpm'));
if (!hasVpm) {
  const [existing] = await h.db.select().from(users).where(eq(users.phone, DEMO.vpmPhone));
  const u = existing ?? (await h.db.insert(users).values({ name: 'Imran Qureshi', phone: DEMO.vpmPhone }).returning())[0]!;
  const [meadows] = await h.db.select().from(associations).where(eq(associations.name, 'Green Meadows Villas'));
  await h.db.insert(staffRoles).values([a.id, ...(meadows ? [meadows.id] : [])].map(associationId => ({ userId: u.id, associationId, role: 'vpm' as const, title: 'Property Manager' })));
  console.log('property manager added (' + DEMO.vpmPhone + ')');
} else console.log('property manager already present');
// a guard at the gate, with a little visitor history
const [hasGuard] = await h.db.select().from(staffRoles).where(eq(staffRoles.role, 'guard'));
if (!hasGuard) { await seedGate(h.db, a.id); console.log('gate guard added (' + GATE_DEMO.guardPhone + ')'); }
else console.log('gate guard already present');
// flat sizes and types, so bills can be worked out by area or by type
const sized = await h.db.execute(sql`update units set area = case code when 'T4-1108' then 1450 when 'T1-1503' then 1620 when 'T5-0110' then 980 else 1180 end, flat_type = case when code in ('T4-1108', 'T1-1503') then '3BHK' else '2BHK' end where association_id = ${a.id} and area = 0`);
console.log('flat sizes ' + (((sized as unknown as { rowCount?: number }).rowCount ?? 0) ? 'added' : 'already present'));
await h.close();
