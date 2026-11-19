import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApp } from './helpers.js';

type Call = 'GET' | 'POST' | 'PUT' | 'DELETE';
const day = (offset: number) => new Date(Date.now() + 5.5 * 3600e3 + offset * 864e5).toISOString().slice(0, 10);

describe('owner portal', () => {
  let t: Awaited<ReturnType<typeof testApp>>;
  let admin = '', rohit = '', ananya = '', neha = '', karthik = '';
  let flat = '', other = '';
  const A = (m: Call, path: string, body?: unknown, token = admin) => t.call(m, `/v1/admin/${t.associationId}${path}`, { token, body });
  const O = (m: Call, path: string, body?: unknown, token = rohit) => t.call(m, '/v1/owner' + path, { token, body });

  beforeAll(async () => {
    t = await testApp();
    admin = (await t.staffIn()).accessToken;
    rohit = (await t.signIn('9900112233')).accessToken; // owns T2-0704
    ananya = (await t.signIn()).accessToken; // owns T4-1108
    neha = (await t.signIn('9900445566')).accessToken; // a tenant
    karthik = (await t.signIn('9845012345')).accessToken; // family, not an owner
    const flats = (await A('GET', '/owners')).body;
    flat = flats.find((f: { unit: string }) => f.unit === 'T2-0704').unitId;
    other = flats.find((f: { unit: string }) => f.unit === 'T4-1108').unitId;
  });
  afterAll(async () => { await t?.close(); });

  it('is for owners only, and shows an owner only their own flats', async () => {
    const me = (await O('GET', '/me')).body;
    expect(me.name).toBe('Rohit Sharma');
    expect(me.properties).toHaveLength(1);
    expect(me.properties[0]).toMatchObject({ unit: 'T2-0704', society: 'Prestige Lakeside Habitat', occupancy: 'Owner-occupied' });
    expect((await O('GET', '/me', undefined, neha)).status).toBe(403);
    expect((await O('GET', '/dashboard', undefined, karthik)).status).toBe(403);
    expect((await O('GET', `/dashboard?unitId=${other}`)).status).toBe(404); // a neighbour's flat
    expect((await O('GET', `/statement?unitId=${other}`)).status).toBe(404);
  });

  it('rent collected for a let flat is held for the owner, repairs come out of it, and payouts are capped', async () => {
    const set = await A('PUT', `/owners/units/${flat}`, { occupancy: 'Rented', monthlyRent: 30000, leaseEnd: day(30) });
    expect(set.body).toMatchObject({ occupancy: 'Rented', monthlyRent: 30000 });
    // the month's rent is billed and paid
    await A('POST', '/finance/bills', { unitId: flat, chargeType: 'Rent', amount: 30000, dueDate: day(5) });
    await A('POST', '/finance/bills', { unitId: flat, chargeType: 'Monthly maintenance', amount: 3540, dueDate: day(5) });
    expect((await O('GET', '/dashboard')).body).toMatchObject({ income: 0, pendingRent: 30000, societyChargesPending: 3540 });
    await A('POST', '/finance/payments', { unitId: flat, amount: 30000, mode: 'UPI', reference: 'UPI-RENT-11' });
    // it is a debt to the owner, not the society's income
    const chart = (await A('GET', '/finance/accounts')).body;
    expect(chart.find((a: { code: string }) => a.code === '2200')).toMatchObject({ name: 'Rent held for owners', balance: 30000 });
    expect(chart.find((a: { code: string }) => a.code === '4010').balance).toBe(0);

    // a repair on the flat, approved by the office
    const issue = (await t.call('POST', '/v1/issues', { token: rohit, body: { title: 'Geyser not heating', details: 'No hot water', category: 'Electrical', location: 'My flat (T2-0704)', priority: 'Medium', via: 'form' } })).body;
    const vendor = (await A('GET', '/vendor-list')).body.find((v: { category: string }) => v.category === 'Electrical');
    await A('POST', `/issues/${issue.ref}/status`, { to: 'Acknowledged' });
    await A('POST', `/issues/${issue.ref}/status`, { to: 'Assigned', vendorId: vendor.id });
    await A('POST', `/issues/${issue.ref}/invoices`, { amount: 1450, note: 'Heating element' });
    const inv = (await A('GET', '/invoices')).body.find((i: { issue: string }) => i.issue === issue.ref);
    await A('POST', `/invoices/${inv.id}/status`, { status: 'Approved' });
    expect((await A('GET', '/finance/accounts')).body.find((a: { code: string }) => a.code === '2200').balance).toBe(28550);
    expect((await A('GET', '/finance/accounts')).body.find((a: { code: string }) => a.code === '5000').balance).toBe(0); // not the society's cost

    const st = (await O('GET', '/statement')).body;
    expect(st.flats[0]).toMatchObject({ unit: 'T2-0704', rentBilled: 30000, rentCollected: 30000, rentPending: 0, repairs: 1450, repairsDeducted: 1450, net: 28550, paidOut: 0, heldForOwner: 28550, chargesPending: 3540 });

    expect((await A('POST', '/owners/payouts', { unitId: flat, amount: 40000 })).body.error.code).toBe('more_than_held');
    const paid = await A('POST', '/owners/payouts', { unitId: flat, amount: 20000, reference: 'NEFT-OWN-1' });
    expect(paid.status).toBe(201);
    expect((await O('GET', '/statement')).body.totals).toMatchObject({ paidOut: 20000, heldForOwner: 8550 });
    expect((await A('GET', '/finance/accounts')).body.find((a: { code: string }) => a.code === '2200').balance).toBe(8550); // the ledger agrees
    expect((await t.call('GET', '/v1/notifications', { token: rohit })).body[0]).toMatchObject({ kind: 'payments', title: '₹20,000 paid to you' });
    expect((await A('GET', '/finance/reports/balance-sheet')).body.balanced).toBe(true);
  });

  it('the dashboard sums it up in numbers and in words', async () => {
    const d = (await O('GET', '/dashboard')).body;
    expect(d).toMatchObject({ flats: 1, income: 30000, expenses: 1450, net: 28550, pendingRent: 0, upcomingPayout: 8550, openRequests: 1, approvalsWaiting: 0 });
    expect(d.occupancy).toEqual({ rented: 1, ownerOccupied: 0, vacant: 0 });
    expect(d.leaseExpiring).toEqual([{ unit: 'T2-0704', leaseEnd: day(30) }]);
    expect(d.summary).toContain('₹30,000 of rent has come in this month');
    expect(d.summary).toContain('The lease on T2-0704 ends within 60 days');
    // a vacant flat is called out with the rent it is not earning
    await A('PUT', `/owners/units/${other}`, { occupancy: 'Vacant', monthlyRent: 42000 });
    expect((await O('GET', '/dashboard', undefined, ananya)).body.summary).toContain('T4-1108 is vacant — about ₹42,000 a month of rent not being earned');
  });

  it('lists every money movement and the repair costs, and exports them', async () => {
    const tx = (await O('GET', '/transactions')).body.rows;
    expect(tx.map((x: { kind: string }) => x.kind).sort()).toEqual(['bill', 'bill', 'payment', 'payout', 'repair']);
    expect(tx.find((x: { kind: string }) => x.kind === 'repair')).toMatchObject({ moneyOut: 1450, unit: 'T2-0704' });
    expect((await O('GET', '/transactions?kind=payout')).body.rows).toHaveLength(1);
    const ex = (await O('GET', '/expenses')).body;
    expect(ex).toMatchObject({ total: 1450, byCategory: [{ name: 'Electrical', jobs: 1, amount: 1450 }] });
    const csv = await t.app.inject({ method: 'GET', url: '/v1/owner/statement?format=csv', headers: { authorization: 'Bearer ' + rohit } });
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('T2-0704,Prestige Lakeside Habitat,30000,30000,0,1450,1450,28550,20000,8550,3540');
  });

  it('a costly repair waits for the owner’s yes — and work can’t start until they answer', async () => {
    await A('PUT', '/owners/settings', { approveAbove: 5000 });
    const issue = (await t.call('POST', '/v1/issues', { token: rohit, body: { title: 'Bathroom seepage', details: 'Wall is damp', category: 'Plumbing', location: 'My flat (T2-0704)', priority: 'High', via: 'form' } })).body;
    const vendor = (await A('GET', '/vendor-list')).body.find((v: { category: string }) => v.category === 'Plumbing');
    await A('POST', `/issues/${issue.ref}/status`, { to: 'Acknowledged' });
    await A('POST', `/issues/${issue.ref}/status`, { to: 'Assigned', vendorId: vendor.id });
    await A('PUT', '/approval-limit', { limit: 100000 }); // the committee's own limit is not in the way
    await A('PUT', `/issues/${issue.ref}/estimate`, { amount: 12000 });
    expect((await t.call('GET', '/v1/notifications', { token: rohit })).body[0]).toMatchObject({ title: `Your approval is needed: ${issue.ref}`, href: '/owner/requests/' + issue.ref });
    const waiting = (await O('GET', '/requests?open=1')).body.find((r: { ref: string }) => r.ref === issue.ref);
    expect(waiting).toMatchObject({ costEstimate: 12000, ownerApproval: 'pending', canApprove: true });
    expect((await O('GET', '/dashboard')).body.approvalsWaiting).toBe(1);
    expect((await A('POST', `/issues/${issue.ref}/status`, { to: 'In Progress' })).body.error.code).toBe('owner_approval_pending');
    // only this flat's owner can answer
    expect((await O('POST', `/requests/${issue.ref}/approval`, { decision: 'approved' }, ananya)).status).toBe(404);
    expect((await O('POST', `/requests/${issue.ref}/approval`, { decision: 'approved', note: 'Please use branded tiles' })).body).toMatchObject({ ownerApproval: 'approved', canApprove: false });
    expect((await O('POST', `/requests/${issue.ref}/approval`, { decision: 'rejected' })).body.error.code).toBe('nothing_to_approve');
    expect((await A('POST', `/issues/${issue.ref}/status`, { to: 'In Progress' })).status).toBe(200);
    expect((await t.call('GET', '/v1/notifications', { token: admin })).body[0].title).toBe(`Owner approved: ${issue.ref}`);
    // the owner's note reaches the office as an internal note
    expect((await O('POST', `/requests/${issue.ref}/comment`, { text: 'Tenant is home after 6 pm.' })).status).toBe(201);
    const notes = (await A('GET', `/issues/${issue.ref}`)).body.internalNotes.map((n: { text: string }) => n.text);
    expect(notes).toEqual(['Owner approved the estimate of ₹12,000 — Please use branded tiles', 'Owner: Tenant is home after 6 pm.']);
    // a small repair doesn't trouble the owner
    await A('PUT', `/issues/${issue.ref}/estimate`, { amount: 900 });
    expect((await O('GET', `/requests/${issue.ref}`)).body.ownerApproval).toBe('none');
  });

  it('the office decides what owners see', async () => {
    expect((await O('GET', '/society-accounts?associationId=' + t.associationId)).status).toBe(403); // off unless shared
    await A('PUT', '/owners/settings', { reports: { societyAccounts: true, transactions: false }, showCosts: false, showMessages: true });
    const acc = (await O('GET', '/society-accounts?associationId=' + t.associationId)).body;
    expect(acc.liabilities.find((l: { name: string }) => l.name === 'Rent held for owners').amount).toBe(8550);
    expect((await O('GET', '/transactions')).status).toBe(403);
    const reqs = (await O('GET', '/requests')).body;
    expect(reqs[0].costEstimate).toBeUndefined();
    expect((await O('GET', `/requests/${reqs[0].ref}`)).body).toMatchObject({ invoices: [], messages: [] });
    await A('PUT', '/owners/settings', { showRequests: false });
    expect((await O('GET', '/requests')).body).toEqual([]);
    expect((await O('GET', `/requests/${reqs[0].ref}`)).status).toBe(404);
    await A('PUT', '/owners/settings', { enabled: false });
    expect((await O('GET', '/dashboard')).status).toBe(403);
    await A('PUT', '/owners/settings', { enabled: true, showRequests: true, showCosts: true, reports: { transactions: true } });
    expect((await O('GET', '/dashboard')).status).toBe(200);
  });

  it('documents are shared per flat or with every owner, and the office sees what was opened', async () => {
    expect((await A('POST', '/documents', { title: 'Lease', kind: 'Lease', fileUrl: 'https://evil.example/x.pdf', unitId: flat })).body.error.code).toBe('bad_attachment');
    const lease = await A('POST', '/documents', { title: 'Lease agreement 2026', kind: 'Lease', fileUrl: 'http://api.test/files/lease.pdf', unitId: flat });
    expect(lease.status).toBe(201);
    expect(lease.body).toMatchObject({ unit: 'T2-0704', shared: true });
    await A('POST', '/documents', { title: 'Building insurance', kind: 'Insurance', fileUrl: 'http://api.test/files/ins.pdf' });
    const hidden = (await A('POST', '/documents', { title: 'Committee minutes (draft)', kind: 'Other', fileUrl: 'http://api.test/files/min.pdf', shared: false })).body;
    expect((await O('GET', '/documents')).body.map((d: { title: string }) => d.title).sort()).toEqual(['Building insurance', 'Lease agreement 2026']);
    expect((await O('GET', '/documents', undefined, ananya)).body.map((d: { title: string }) => d.title)).toEqual(['Building insurance']);
    expect((await O('POST', `/documents/${lease.body.id}/opened`, undefined, ananya)).status).toBe(404);
    expect((await O('POST', `/documents/${hidden.id}/opened`)).status).toBe(404);
    expect((await O('POST', `/documents/${lease.body.id}/opened`)).status).toBe(200);
    expect((await A('PUT', `/documents/${hidden.id}`, { shared: true })).body.shared).toBe(true);
    expect((await O('GET', '/documents')).body).toHaveLength(3);
    const log = (await A('GET', '/owners/activity')).body;
    expect(log[0]).toMatchObject({ name: 'Rohit Sharma', action: 'Opened “Lease agreement 2026”' });
    expect(log.some((l: { action: string }) => l.action === 'Viewed the owner statement')).toBe(true);
    expect((await A('GET', '/owners')).body.find((f: { unit: string }) => f.unit === 'T2-0704')).toMatchObject({ owner: 'Rohit Sharma', occupancy: 'Rented', heldForOwner: 8550 });
    expect((await A('GET', '/owners')).body.find((f: { unit: string }) => f.unit === 'T2-0704').lastSeen).toBeTruthy();
    expect((await A('DELETE', `/documents/${hidden.id}`)).status).toBe(204);
    // owners and residents can't reach the office's side
    expect((await t.call('GET', `/v1/admin/${t.associationId}/owners`, { token: rohit })).status).toBe(403);
  });
  it('the office opens one flat in full: owner, money, bills, repairs, documents and activity', async () => {
    const list = (await A('GET', '/owners')).body.find((f: { unitId: string }) => f.unitId === flat);
    const d = (await A('GET', `/owners/units/${flat}`)).body;
    expect(d.flat).toMatchObject({ unitId: flat, unit: 'T2-0704', occupancy: list.occupancy, monthlyRent: list.monthlyRent });
    const owner = d.people.find((p: { role: string }) => p.role === 'Owner');
    expect(owner).toMatchObject({ name: 'Rohit Sharma', phone: '9900112233', status: 'active', standing: 'Active' });
    expect(owner.userId).toBeUndefined();
    // the same figures as the list, and they add up
    expect(d.money).toMatchObject({ heldForOwner: list.heldForOwner, rentPending: list.rentPending, duesOnFlat: list.duesOnFlat });
    expect(d.money.heldForOwner).toBe(d.money.rentCollected - d.money.repairsDeducted - d.money.paidOut);
    // what the earlier tests did on this flat is all here
    expect(d.bills.some((b: { chargeType: string }) => b.chargeType === 'Rent')).toBe(true);
    expect(d.payments.length).toBeGreaterThan(0);
    expect(d.payouts.length).toBeGreaterThan(0);
    expect(d.payouts.reduce((n: number, p: { amount: number }) => n + p.amount, 0)).toBe(d.money.paidOut);
    expect(d.repairs.every((r: { issue: string }) => /^ISS-\d+$/.test(r.issue))).toBe(true);
    expect(d.activity.every((a: { name: string }) => a.name === 'Rohit Sharma')).toBe(true);
    expect(d.lastSeen).toBe(d.activity[0]?.at ?? null);
    // only this flat's documents and the ones for every owner — never another flat's
    expect(d.documents.every((x: { forAll: boolean }) => typeof x.forAll === 'boolean')).toBe(true);
    const elsewhere = (await A('GET', `/owners/units/${other}`)).body;
    expect(elsewhere.flat.unit).toBe('T4-1108');
    expect(elsewhere.people.some((p: { name: string }) => p.name === 'Rohit Sharma')).toBe(false);
    // the office only: not an owner, and not a flat that doesn't exist
    expect((await A('GET', `/owners/units/${flat}`, undefined, rohit)).status).toBe(403);
    expect((await A('GET', '/owners/units/00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });
  it('the list of flats is paged, searched, filtered and sorted by the server', async () => {
    const all = (await A('GET', '/owners')).body as { unitId: string; unit: string; occupancy: string; owner: string | null; monthlyRent: number }[];
    expect(all).toHaveLength(5); // without `page`, the whole list, as the dropdowns need
    const first = (await A('GET', '/owners?page=1&limit=2')).body;
    expect(first).toMatchObject({ total: 5, page: 1, limit: 2, pages: 3 });
    expect(first.items.map((f: { unit: string }) => f.unit)).toEqual(all.slice(0, 2).map(f => f.unit));
    // the same rows as the full list carries — figures and all — just fewer of them
    expect(first.items[0]).toEqual(all[0]);
    const lastPage = (await A('GET', '/owners?page=3&limit=2')).body;
    expect(lastPage.items).toHaveLength(1);
    expect((await A('GET', '/owners?page=9&limit=2')).body).toMatchObject({ items: [], total: 5 });
    // search: a flat number, an owner's name, a phone number
    expect((await A('GET', '/owners?page=1&q=0704')).body.items.map((f: { unit: string }) => f.unit)).toEqual(['T2-0704']);
    expect((await A('GET', '/owners?page=1&q=rohit')).body).toMatchObject({ total: 1, items: [{ unit: 'T2-0704', owner: 'Rohit Sharma' }] });
    expect((await A('GET', '/owners?page=1&q=9900112233')).body.total).toBe(1);
    expect((await A('GET', '/owners?page=1&q=' + encodeURIComponent('%'))).body.total).toBe(5); // a typed % is not a wildcard that matches nothing
    // filters, and the two together
    const rented = all.filter(f => f.occupancy === 'Rented').length;
    expect((await A('GET', '/owners?page=1&occ=Rented')).body.total).toBe(rented);
    expect((await A('GET', '/owners?page=1&owner=No')).body.total).toBe(all.filter(f => !f.owner).length);
    expect((await A('GET', '/owners?page=1&owner=Yes&q=rohit')).body.total).toBe(1);
    expect((await A('GET', '/owners?page=1&occ=Nonsense')).status).toBe(400);
    // sort by rent, highest first
    const byRent = (await A('GET', '/owners?page=1&limit=5&sort=rent')).body.items as { monthlyRent: number }[];
    expect(byRent.map(f => f.monthlyRent)).toEqual([...all].map(f => f.monthlyRent).sort((x, y) => y - x));
    // a page can be at most a hundred
    expect((await A('GET', '/owners?page=1&limit=500')).status).toBe(400);
    // the figures over the table are for the whole society, not the page
    const sum = (await A('GET', '/owners/summary')).body;
    expect(sum).toMatchObject({ flats: 5, let: rented, vacant: all.filter(f => f.occupancy === 'Vacant').length });
    expect((await A('GET', '/owners?page=1', undefined, rohit)).status).toBe(403);
    expect((await A('GET', '/owners/summary', undefined, rohit)).status).toBe(403);
  });
});
