import { pathToFileURL } from 'node:url';
import { hashPassword } from '../lib/crypto.js';
import { createIssue } from '../lib/issues.js';
import type { DB } from './client.js';
import {
  announcements, associations, contacts, events, issueEvents, issues, pollOptions, polls, staffRoles, unitMembers, units, users, vendors,
} from './schema.js';
import { eq } from 'drizzle-orm';
import { seedGate } from './seed-gate.js';
import { seedKnowledge, seedOps } from './seed2.js';

/* The demo society the apps were built around (all people and numbers fictional), dated relative to
   today so a fresh seed never looks stale. Safe to run on an empty database only. */

/** "Thursday 19 November" — notices must say which day they mean */
const longDay = (n: number) => day(n).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
const day = (n: number, h = 0, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); d.setDate(d.getDate() + n); return d; };

export const DEMO = {
  residentPhone: '9876543210', // Ananya Iyer, owner of T4-1108
  tenantPhone: '9845012345', // Karthik Iyer, family member in the same flat
  vpmPhone: '9833300003', // Imran Qureshi, Virtual Property Manager for Prestige Lakeside and Green Meadows
  adminEmail: 'sanjana.rao@prestigelakeside.in', adminPassword: 'Lakeside@2026',
  operatorEmail: 'ravi.kulkarni@trinize.com', operatorPassword: 'Trinize@2026',
};

