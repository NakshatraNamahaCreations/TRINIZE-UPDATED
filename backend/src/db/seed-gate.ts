import { and, eq } from 'drizzle-orm';
import type { DB } from './client.js';
import { frequentVisitors, staffRoles, units, users, visits, watchlist } from './schema.js';

export const GATE_DEMO = { guardPhone: '9822200007', guardName: 'Ramesh Kumar', gate: 'Main gate', blockedPhone: '9700000013', regularPhone: '9812300001' };

/** A guard at the main gate, one flat's regular visitor, a blocked number and a few days of gate history. */
export async function seedGate(db: DB, associationId: string) {
  const [existing] = await db.select().from(users).where(eq(users.phone, GATE_DEMO.guardPhone));
  const guard = existing ?? (await db.insert(users).values({ name: GATE_DEMO.guardName, phone: GATE_DEMO.guardPhone }).returning())[0]!;
  await db.insert(staffRoles).values({ userId: guard.id, associationId, role: 'guard', title: GATE_DEMO.gate });

  const unit = async (code: string) => (await db.select().from(units).where(and(eq(units.associationId, associationId), eq(units.code, code))))[0]?.id ?? null;
  const home = await unit('T4-1108'), other = await unit('T2-0704');
  if (!home) return;

  await db.insert(frequentVisitors).values({ associationId, unitId: home, name: 'Lakshmi Devi', phone: GATE_DEMO.regularPhone, visitorType: 'Staff', autoApprove: true });
  await db.insert(watchlist).values({ associationId, name: 'Unknown salesman', phone: GATE_DEMO.blockedPhone, reason: 'Entered Tower 2 claiming a false delivery', level: 'block', addedByName: 'Sanjana Rao' });

  const ago = (h: number) => new Date(Date.now() - h * 3600e3);
  const at = { gate: GATE_DEMO.gate, guardId: guard.id, guardName: guard.name, associationId, createdBy: guard.id };
  await db.insert(visits).values([
    { ...at, unitId: home, kind: 'visitor', visitorType: 'Guest', name: 'Meera Krishnan', phone: '9886011223', purpose: 'Family visit', people: 2, status: 'Left',
      decidedVia: 'resident', decidedByName: 'Ananya Iyer', decidedAt: ago(27), enteredAt: ago(27), exitedAt: ago(24), exitGuardName: guard.name, createdAt: ago(27.1) },
    { ...at, unitId: home, kind: 'delivery', visitorType: 'Delivery', name: 'Delivery rider', partner: 'Swiggy', deliveryType: 'Food', status: 'Left',
      decidedVia: 'resident', decidedByName: 'Karthik Iyer', decidedAt: ago(20), enteredAt: ago(20), exitedAt: ago(19.8), exitGuardName: guard.name, createdAt: ago(20.1) },
    { ...at, unitId: home, kind: 'delivery', visitorType: 'Delivery', name: 'Courier', partner: 'Amazon', deliveryType: 'Parcel', status: 'AtGate',
      decidedVia: 'resident', decidedByName: 'Ananya Iyer', decidedAt: ago(3), keptAt: ago(2.9), collectCode: '4821', createdAt: ago(3.1) },
    { ...at, unitId: home, kind: 'visitor', visitorType: 'Staff', name: 'Lakshmi Devi', phone: GATE_DEMO.regularPhone, purpose: 'Housekeeping', status: 'Left',
      decidedVia: 'frequent', decidedByName: 'Standing permission', decidedAt: ago(6), enteredAt: ago(6), exitedAt: ago(4), exitGuardName: guard.name, createdAt: ago(6) },
    ...(other ? [{ ...at, unitId: other, kind: 'visitor' as const, visitorType: 'Cab' as const, name: 'Ola driver', vehicle: 'KA01AB1234', purpose: 'Pickup', status: 'Left' as const,
      decidedVia: 'resident' as const, decidedByName: 'Rohit Sharma', decidedAt: ago(9), enteredAt: ago(9), exitedAt: ago(8.8), exitGuardName: guard.name, createdAt: ago(9) }] : []),
  ]);
}
