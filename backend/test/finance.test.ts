import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from './helpers.js';

type Call = 'GET' | 'POST' | 'PUT' | 'DELETE';
const day = (offset: number) => new Date(Date.now() + 5.5 * 3600e3 + offset * 864e5).toISOString().slice(0, 10);
const TODAY = day(0), PERIOD = TODAY.slice(0, 7);
/** a day in last month, for closing the books */
const lastMonth = (() => { const d = new Date(Date.now() + 5.5 * 3600e3); d.setUTCDate(0); return d.toISOString().slice(0, 10); })();

describe('accounting', () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let admin = '', ananya = '', rohit = '';
  let flats: Record<string, string> = {};
  let acct: Record<string, string> = {};
  const A = (m: Call, path: string, body?: unknown, token = admin) => t.call(m, `/v1/admin/${t.associationId}/finance${path}`, { token, body });
  const R = (m: Call, url: string, body?: unknown, token = ananya) => t.call(m, url, { token, body });
  const balanceOf = async (code: string) => (await A('GET', '/units')).body.find((u: { code: string }) => u.code === code).balance as number;

  beforeAll(async () => {
    t = await testApp();
    admin = (await t.staffIn()).accessToken;
    ananya = (await t.signIn()).accessToken;
    rohit = (await t.signIn('9900112233')).accessToken;
    for (const u of (await A('GET', '/units')).body) flats[u.code] = u.id;
    for (const a of (await A('GET', '/accounts')).body) acct[a.code] = a.id;
  });
  afterAll(async () => { await t?.close(); });

  it('starts every society with a chart of accounts, and knows each flat’s size and type', async () => {
    const chart = (await A('GET', '/accounts')).body;
    expect(chart.length).toBeGreaterThanOrEqual(25);
    expect(chart.find((a: { code: string }) => a.code === '1100')).toMatchObject({ name: 'Dues receivable from flats', kind: 'asset', role: 'receivable', balance: 0 });
    const units = (await A('GET', '/units')).body;
    expect(units.find((u: { code: string }) => u.code === 'T4-1108')).toMatchObject({ area: 1450, flatType: '3BHK', balance: 0, owner: 'Ananya Iyer' });
    expect((await A('POST', '/accounts', { code: '5110', name: 'Garden upkeep', kind: 'expense' })).status).toBe(201);
    expect((await A('POST', '/accounts', { code: '5110', name: 'Again', kind: 'expense' })).body.error.code).toBe('code_taken');
  });

  it('works out each flat’s bill by area, by type or as one amount — before anything is posted', async () => {
    const base = { period: PERIOD, chargeType: 'Monthly maintenance', dueDate: day(10) };
    const bySqft = (await A('POST', '/bills/preview', { ...base, method: 'sqft', rate: 3 })).body;
    expect(bySqft.rows.find((r: { unit: string }) => r.unit === 'T4-1108').amount).toBe(4350);
    expect(bySqft).toMatchObject({ bills: 5, total: (1450 + 1180 + 980 + 1620 + 1180) * 3 });
    const byType = (await A('POST', '/bills/preview', { ...base, method: 'type', byType: { '3BHK': 4500 } })).body;
    expect(byType.bills).toBe(2);
    expect(byType.rows.find((r: { unit: string }) => r.unit === 'T2-0704')).toMatchObject({ amount: 0, skip: 'No amount set for 2BHK' });
    expect((await A('POST', '/bills/preview', { ...base, method: 'flat', amount: 3000 })).body.total).toBe(15000);
    expect((await A('GET', '/bills')).body).toHaveLength(0); // a preview posts nothing
  });

  it('generates the month’s bills once, posts them to each flat’s ledger and tells the residents', async () => {
    const run = await A('POST', '/bills/run', { period: PERIOD, chargeType: 'Monthly maintenance', method: 'sqft', rate: 3, dueDate: day(10) });
    expect(run.status).toBe(201);
    expect(run.body).toMatchObject({ bills: 5, total: 19230, skipped: [] });
    expect(run.body.residentsTold).toBe(6);
    expect((await R('GET', '/v1/notifications')).body[0]).toMatchObject({ href: '/dues' });
    // the same month and charge is never billed twice
    const again = await A('POST', '/bills/run', { period: PERIOD, chargeType: 'Monthly maintenance', method: 'sqft', rate: 3, dueDate: day(10) });
    expect(again.body.error.code).toBe('nothing_to_bill');
    expect(await balanceOf('T4-1108')).toBe(4350);
    const ledger = (await A('GET', `/ledger/${flats['T4-1108']}`)).body;
    expect(ledger).toMatchObject({ unit: 'T4-1108', opening: 0, closing: 4350 });
    expect(ledger.lines[0]).toMatchObject({ charge: 4350, payment: 0, balance: 4350, kind: 'bill' });
    const d = (await A('GET', '/dashboard')).body;
    expect(d).toMatchObject({ pendingDues: 19230, flatsWithDues: 5, collected: 0, overdue: 0 });
    expect(d.income).toEqual([{ name: 'Maintenance charges', amount: 19230 }]);
    // the overview's own figures: this month's run, nothing collected yet, and the flats that owe most — largest first
    expect(d).toMatchObject({ flats: 5, billsThisMonth: 5, billedThisMonth: 19230, paidOfBilled: 0, recentPayments: [] });
    expect(d.topDues).toHaveLength(5);
    expect(d.topDues.map((x: { amount: number }) => x.amount)).toEqual([...d.topDues.map((x: { amount: number }) => x.amount)].sort((x, y) => y - x));
    expect(d.topDues.reduce((n: number, x: { amount: number }) => n + x.amount, 0)).toBe(d.pendingDues);
    expect(d.topDues.find((x: { unit: string }) => x.unit === 'T4-1108')).toMatchObject({ amount: 4350 });
  });

  it('takes a part payment, then the rest; an overpayment waits as an advance and settles the next bill', async () => {
    const part = await A('POST', '/payments', { unitId: flats['T4-1108'], amount: 2000, mode: 'UPI', reference: 'UPI-778899', payerName: 'Ananya Iyer' });
    expect(part.status).toBe(201);
    expect(part.body).toMatchObject({ number: 'RCP-000001', amount: 2000, unit: 'T4-1108', society: 'Prestige Lakeside Habitat', depositedTo: 'Bank account', advance: 0 });
    expect(part.body.settled[0]).toMatchObject({ amount: 2000, chargeType: 'Monthly maintenance' });
    expect((await A('GET', `/bills?unitId=${flats['T4-1108']}`)).body[0]).toMatchObject({ paid: 2000, due: 2350, status: 'Part paid' });
    expect((await R('GET', '/v1/notifications')).body[0]).toMatchObject({ kind: 'payments', title: 'Payment received · ₹2,000' });
    // cash goes to the cash account; ₹650 more than is owed stays as an advance
    const rest = (await A('POST', '/payments', { unitId: flats['T4-1108'], amount: 3000, mode: 'Cash' })).body;
    expect(rest).toMatchObject({ depositedTo: 'Cash in hand', advance: 650 });
    expect(await balanceOf('T4-1108')).toBe(-650);
    // a new charge uses the advance first
    const parking = (await A('POST', '/bills', { unitId: flats['T4-1108'], chargeType: 'Parking', amount: 1000, dueDate: day(10) })).body;
    expect(parking).toMatchObject({ paid: 650, due: 350, status: 'Part paid' });
    expect(await balanceOf('T4-1108')).toBe(350);
    const d = (await A('GET', '/dashboard')).body;
    expect(d).toMatchObject({ collected: 5000, bank: 2000, cash: 3000 });
    // the newest receipts are listed, and what they settled on this month's bills is counted against the run
    expect(d.recentPayments.length).toBeGreaterThan(0);
    expect(d.recentPayments[0]).toMatchObject({ unit: expect.any(String), number: expect.stringMatching(/^RCP-/), amount: expect.any(Number) });
    expect(d.paidOfBilled).toBeGreaterThan(0);
    expect(d.paidOfBilled).toBeLessThanOrEqual(d.billedThisMonth);
  });

  it('a bounced cheque is undone: the receipt is reversed and the bill is open again', async () => {
    expect((await A('POST', '/payments', { unitId: flats['T2-0704'], amount: 3540, mode: 'Cheque' })).body.error.code).toBe('cheque_no');
    const chq = (await A('POST', '/payments', { unitId: flats['T2-0704'], amount: 3540, mode: 'Cheque', chequeNo: '004512', chequeDate: TODAY })).body;
    expect(chq).toMatchObject({ chequeStatus: 'Pending' });
    expect(await balanceOf('T2-0704')).toBe(0);
    const bounced = (await A('POST', `/payments/${chq.id}/cheque`, { status: 'Bounced' })).body;
    expect(bounced).toMatchObject({ reversed: true, chequeStatus: 'Bounced', reverseReason: 'Cheque 004512 bounced' });
    expect(await balanceOf('T2-0704')).toBe(3540);
    expect((await A('GET', `/bills?unitId=${flats['T2-0704']}`)).body[0]).toMatchObject({ paid: 0, status: 'Unpaid' });
    expect((await A('POST', `/payments/${chq.id}/reverse`, { reason: 'again' })).body.error.code).toBe('already_reversed');
  });

  it('waives part of a bill and cancels a wrong one, both through the ledger', async () => {
    const bill = (await A('GET', `/bills?unitId=${flats['T5-0110']}`)).body[0];
    expect((await A('POST', `/bills/${bill.id}/waive`, { amount: 99999, reason: 'Too much' })).body.error.code).toBe('too_much');
    expect((await A('POST', `/bills/${bill.id}/waive`, { amount: 940, reason: 'Flat vacant for the month' })).body).toMatchObject({ waived: 940, due: 2000 });
    expect(await balanceOf('T5-0110')).toBe(2000);
    const wrong = (await A('POST', '/bills', { unitId: flats['T5-0110'], chargeType: 'Penalty', amount: 500, dueDate: day(5) })).body;
    expect((await A('POST', `/bills/${wrong.id}/cancel`, { reason: 'Entered by mistake' })).body.status).toBe('Cancelled');
    expect(await balanceOf('T5-0110')).toBe(2000);
    // a bill with money against it can't simply be cancelled
    const paidBill = (await A('GET', `/bills?unitId=${flats['T4-1108']}`)).body.find((b: { chargeType: string }) => b.chargeType === 'Parking');
    expect((await A('POST', `/bills/${paidBill.id}/cancel`, { reason: 'x y z' })).body.error.code).toBe('has_payments');
  });

  it('charges the late fee once per overdue bill, after the grace period', async () => {
    expect((await A('POST', '/late-fees/run')).body.error.code).toBe('no_late_fee');
    expect((await A('PUT', '/settings', { lateFee: { kind: 'percent', value: 40, graceDays: 0 } })).body.error.code).toBe('fee_too_high');
    await A('PUT', '/settings', { lateFee: { kind: 'flat', value: 100, graceDays: 3 } });
    // an old bill, well past due
    await A('POST', '/bills', { unitId: flats['T1-1503'], chargeType: 'Water', amount: 800, dueDate: day(-20), period: PERIOD });
    expect((await A('POST', '/late-fees/run')).body).toEqual({ charged: 1, total: 100 });
    expect((await A('POST', '/late-fees/run')).body).toEqual({ charged: 0, total: 0 });
    const d = (await A('GET', '/dashboard')).body;
    expect(d.overdueBills).toBe(1);
    expect((await A('POST', '/reminders')).body).toEqual({ flats: 1, residents: 1 });
  });

  it('expenses wait for approval, become a debt to the vendor, and are paid from the bank', async () => {
    const e = await A('POST', '/expenses', { payee: 'GreenLeaf Housekeeping', accountId: acct['5050'], amount: 18000, description: 'November housekeeping', billNo: 'GL/11/204' });
    expect(e.status).toBe(201);
    expect(e.body).toMatchObject({ number: 'EXP-0001', status: 'Pending approval', head: 'Housekeeping' });
    expect((await A('POST', `/expenses/${e.body.id}/pay`, { mode: 'Bank transfer' })).body.error.code).toBe('not_payable');
    expect((await A('GET', '/dashboard')).body.toApprove).toEqual({ n: 1, amount: 18000 });
    expect((await A('POST', `/expenses/${e.body.id}/decision`, { decision: 'approve' })).body).toMatchObject({ status: 'Approved', decidedByName: 'Sanjana Rao' });
    expect((await A('GET', '/accounts')).body.find((a: { code: string }) => a.code === '2000').balance).toBe(18000);
    expect((await A('POST', `/expenses/${e.body.id}/pay`, { mode: 'Bank transfer', reference: 'NEFT-5521' })).body).toMatchObject({ status: 'Paid', paymentMode: 'Bank transfer' });
    expect((await A('GET', '/accounts')).body.find((a: { code: string }) => a.code === '2000').balance).toBe(0);
    // small ones can skip the queue once the society sets a limit; petty cash is booked and paid in one step
    await A('PUT', '/settings', { approvalAbove: 5000 });
    const petty = (await A('POST', '/expenses', { payee: 'Sri Hardware', accountId: acct['5000'], amount: 450, description: 'Tap washers', paid: { mode: 'Cash' } })).body;
    expect(petty).toMatchObject({ status: 'Paid', paymentMode: 'Cash' });
    expect((await A('POST', '/expenses', { payee: 'X', accountId: acct['4000'], amount: 10 })).body.error.code).toBe('invalid_input');
    expect((await A('POST', '/expenses', { payee: 'Wrong head', accountId: acct['4000'], amount: 10 })).body.error.code).toBe('bad_head');
    const rejected = (await A('POST', '/expenses', { payee: 'Shady Traders', accountId: acct['5100'], amount: 90000 })).body;
    expect((await A('POST', `/expenses/${rejected.id}/decision`, { decision: 'reject' })).body.status).toBe('Rejected');
  });

  it('a vendor bill approved in Maintenance lands in the books by itself', async () => {
    const M = (m: Call, path: string, body?: unknown) => t.call(m, `/v1/admin/${t.associationId}${path}`, { token: admin, body });
    const issue = (await t.call('POST', '/v1/issues', { token: ananya, body: { title: 'Kitchen tap leaking', details: 'Dripping all night', category: 'Plumbing', location: 'My flat (T4-1108)', priority: 'Medium', via: 'form' } })).body;
    const vendor = (await M('GET', '/vendor-list')).body.find((v: { category: string }) => v.category === 'Plumbing');
    await M('POST', `/issues/${issue.ref}/status`, { to: 'Acknowledged' });
    await M('POST', `/issues/${issue.ref}/status`, { to: 'Assigned', vendorId: vendor.id });
    const inv = await M('POST', `/issues/${issue.ref}/invoices`, { amount: 1200, note: 'Tap cartridge replaced' });
    expect(inv.status).toBe(201);
    const invoiceId = (await M('GET', '/invoices')).body.find((i: { issue: string }) => i.issue === issue.ref).id;
    await M('POST', `/invoices/${invoiceId}/status`, { status: 'Approved' });
    const booked = (await A('GET', '/expenses')).body.find((e: { fromMaintenance: boolean }) => e.fromMaintenance);
    expect(booked).toMatchObject({ amount: 1200, status: 'Approved', head: 'Repairs and vendor bills', payee: vendor.name });
    await M('POST', `/invoices/${invoiceId}/status`, { status: 'Paid' });
    expect((await A('GET', '/expenses')).body.find((e: { fromMaintenance: boolean }) => e.fromMaintenance).status).toBe('Paid');
    expect((await A('GET', '/expenses')).body.filter((e: { fromMaintenance: boolean }) => e.fromMaintenance)).toHaveLength(1); // never twice
  });

  it('manual journal entries must balance', async () => {
    const bad = await A('POST', '/journal', { date: TODAY, memo: 'Lopsided', lines: [{ accountId: acct['1000'], debit: 500 }, { accountId: acct['4070'], credit: 400 }] });
    expect(bad.body.error.code).toBe('unbalanced');
    expect((await A('POST', '/journal', { date: TODAY, memo: 'Needs a flat', lines: [{ accountId: acct['1100'], debit: 5 }, { accountId: acct['4060'], credit: 5 }] })).body.error.code).toBe('unit_needed');
    const ok = await A('POST', '/journal', { date: TODAY, memo: 'Fixed deposit interest', lines: [{ accountId: acct['1000'], debit: 500 }, { accountId: acct['4070'], credit: 500 }] });
    expect(ok.status).toBe(201);
    expect(ok.body.ref).toMatch(/^JV-\d+$/);
    expect(ok.body.lines).toHaveLength(2);
    expect((await A('POST', `/journal/${ok.body.id}/reverse`, { reason: 'Posted twice' })).body.reversal).toMatch(/^JV-/);
    expect((await A('POST', `/journal/${ok.body.id}/reverse`, { reason: 'Posted twice' })).body.error.code).toBe('already_reversed');
    const billEntry = (await A('GET', '/journal')).body.find((e: { source: string }) => e.source === 'bill');
    expect((await A('POST', `/journal/${billEntry.id}/reverse`, { reason: 'Not this way' })).body.error.code).toBe('use_its_own_undo');
  });

  it('reads a bank statement, matches what it can, and lets the rest be matched or posted by hand', async () => {
    const [dd, mm, yyyy] = [TODAY.slice(8), TODAY.slice(5, 7), TODAY.slice(0, 4)];
    const statement = [
      'Account statement for Prestige Lakeside Habitat', '',
      'Txn Date,Narration,Chq/Ref No,Withdrawal Amt,Deposit Amt,Closing Balance',
      `${dd}/${mm}/${yyyy},UPI/778899/ANANYA IYER,UPI-778899,,"2,000.00","2,000.00"`,
      `${dd}/${mm}/${yyyy},NEFT GREENLEAF HOUSEKEEPING,NEFT-5521,"18,000.00",,"-16,000.00"`,
      `${dd}/${mm}/${yyyy},QUARTERLY SMS CHARGES,,59.00,,"-16,059.00"`,
      `${dd}/${mm}/${yyyy},CASH DEPOSIT BY UNKNOWN,,,750.00,"-15,309.00"`,
      'Closing balance,,,,,"-15,309.00"',
    ].join('\n');
    const imp = await A('POST', '/bank/import', { csv: statement });
    expect(imp.status).toBe(201);
    expect(imp.body).toMatchObject({ read: 4, imported: 4, duplicates: 0, matched: 2, unmatched: 2 });
    expect((await A('POST', '/bank/import', { csv: statement })).body).toMatchObject({ imported: 0, duplicates: 4 }); // the same file twice changes nothing
    const lines = (await A('GET', '/bank')).body;
    expect(lines.find((l: { description: string }) => l.description.startsWith('UPI/'))).toMatchObject({ status: 'Matched', matchedHow: 'auto', matchedTo: 'RCP-000001 · T4-1108', moneyIn: 2000 });
    expect(lines.find((l: { description: string }) => l.description.startsWith('NEFT'))).toMatchObject({ status: 'Matched', moneyOut: 18000 });
    // bank charges aren't in the books yet: choose the head and they are posted
    const charges = lines.find((l: { description: string }) => l.description.includes('SMS CHARGES'));
    expect((await A('POST', `/bank/${charges.id}/categorize`, { accountId: acct['5080'] })).body.matched).toBe(true);
    expect((await A('GET', '/accounts')).body.find((a: { code: string }) => a.code === '5080').balance).toBe(59);
    // a deposit nobody can explain is set aside
    const mystery = lines.find((l: { description: string }) => l.description.includes('UNKNOWN'));
    expect((await A('POST', `/bank/${mystery.id}/match`, { type: 'payment', id: (await A('GET', '/payments')).body[0].id })).body.error.code).toMatch(/amount_differs|target_taken/);
    expect((await A('POST', `/bank/${mystery.id}/ignore`)).body.status).toBe('Ignored');
    expect((await A('GET', '/dashboard')).body.reconciliation).toEqual({ unmatched: 0, matched: 3 });
    expect((await A('POST', '/bank/import', { csv: 'nothing useful here at all' })).body.error.code).toBe('no_header');
  });

  it('a closed month can’t be changed until it is reopened', async () => {
    const period = lastMonth.slice(0, 7);
    await A('POST', '/journal', { date: lastMonth, memo: 'Opening bank balance', lines: [{ accountId: acct['1000'], debit: 50000 }, { accountId: acct['3000'], credit: 50000 }] });
    expect((await A('POST', `/periods/${PERIOD}/lock`)).body.error.code).toBe('month_not_over');
    await A('POST', '/bank/import', { csv: `Date,Description,Debit,Credit\n${lastMonth},OLD UNEXPLAINED DEBIT,120,` });
    expect((await A('POST', `/periods/${period}/lock`)).body.error.code).toBe('unreconciled');
    const stray = (await A('GET', '/bank?status=Unmatched')).body[0];
    await A('POST', `/bank/${stray.id}/ignore`);
    expect((await A('POST', `/periods/${period}/lock`)).body).toEqual({ period, locked: true });
    expect((await A('GET', '/periods')).body.find((p: { period: string }) => p.period === period)).toMatchObject({ locked: true, lockedBy: 'Sanjana Rao' });
    const blocked = await A('POST', '/journal', { date: lastMonth, memo: 'Too late', lines: [{ accountId: acct['1000'], debit: 1 }, { accountId: acct['4060'], credit: 1 }] });
    expect(blocked.body.error.code).toBe('period_locked');
    expect((await A('POST', '/payments', { unitId: flats['T3-0402'], amount: 100, mode: 'Cash', receivedOn: lastMonth })).body.error.code).toBe('period_locked');
    expect((await A('DELETE', `/periods/${period}/lock`)).body.locked).toBe(false);
    expect((await A('POST', '/journal', { date: lastMonth, memo: 'Now allowed', lines: [{ accountId: acct['1000'], debit: 1 }, { accountId: acct['4060'], credit: 1 }] })).status).toBe(201);
  });

  it('reports are read from the ledger, and the books balance', async () => {
    const tb = (await A('GET', '/reports/trial-balance')).body;
    expect(tb.debit).toBe(tb.credit);
    expect(tb.debit).toBeGreaterThan(0);
    const bs = (await A('GET', '/reports/balance-sheet')).body;
    expect(bs.balanced).toBe(true);
    expect(bs.assets).toBe(bs.liabilities + bs.funds);
    const pnl = (await A('GET', '/reports/pnl')).body;
    expect(pnl.surplus).toBe(pnl.income - pnl.expenses);
    expect(pnl.rows.some((r: (string | number)[]) => r[1] === 'Housekeeping' && r[2] === 18000)).toBe(true);
    const def = (await A('GET', '/reports/defaulters')).body;
    expect(def.rows.find((r: (string | number)[]) => r[0] === 'T2-0704')![7]).toBe(3540);
    expect(def.rows.some((r: (string | number)[]) => r[0] === 'T4-1108' && r[7] === 350)).toBe(true);
    const col = (await A('GET', '/reports/collection')).body;
    expect(col.total).toBe(5000); // the bounced cheque is not collection
    expect((await A('GET', '/reports/vendors')).body.rows.find((r: (string | number)[]) => r[0] === 'GreenLeaf Housekeeping')).toEqual(['GreenLeaf Housekeeping', 1, 18000, 18000, 0, 0]);
    expect((await A('GET', '/reports/cash-flow')).body.moneyOut).toBeGreaterThanOrEqual(18000 + 450 + 1200 + 59);
    expect((await A('GET', '/reports/audit')).body.rows.length).toBeGreaterThan(10);
    // the export an auditor or an accounting package can open
    const csv = await t.app.inject({ method: 'GET', url: `/v1/admin/${t.associationId}/finance/reports/daybook?format=csv`, headers: { authorization: 'Bearer ' + admin } });
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('Date,Voucher type,Voucher no,Ledger,Flat,Debit,Credit,Narration');
    expect(csv.body).toContain('Receipt,JV-');
    const led = await t.app.inject({ method: 'GET', url: `/v1/admin/${t.associationId}/finance/ledger/${flats['T4-1108']}?format=csv`, headers: { authorization: 'Bearer ' + admin } });
    expect(led.body).toContain('Opening balance');
  });

  it('residents see their own dues, ledger and receipts — and can pay in the app', async () => {
    const mine = (await R('GET', '/v1/dues')).body;
    expect(mine).toMatchObject({ unit: 'T4-1108', balance: 350, due: 350, advance: 0 });
    expect(mine.open).toHaveLength(1);
    expect(mine.open[0]).toMatchObject({ chargeType: 'Parking', due: 350 });
    expect(mine.payments).toHaveLength(2);
    expect(mine.pay).toMatchObject({ online: true, allowPartial: true });
    expect(mine.ledger[0].balance).toBe(350);
    // a neighbour's receipt is not mine
    const theirs = (await A('POST', '/payments', { unitId: flats['T2-0704'], amount: 500, mode: 'UPI' })).body;
    expect((await R('GET', `/v1/dues/receipts/${theirs.id}`)).status).toBe(404);
    expect((await R('GET', `/v1/dues/receipts/${mine.payments[0].id}`)).body.unit).toBe('T4-1108');
    const paid = await R('POST', '/v1/dues/pay', { amount: 350 });
    expect(paid.status).toBe(201);
    expect(paid.body).toMatchObject({ mode: 'Payment gateway', source: 'resident', amount: 350, advance: 0 });
    expect((await R('GET', '/v1/dues')).body).toMatchObject({ balance: 0, due: 0 });
    expect((await R('GET', '/v1/dues', undefined, rohit)).body.balance).toBe(3040);
    // a society that refuses part payments
    await A('PUT', '/settings', { allowPartial: false });
    expect((await R('POST', '/v1/dues/pay', { amount: 100 }, rohit)).body.error.code).toBe('partial_not_allowed');
    expect((await R('POST', '/v1/dues/pay', { amount: 3040 }, rohit)).status).toBe(201);
  });

  it('an auditor can read everything and change nothing; residents and other societies are shut out', async () => {
    const made = await A('POST', '/auditors', { name: 'Kavitha & Co', email: 'audit@kavitha.example', password: 'Audit@2026' });
    expect(made.status).toBe(201);
    const auditor = (await t.staffIn('audit@kavitha.example', 'Audit@2026')).accessToken;
    expect((await A('GET', '/reports/pnl', undefined, auditor)).status).toBe(200);
    expect((await A('GET', '/journal', undefined, auditor)).status).toBe(200);
    expect((await A('POST', '/payments', { unitId: flats['T3-0402'], amount: 1, mode: 'Cash' }, auditor)).status).toBe(403);
    expect((await A('POST', '/journal', { date: TODAY, memo: 'Sneaky', lines: [] }, auditor)).status).toBe(403);
    expect((await t.call('GET', `/v1/admin/${t.associationId}/issues`, { token: auditor })).status).toBe(403); // the books only
    expect((await A('DELETE', `/auditors/${made.body.id}`)).status).toBe(204);
    expect((await A('GET', '/dashboard', undefined, auditor)).status).toBe(403);
    expect((await A('GET', '/dashboard', undefined, ananya)).status).toBe(403);
    expect((await t.call('GET', `/v1/admin/${t.greenMeadows}/finance/dashboard`, { token: admin })).status).toBe(403);
  });
});
