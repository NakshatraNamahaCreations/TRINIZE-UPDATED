import { api, LIVE } from './api';

/* What my flat owes: bills, payments, the ledger and receipts. In demo mode (no API) a small
   in-memory account stands in, with a working "pay" so the flow can be tried. */

export type Bill = { id: string; number: string; period: string; chargeType: string; description: string; amount: number; paid: number; waived: number; due: number; dueDate: string; status: 'Unpaid' | 'Part paid' | 'Overdue' | 'Paid' | 'Waived' | 'Cancelled' };
export type Payment = { id: string; number: string; amount: number; mode: string; receivedOn: string; reversed: boolean };
export type LedgerLine = { date: string; ref: string; what: string; kind: string; charge: number; payment: number; balance: number };
export type Dues = {
  unit: string; balance: number; due: number; advance: number; open: Bill[]; paid: Bill[]; payments: Payment[]; ledger: LedgerLine[];
  pay: { online: boolean; allowPartial: boolean; upiId: string; bankDetails: string };
};
export type Receipt = Payment & { unit: string; unitLabel: string; society: string; reference: string; payerName: string; reverseReason: string | null;
  settled: { number: string; chargeType: string; period: string; amount: number }[]; advance: number };

const ymd = (offset = 0) => new Date(Date.now() + 5.5 * 3600e3 + offset * 864e5).toISOString().slice(0, 10);
const period = ymd().slice(0, 7);
let demoBills: Bill[] = [
  { id: 'b2', number: 'BILL-DEMO-0002', period, chargeType: 'Monthly maintenance', description: '', amount: 4350, paid: 0, waived: 0, due: 4350, dueDate: ymd(8), status: 'Unpaid' },
  { id: 'b1', number: 'BILL-DEMO-0001', period, chargeType: 'Parking', description: '', amount: 500, paid: 500, waived: 0, due: 0, dueDate: ymd(-20), status: 'Paid' },
];
let demoPays: Receipt[] = [{ id: 'p1', number: 'RCP-000001', amount: 500, mode: 'UPI', receivedOn: ymd(-22), reversed: false, unit: 'T4-1108', unitLabel: 'Tower 4, Flat 1108', society: 'Prestige Lakeside Habitat', reference: 'UPI-778899',
  payerName: 'You', reverseReason: null, settled: [{ number: 'BILL-DEMO-0001', chargeType: 'Parking', period, amount: 500 }], advance: 0 }];

function demoDues(): Dues {
  const due = demoBills.reduce((n, b) => n + b.due, 0);
  let bal = 0;
  const ledger: LedgerLine[] = [
    ...demoBills.map(b => ({ date: b.dueDate, ref: b.number, what: b.chargeType, kind: 'bill', charge: b.amount, payment: 0, balance: 0 })),
    ...demoPays.map(p => ({ date: p.receivedOn, ref: p.number, what: 'Payment · ' + p.mode, kind: 'payment', charge: 0, payment: p.amount, balance: 0 })),
  ].sort((a, b) => a.date.localeCompare(b.date)).map(l => ({ ...l, balance: (bal += l.charge - l.payment) })).reverse();
  return { unit: 'T4-1108', balance: due, due, advance: 0, open: demoBills.filter(b => b.due > 0), paid: demoBills.filter(b => b.due === 0), payments: demoPays, ledger,
    pay: { online: true, allowPartial: true, upiId: 'lakeside@upi', bankDetails: '' } };
}

export async function dues(): Promise<Dues> {
  return LIVE ? api<Dues>('GET', '/v1/dues') : demoDues();
}
export async function payNow(amount: number): Promise<Receipt> {
  if (LIVE) return api<Receipt>('POST', '/v1/dues/pay', { amount });
  let left = amount;
  const settled: Receipt['settled'] = [];
  demoBills = demoBills.map(b => {
    const take = Math.min(left, b.due);
    if (!take) return b;
    left -= take; settled.push({ number: b.number, chargeType: b.chargeType, period: b.period, amount: take });
    return { ...b, paid: b.paid + take, due: b.due - take, status: b.due - take ? 'Part paid' : 'Paid' };
  });
  const r: Receipt = { id: 'p' + Date.now(), number: 'RCP-' + String(demoPays.length + 1).padStart(6, '0'), amount, mode: 'Payment gateway', receivedOn: ymd(), reversed: false, unit: 'T4-1108', unitLabel: 'Tower 4, Flat 1108',
    society: 'Prestige Lakeside Habitat', reference: 'DEMO', payerName: 'You', reverseReason: null, settled, advance: left };
  demoPays = [r, ...demoPays];
  return r;
}
export async function receipt(id: string): Promise<Receipt> {
  if (LIVE) return api<Receipt>('GET', '/v1/dues/receipts/' + id);
  const r = demoPays.find(p => p.id === id);
  if (!r) throw new Error('not found');
  return r;
}

export const rupees = (n: number) => '₹' + Math.abs(n).toLocaleString('en-IN');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-11-27" → "27 Nov 2026"; "2026-11" → "Nov 2026" */
export const nice = (s: string) => (s.length === 7 ? `${MON[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}` : `${Number(s.slice(8, 10))} ${MON[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}`);
