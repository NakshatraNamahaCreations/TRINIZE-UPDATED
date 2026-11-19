import type { DB } from './client.js';
import { associations, invoices, knowledgeDocs, opsActivity, staffRoles, subscriptions, supportTickets, usageSnapshots, users, type Plan, type SubState } from './schema.js';

/* Demo data for Phase 3 (the assistant's approved documents) and Phase 4 (the operator's portfolio).
   Fictional, like the rest of the seed, and dated relative to today. */

const day = (n: number) => new Date(Date.now() + n * 864e5);
const month = (back: number) => { const d = new Date(); d.setMonth(d.getMonth() - back); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

export async function seedKnowledge(db: DB, aid: string) {
  await db.insert(knowledgeDocs).values([
    { associationId: aid, title: 'Pool, Gym & Clubhouse Rules 2026', section: 'page 2', body: 'Pool hours are 6:00–9:00 AM and 4:00–8:00 PM. The pool is closed on Mondays for cleaning. The gym is open 5:30 AM – 10:00 PM daily. Children under 12 must be accompanied by an adult at the pool. Clubhouse bookings for private events need three days notice at the society office.' },
    { associationId: aid, title: 'Community Handbook v3', section: '§7 Parking', body: 'Visitor parking is in Basement 2, slots V-01 to V-40, and is free for the first 6 hours. Resident parking slots are assigned per unit and cannot be sublet. Vehicles in another resident’s slot can be reported as an issue. Car stickers are renewed every April at the society office.' },
    { associationId: aid, title: 'Community Handbook v3', section: '§9 Waste', body: 'Waste is segregated into three bins: wet, dry and reject. Wet waste is collected daily before 9:00 AM. Dry waste is collected on Wednesdays and Saturdays. E-waste and bulky items are collected on the first Sunday of each month from the Tower 1 basement.' },
    { associationId: aid, title: 'Community Handbook v3', section: '§12 Emergency procedure', body: 'In a fire, medical or security emergency call the Security Office on +91 80 4128 7001, Ambulance on 108 or the Fire Brigade on 101. Do not use the lifts during a fire. Assembly points are the Central lawn and the Lakeside walkway.' },
    { associationId: aid, title: 'Visitor & Delivery Policy', section: '', body: 'Guests must be pre-approved in the app or confirmed by intercom at the gate. Delivery staff are allowed between 7:00 AM and 10:00 PM. Domestic staff need a gate pass issued by the society office, renewed every year.' },
  ]);
}

export async function seedOps(db: DB, lakesideId: string) {
  type Row = { name: string; short: string; city: string; kind: string; plan: Plan; state: SubState; annual: number; renew: number; plots: number; owners: number; usage: number[]; admin: [string, string] };
  const others: Row[] = [
    { name: 'Green Meadows Villas', short: 'Green Meadows', city: 'Bengaluru', kind: 'Villa', plan: 'Professional', state: 'Active', annual: 12096, renew: 96, plots: 84, owners: 71, usage: [58, 57, 55, 54, 52, 50, 49, 47, 45, 44, 42, 41], admin: ['Bhagya Lakshmi', 'Secretary'] },
    { name: 'Nandi Hills Plotted Layout', short: 'Nandi Hills', city: 'Chikkaballapur', kind: 'Plotted layout', plan: 'Starter', state: 'Trial', annual: 25200, renew: 21, plots: 210, owners: 38, usage: [0, 0, 0, 0, 0, 0, 0, 0, 0, 6, 12, 18], admin: ['Nagesh Gowda', 'Secretary'] },
    { name: 'Lake View Residency', short: 'Lake View', city: 'Mysuru', kind: 'Apartment', plan: 'Starter', state: 'Suspended', annual: 13824, renew: -40, plots: 96, owners: 60, usage: [40, 38, 35, 30, 28, 22, 18, 12, 8, 5, 3, 2], admin: ['Sudhakar Rao', 'Joint secretary'] },
  ];
  const made = await db.insert(associations).values(others.map(o => ({ name: o.name, short: o.short, city: o.city }))).returning();
  const idOf = (name: string) => made.find(a => a.name === name)!.id;

  await db.insert(subscriptions).values([
    { associationId: lakesideId, kind: 'Apartment', plan: 'Enterprise', state: 'Active', annualAmount: 1164840, renewsAt: day(15), plots: 3426, owners: 2971, adminName: 'Sanjana Rao', adminRole: 'Secretary', adminPhone: '+91 80 4128 7000', adminEmail: 'admin@plhabitat.example', registration: 'KA/BLR/RWA/2015/1188', address: 'Varthur Main Road, Gunjur · Bengaluru 560087', since: day(-1250) },
    ...others.map(o => ({ associationId: idOf(o.name), kind: o.kind, plan: o.plan, state: o.state, annualAmount: o.annual, renewsAt: day(o.renew), plots: o.plots, owners: o.owners, adminName: o.admin[0], adminRole: o.admin[1], since: day(-400) })),
  ]);

  const lakesideUsage = [62, 64, 66, 69, 71, 74, 76, 79, 81, 83, 86, 87];
  await db.insert(usageSnapshots).values([
    ...lakesideUsage.map((adoption, i) => ({ associationId: lakesideId, month: month(11 - i), adoption, logins: 1200 + i * 58 })),
    ...others.flatMap(o => o.usage.map((adoption, i) => ({ associationId: idOf(o.name), month: month(11 - i), adoption, logins: adoption * 4 }))),
  ]);

  const y = new Date().getFullYear();
  await db.insert(invoices).values([
    { associationId: lakesideId, number: `TRZ-INV-${y}-0001`, amount: 1164840, dueAt: day(25) },
    { associationId: idOf('Green Meadows Villas'), number: `TRZ-INV-${y}-0002`, amount: 1008, dueAt: day(-36) },
    { associationId: idOf('Green Meadows Villas'), number: `TRZ-INV-${y}-0003`, amount: 1008, dueAt: day(-5) },
    { associationId: idOf('Lake View Residency'), number: `TRZ-INV-${y}-0004`, amount: 1152, dueAt: day(-76) },
    { associationId: idOf('Nandi Hills Plotted Layout'), number: `TRZ-INV-${y}-0005`, amount: 9000, paid: 4000, dueAt: day(-12) },
  ]);

  await db.insert(supportTickets).values([
    { number: 2043, associationId: lakesideId, category: 'Billing', title: 'Completed job payment not reflecting in the vendor ledger', raisedBy: 'Mahesh Kulkarni', source: 'Associate · Sunrise Plumbing Co.', priority: 'Medium', slaDueAt: new Date(Date.now() + 12 * 3600e3), createdAt: day(-1) },
    { number: 2041, associationId: lakesideId, category: 'Billing', title: 'Maintenance invoices show last year’s per-sqft rate', raisedBy: 'Ashok Menon', source: 'End user · Treasurer', priority: 'High', status: 'In progress', assignee: 'Imran Qureshi', slaDueAt: new Date(Date.now() - 6 * 3600e3), createdAt: day(-2) },
    { number: 2038, associationId: idOf('Nandi Hills Plotted Layout'), category: 'Data', title: 'Bulk owner import rejects rows with two owners per plot', raisedBy: 'Nagesh Gowda', source: 'End user · Secretary', priority: 'High', slaDueAt: new Date(Date.now() + 4 * 3600e3), createdAt: day(-3) },
    { number: 2029, associationId: idOf('Green Meadows Villas'), category: 'Feature', title: 'Request a Kannada option on the resident app', raisedBy: 'Bhagya Lakshmi', source: 'End user · Resident, Villa 27', priority: 'Low', assignee: 'Lalitha Gowda', slaDueAt: day(4), createdAt: day(-9) },
    { number: 2022, associationId: idOf('Lake View Residency'), category: 'Bug', title: 'Visit schedule shows old dates after a job was reassigned', raisedBy: 'Ravi Teja', source: 'Associate · AquaPure Water Systems', priority: 'Low', status: 'Resolved', assignee: 'Lalitha Gowda', slaDueAt: day(-10), createdAt: day(-14), resolvedAt: day(-11) },
  ]);

  await db.insert(opsActivity).values([
    { who: 'System', what: `invoice TRZ-INV-${y}-0003 crossed its due date · Green Meadows Villas`, createdAt: day(-5) },
    { who: 'System', what: 'trial started · Nandi Hills Plotted Layout · 210 plots', createdAt: day(-26) },
  ]);

  // a Virtual Property Manager looking after two of the societies
  const [vpm] = await db.insert(users).values({ name: 'Imran Qureshi', phone: '9833300003' }).returning();
  await db.insert(staffRoles).values([lakesideId, idOf('Green Meadows Villas')].map(associationId => ({ userId: vpm!.id, associationId, role: 'vpm' as const, title: 'Property Manager' })));

  return { greenMeadows: idOf('Green Meadows Villas'), lakeView: idOf('Lake View Residency'), nandiHills: idOf('Nandi Hills Plotted Layout') };
}