export async function seed(db: DB) {
  const [a] = await db.insert(associations).values({ name: 'Prestige Lakeside Habitat', short: 'Prestige Lakeside', city: 'Bengaluru' }).returning();
  if (!a) throw new Error('seed failed');
  const aid = a.id;

  const unitRows = await db.insert(units).values([
    ['T4-1108', 'Tower 4', 'Tower 4, Flat 1108'], ['T2-0704', 'Tower 2', 'Tower 2, Flat 0704'], ['T5-0110', 'Tower 5', 'Tower 5, Flat 0110'],
    ['T1-1503', 'Tower 1', 'Tower 1, Flat 1503'], ['T3-0402', 'Tower 3', 'Tower 3, Flat 0402'],
  ].map(([code, tower, label], i) => ({ associationId: aid, code: code!, tower: tower!, label: label!, area: [1450, 1180, 980, 1620, 1180][i]!, flatType: ['3BHK', '2BHK', '2BHK', '3BHK', '2BHK'][i]! }))).returning();
  const unit = (code: string) => unitRows.find(u => u.code === code)!.id;

  const people = await db.insert(users).values([
    { name: 'Ananya Iyer', phone: DEMO.residentPhone },
    { name: 'Karthik Iyer', phone: DEMO.tenantPhone },
    { name: 'Rohit Sharma', phone: '9900112233' },
    { name: 'Neha Iyer', phone: '9900445566' },
    { name: 'Arjun Mehta', phone: '9900778899' },
    { name: 'Sanjana Rao', phone: '9901266431', email: DEMO.adminEmail, passwordHash: await hashPassword(DEMO.adminPassword) },
    { name: 'Ravi Kulkarni', email: DEMO.operatorEmail, passwordHash: await hashPassword(DEMO.operatorPassword) },
  ]).returning();
  const person = (name: string) => people.find(p => p.name === name)!.id;

  await db.insert(unitMembers).values([
    { unitId: unit('T4-1108'), userId: person('Ananya Iyer'), role: 'Owner' },
    { unitId: unit('T4-1108'), userId: person('Karthik Iyer'), role: 'Family' },
    { unitId: unit('T2-0704'), userId: person('Rohit Sharma'), role: 'Owner' },
    { unitId: unit('T5-0110'), userId: person('Neha Iyer'), role: 'Tenant' },
    { unitId: unit('T1-1503'), userId: person('Arjun Mehta'), role: 'Owner' },
    { unitId: unit('T3-0402'), userId: person('Sanjana Rao'), role: 'Owner' },
  ]);
  await db.insert(staffRoles).values([
    { userId: person('Sanjana Rao'), associationId: aid, role: 'admin', title: 'Secretary' },
    { userId: person('Ravi Kulkarni'), associationId: null, role: 'operator', title: 'Platform operator' },
  ]);

  await db.insert(announcements).values([
    { associationId: aid, ref: 'AN-118', title: 'Water supply maintenance', body: `Water supply will be paused on ${longDay(3)} from 10:00 AM to 2:00 PM for pump-room maintenance in Towers 4 and 5. Please store water in advance.`, priority: 'High', audience: 'Towers 4 & 5', requiresAck: true, byName: 'Admin Office', icon: 'water-outline', publishedAt: day(-1, 18) },
    { associationId: aid, ref: 'AN-117', title: 'Plantation drive', body: `Join us near the lakeside walkway at 8:00 AM on ${longDay(6)}. Saplings and tools provided.`, priority: 'Normal', byName: 'Green Committee', icon: 'leaf-outline', publishedAt: day(-2, 10) },
    { associationId: aid, ref: 'AN-115', title: 'New waste segregation rules', body: `Three-bin segregation becomes mandatory from ${longDay(2)}. The updated guide is in the Community Handbook.`, priority: 'Normal', byName: 'Admin Office', icon: 'trash-bin-outline', publishedAt: day(-4, 9) },
  ]);

  await db.insert(events).values([
    { associationId: aid, title: 'Badminton Court Finals', description: 'Season finale — doubles finals followed by prize distribution.', location: 'Indoor court', startsAt: day(1, 18), minutes: 120, capacity: 24, baseGoing: 24, icon: 'tennisball-outline' },
    { associationId: aid, title: 'Yoga by the Lake', description: 'Morning hatha yoga with instructor Meera. Mats provided.', location: 'Lakeside lawn', startsAt: day(7, 7), minutes: 60, capacity: 40, baseGoing: 38, icon: 'body-outline' },
    { associationId: aid, title: 'Community Sadhya Lunch', description: 'Traditional 18-course sadhya on banana leaf. Family seating.', location: 'Community Hall', startsAt: day(6, 12, 30), minutes: 120, capacity: 250, baseGoing: 121, icon: 'restaurant-outline' },
    { associationId: aid, title: 'Annual General Meeting', description: 'FY-27 budget approval and committee elections. One member per unit.', location: 'Community Hall', startsAt: day(15, 10), minutes: 180, capacity: 300, baseGoing: 214, icon: 'business-outline' },
    { associationId: aid, title: 'Society Foundation Day', description: 'Flag hoisting and breakfast.', location: 'Central lawn', startsAt: day(-15, 7, 30), minutes: 90, capacity: 300, baseGoing: 180, icon: 'flag-outline' },
  ]);

  const pollRows = await db.insert(polls).values([
    { associationId: aid, question: 'Best timing for the weekend yoga session?', eligibility: 'all', closesAt: day(9, 23, 59) },
    { associationId: aid, question: 'Approve CCTV upgrade in the play area? (₹1.4L from corpus)', eligibility: 'owners', closesAt: day(11, 23, 59) },
    { associationId: aid, question: 'Festival event budget preference', eligibility: 'all', closesAt: day(-10, 23, 59) },
  ]).returning();
  const opts: [number, string, number][][] = [
    [[0, '7:00 – 8:00 AM', 48], [1, '8:00 – 9:00 AM', 21], [2, '9:00 – 10:00 AM', 11]],
    [[0, 'Yes, approve', 85], [1, 'No, defer', 15]],
    [[0, '₹80K — essentials', 64], [1, '₹1.5L — full programme', 112]],
  ];
  await db.insert(pollOptions).values(pollRows.flatMap((p, i) => opts[i]!.map(([position, label, baseVotes]) => ({ pollId: p.id, position, label, baseVotes }))));

  await db.insert(contacts).values([
    ['committee', 'Col. (Retd.) Vikram Nair', 'President', '+91 98455 71200'], ['committee', 'Sudha Balakrishnan', 'Vice President', '+91 99012 66431'],
    ['committee', 'Sanjana Rao', 'Secretary', '+91 80 4128 7000'], ['committee', 'Girish Prabhu', 'Treasurer', '+91 98867 22190'],
    ['emergency', 'Security Office (24×7)', 'Main gate', '+91 80 4128 7001'], ['emergency', 'Ambulance', 'Government helpline', '108'],
    ['emergency', 'Fire Brigade', 'Government helpline', '101'],
    ['vendors', 'Sunrise Plumbing Co.', 'Plumbing · approved', '+91 98450 22110'], ['vendors', 'GreenLeaf Housekeeping', 'Housekeeping · approved', '+91 97404 88221'],
    ['vendors', 'FixIt Electricals', 'Electrical · approved', '+91 96323 44810'],
  ].map(([group, name, role, phone], position) => ({ associationId: aid, group: group as 'committee', name: name!, role: role!, phone: phone!, position })));

  const vendorRows = await db.insert(vendors).values([
    ['Sunrise Plumbing Co.', 'Plumbing'], ['FixIt Electricals', 'Electrical'], ['GreenLeaf Housekeeping', 'Sanitation'], ['CoolBreeze HVAC', 'HVAC'], ['OTIS AMC', 'Lifts'],
  ].map(([name, category]) => ({ associationId: aid, name: name!, category: category! }))).returning();

  // one open ticket from the demo resident, already with the office and a vendor
  const ananya = person('Ananya Iyer');
  const iss = await createIssue(db, { associationId: aid, reporterId: ananya, reporterName: 'Ananya Iyer', unitId: unit('T4-1108'), title: 'Corridor light flickering — Tower 4, floor 11', category: 'Electrical', location: 'Tower 4 · Floor 11', priority: 'Medium', via: 'form' });
  const fixit = vendorRows.find(v => v.name === 'FixIt Electricals')!.id;
  await db.update(issues).set({ status: 'Assigned', vendorId: fixit }).where(eq(issues.id, iss.id));
  await db.insert(issueEvents).values([
    { issueId: iss.id, status: 'Acknowledged', note: 'Ticket accepted by admin office', byUserId: person('Sanjana Rao') },
    { issueId: iss.id, status: 'Assigned', note: 'FixIt Electricals visit scheduled', byUserId: person('Sanjana Rao') },
  ]);

  await seedKnowledge(db, aid);
  const others = await seedOps(db, aid);

  await seedGate(db, aid);
  return { associationId: aid, ...others };
}

// npm run db:seed
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { loadConfig } = await import('../config.js');
  const { openDb } = await import('./client.js');
  const url = loadConfig().DATABASE_URL;
  const h = await openDb(url, { migrate: url.startsWith('pglite') });
  const r = await seed(h.db);
  console.log('seeded association', r.associationId);
  await h.close();
}
