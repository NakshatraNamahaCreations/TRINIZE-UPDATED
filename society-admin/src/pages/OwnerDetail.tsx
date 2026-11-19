import { formBox } from '../lib/dialog';
import { ArrowLeft, Buildings, FileText, HandCoins, Key, Receipt, Ticket, UsersThree, Wrench } from '@phosphor-icons/react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useToast } from '../components/toast-context';
import { Avatar, Empty, Facts, Pill, Stat } from '../components/ui';
import { api, ApiError, LIVE } from '../lib/api';
import { association } from '../lib/live';

/* One flat and its owner, in full: who owns it and who lives there, the money (rent, society charges,
   repairs, what is held for the owner and what has been paid out), every bill and receipt, the repairs
   and issues on the flat, the documents shared with its owner, and what the owner has opened in the portal. */

type Tone = 'good' | 'warn' | 'bad' | 'acc' | 'dim';
type Detail = {
  flat: { unitId: string; unit: string; label: string; tower: string; area: number; flatType: string; occupancy: 'Owner-occupied' | 'Rented' | 'Vacant'; monthlyRent: number; leaseEnd: string | null };
  people: { memberId: string; name: string; phone: string | null; role: 'Owner' | 'Tenant' | 'Family'; status: 'active' | 'pending'; since: string; standing: string }[];
  lastSeen: string | null;
  money: { rentBilled: number; rentCollected: number; rentPending: number; chargesBilled: number; chargesPaid: number; chargesPending: number; repairs: number; repairsDeducted: number; paidOut: number; heldForOwner: number; duesOnFlat: number };
  bills: { number: string; period: string; chargeType: string; description: string; amount: number; paid: number; due: number; dueDate: string; status: string }[];
  payments: { number: string; amount: number; mode: string; reference: string; receivedOn: string; payerName: string; reversed: boolean }[];
  payouts: { id: string; amount: number; paidOn: string; mode: string; reference: string; note: string; byName: string }[];
  repairs: { issue: string; title: string; category: string; vendor: string; amount: number; status: string; fileUrl: string | null; at: string; charged: boolean }[];
  issues: { ref: string; title: string; category: string; priority: string; status: string; createdAt: string; by: string | null }[];
  documents: { id: string; title: string; kind: string; fileUrl: string; shared: boolean; forAll: boolean; byName: string; createdAt: string }[];
  visits: { id: string; who: string; visitorType: string; status: string; createdAt: string }[];
  activity: { name: string; action: string; at: string }[];
};

const OCC_TONE = { 'Owner-occupied': 'dim', Rented: 'good', Vacant: 'warn' } as const;
const BILL_TONE: Record<string, Tone> = { Paid: 'good', Overdue: 'bad', Due: 'warn', 'Part-paid': 'warn', Waived: 'dim', Cancelled: 'dim' };
const rupees = (n: number) => (n < 0 ? '−' : '') + '₹' + Math.abs(n).toLocaleString('en-IN');
const money = (n: number) => (n ? rupees(n) : '—');
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');
const small = { fontSize: 12, color: 'var(--ink3)' } as const;
const issueTone = (s: string): Tone => (s === 'Resolved' || s === 'Closed' ? 'good' : s === 'Submitted' ? 'dim' : 'acc');

/** a titled block; the count sits by the heading so an empty section still says so at a glance */
function Section({ icon: Icon, title, count, children }: { icon: typeof Key; title: string; count?: number; children: ReactNode }) {
  return (
    <section className="card" style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Icon size={18} color="var(--acc)" /><b style={{ fontSize: 15 }}>{title}</b>{count !== undefined && <span className="num" style={small}>{count}</span>}
      </div>
      {children}
    </section>
  );
}
const None = ({ children }: { children: ReactNode }) => <div style={{ ...small, fontSize: 13, padding: '4px 0' }}>{children}</div>;

export function OwnerDetail() {
  const { unitId } = useParams();
  const toast = useToast();
  const [d, setD] = useState<Detail | null>(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(() => {
    if (!LIVE || !unitId) return;
    api<Detail>('GET', `/v1/admin/${association()}/owners/units/${unitId}`).then(x => { setD(x); setMissing(false); })
      .catch(e => { if (e instanceof ApiError && (e.status === 404 || e.status === 400)) setMissing(true); else toast(e instanceof ApiError ? e.message : 'That didn’t load.', undefined, 'warn'); });
  }, [unitId, toast]);
  useEffect(load, [load]);

  const back = <Link to="/owners" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 700, color: 'var(--acc-ink)' }}><ArrowLeft size={14} />All owners</Link>;
  if (!LIVE || missing) return <>{back}<Empty icon={Key} title={missing ? 'That flat wasn’t found' : 'Connect the console to the API'} body={missing ? 'It may have been removed. Go back to the list of owners.' : 'Owner records are kept on the server.'} /></>;
  if (!d) return <>{back}<div style={{ ...small, marginTop: 20 }}>Loading…</div></>;

  const { flat, money: m } = d;
  const owners = d.people.filter(p => p.role === 'Owner'), tenants = d.people.filter(p => p.role === 'Tenant');
  const payOut = async () => {
    const v = await formBox({ title: `Pay the owner of ${flat.unit}`, body: `${rupees(m.heldForOwner)} is held for them. You can pay all of it or part.`, confirm: 'Record payout', fields: [
      { key: 'amount', label: 'Amount (₹)', type: 'number', value: String(m.heldForOwner), required: true },
      { key: 'reference', label: 'Bank reference', hint: 'Optional.' },
    ] });
    const amount = Number((v?.amount ?? '').replace(/[^\d]/g, ''));
    if (!v || !amount) return;
    const reference = v.reference?.trim() ?? '';
    api('POST', `/v1/admin/${association()}/owners/payouts`, { unitId: flat.unitId, amount, reference }).then(() => { toast(`${rupees(amount)} paid to the owner`, flat.unit); load(); })
      .catch(e => toast(e instanceof ApiError ? e.message : 'That didn’t go through.', undefined, 'warn'));
  };

  return (
    <>
      {back}
      <div className="phead" style={{ marginTop: 10 }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          {owners[0] && <Avatar name={owners[0].name} size={54} />}
          <div>
            <h1>{owners.length ? owners.map(o => o.name).join(' & ') : 'No owner on the app'}</h1>
            <div className="sub">Flat <b className="num">{flat.unit}</b> · {flat.label}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              <Pill tone={OCC_TONE[flat.occupancy]}>{flat.occupancy}</Pill>
              {flat.flatType && <Pill tone="dim">{flat.flatType}</Pill>}
              {m.duesOnFlat > 0 && <Pill tone="bad">{rupees(m.duesOnFlat)} due</Pill>}
              {m.heldForOwner > 0 && <Pill tone="acc">{rupees(m.heldForOwner)} held for owner</Pill>}
            </div>
          </div>
        </div>
        {m.heldForOwner > 0 && <button className="a-btn" onClick={payOut}><HandCoins size={15} />Pay owner</button>}
      </div>

      <div className="stats">
        <Stat icon={HandCoins} label="Held for owner" value={rupees(m.heldForOwner)} tone={m.heldForOwner > 0 ? 'acc' : undefined} />
        <Stat icon={Receipt} label="Due on this flat" value={rupees(m.duesOnFlat)} tone={m.duesOnFlat > 0 ? 'bad' : 'good'} />
        <Stat icon={HandCoins} label="Rent collected" value={rupees(m.rentCollected)} />
        <Stat icon={Wrench} label="Spent on repairs" value={rupees(m.repairs)} />
        <Stat icon={HandCoins} label="Paid out to owner" value={rupees(m.paidOut)} />
      </div>

      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', marginTop: 14 }}>
        <section className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}><Key size={18} color="var(--acc)" /><b style={{ fontSize: 15 }}>Owner</b></div>
          {owners.length ? owners.map(o => (
            <Facts key={o.memberId} items={{
              Name: o.name,
              Phone: o.phone ? <span className="num">+91 {o.phone}</span> : 'Not on record',
              'On the app since': day(o.since),
              Standing: <Pill tone={o.standing === 'Active' ? 'good' : o.standing === 'Warned' ? 'warn' : 'bad'} dot>{o.standing}</Pill>,
              'Last opened the owner portal': when(d.lastSeen),
            }} />
          )) : <None>No owner is registered for this flat. Register one under <Link to="/residents" style={{ color: 'var(--acc-ink)', fontWeight: 700 }}>Residents</Link>.</None>}
        </section>
        <section className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}><Buildings size={18} color="var(--acc)" /><b style={{ fontSize: 15 }}>Flat</b></div>
          <Facts items={{
            Flat: <span className="num">{flat.unit}</span>,
            Tower: flat.tower || '—',
            Type: flat.flatType || '—',
            Area: flat.area ? <span className="num">{flat.area.toLocaleString('en-IN')} sq ft</span> : '—',
            'Occupied by': flat.occupancy,
            ...(flat.occupancy === 'Rented' ? { Tenant: tenants.map(t => t.name).join(', ') || 'Not on the app', 'Monthly rent': <span className="num">{money(flat.monthlyRent)}</span>, 'Lease ends': day(flat.leaseEnd) } : {}),
          }} />
        </section>
      </div>

      <Section icon={HandCoins} title="Money, all time">
        <div className="a-tbl-wrap"><table className="a-tbl compact"><tbody>
          <tr><th /><th>Billed</th><th>Received</th><th>Still pending</th></tr>
          <tr><td>Rent from the tenant</td><td className="num">{money(m.rentBilled)}</td><td className="num">{money(m.rentCollected)}</td><td className="num" style={m.rentPending ? { color: 'var(--bad)', fontWeight: 700 } : undefined}>{money(m.rentPending)}</td></tr>
          <tr><td>Maintenance and other society charges</td><td className="num">{money(m.chargesBilled)}</td><td className="num">{money(m.chargesPaid)}</td><td className="num" style={m.chargesPending ? { color: 'var(--bad)', fontWeight: 700 } : undefined}>{money(m.chargesPending)}</td></tr>
        </tbody></table></div>
        <div style={{ marginTop: 12 }}>
          <Facts items={{
            'Rent collected': <span className="num">{rupees(m.rentCollected)}</span>,
            'Less repairs taken from the rent': <span className="num">{m.repairsDeducted ? '− ' + rupees(m.repairsDeducted) : '—'}</span>,
            'Less paid out to the owner': <span className="num">{m.paidOut ? '− ' + rupees(m.paidOut) : '—'}</span>,
            'Held for the owner now': <b className="num">{rupees(m.heldForOwner)}</b>,
          }} />
        </div>
        {m.repairs > m.repairsDeducted && <div style={{ ...small, marginTop: 8 }}>{rupees(m.repairs - m.repairsDeducted)} of repairs on this flat was borne by the society, not taken from the owner’s rent.</div>}
      </Section>

      <Section icon={UsersThree} title="Who lives here" count={d.people.length}>
        {d.people.length ? (
          <div className="a-tbl-wrap"><table className="a-tbl compact"><tbody>
            <tr><th>Name</th><th>Phone</th><th>Lives here as</th><th>Since</th><th>On the app</th></tr>
            {d.people.map(p => (
              <tr key={p.memberId}><td><span className="who-cell"><Avatar name={p.name} size={26} /><span className="cell-t">{p.name}</span></span></td>
                <td className="num">{p.phone ? '+91 ' + p.phone : '—'}</td><td><Pill tone={p.role === 'Owner' ? 'acc' : 'dim'}>{p.role}</Pill></td><td>{day(p.since)}</td>
                <td><Pill tone={p.status === 'pending' ? 'warn' : p.standing === 'Blocked' ? 'bad' : 'good'}>{p.status === 'pending' ? 'Awaiting verification' : p.standing === 'Blocked' ? 'Blocked' : 'Active'}</Pill></td></tr>
            ))}
          </tbody></table></div>
        ) : <None>Nobody is registered in this flat.</None>}
      </Section>

      <Section icon={Receipt} title="Bills" count={d.bills.length}>
        {d.bills.length ? (
          <div className="a-tbl-wrap"><table className="a-tbl compact"><tbody>
            <tr><th>Bill</th><th>For</th><th>Month</th><th>Amount</th><th>Paid</th><th>Still due</th><th>Due date</th><th>Status</th></tr>
            {d.bills.map(b => (
              <tr key={b.number}><td className="num">{b.number}</td><td>{b.chargeType}{b.description && <div style={small}>{b.description}</div>}</td><td className="num">{b.period}</td><td className="num">{rupees(b.amount)}</td>
                <td className="num">{money(b.paid)}</td><td className="num">{b.due ? <b style={{ color: 'var(--bad)' }}>{rupees(b.due)}</b> : '—'}</td><td>{day(b.dueDate)}</td><td><Pill tone={BILL_TONE[b.status] ?? 'dim'}>{b.status}</Pill></td></tr>
            ))}
          </tbody></table></div>
        ) : <None>No bill has been raised on this flat.</None>}
      </Section>

      <Section icon={Receipt} title="Payments received" count={d.payments.length}>
        {d.payments.length ? (
          <div className="a-tbl-wrap"><table className="a-tbl compact"><tbody>
            <tr><th>Receipt</th><th>Date</th><th>Amount</th><th>How</th><th>Paid by</th></tr>
            {d.payments.map(p => (
              <tr key={p.number} style={p.reversed ? { opacity: 0.55 } : undefined}><td className="num">{p.number}</td><td>{day(p.receivedOn)}</td><td className="num"><b>{rupees(p.amount)}</b></td>
                <td>{p.mode}{p.reference ? ' · ' + p.reference : ''}{p.reversed && <Pill tone="bad">Reversed</Pill>}</td><td>{p.payerName || '—'}</td></tr>
            ))}
          </tbody></table></div>
        ) : <None>No payment has been recorded for this flat.</None>}
      </Section>

      <Section icon={HandCoins} title="Paid out to the owner" count={d.payouts.length}>
        {d.payouts.length ? (
          <div className="a-tbl-wrap"><table className="a-tbl compact"><tbody>
            <tr><th>Date</th><th>Amount</th><th>How</th><th>By</th></tr>
            {d.payouts.map(p => <tr key={p.id}><td>{day(p.paidOn)}</td><td className="num"><b>{rupees(p.amount)}</b></td><td>{p.mode}{p.reference ? ' · ' + p.reference : ''}{p.note && <div style={small}>{p.note}</div>}</td><td>{p.byName}</td></tr>)}
          </tbody></table></div>
        ) : <None>Nothing has been paid out to this flat’s owner.</None>}
      </Section>

      <Section icon={Wrench} title="Repairs paid for" count={d.repairs.length}>
        {d.repairs.length ? (
          <div className="a-tbl-wrap"><table className="a-tbl compact"><tbody>
            <tr><th>Issue</th><th>Work</th><th>Vendor</th><th>Amount</th><th>Paid from</th><th>Bill</th></tr>
            {d.repairs.map((r, i) => (
              <tr key={i}><td className="num"><Link to={`/issues?open=${r.issue}`} style={{ color: 'var(--acc-ink)', fontWeight: 700 }}>{r.issue}</Link></td><td>{r.title}<div style={small}>{r.category} · {day(r.at)}</div></td><td>{r.vendor}</td>
                <td className="num"><b>{rupees(r.amount)}</b></td><td>{r.charged ? 'Owner’s rent' : 'Society'}</td><td>{r.fileUrl ? <a href={r.fileUrl} target="_blank" rel="noreferrer">{r.status}</a> : r.status}</td></tr>
            ))}
          </tbody></table></div>
        ) : <None>No repair on this flat has been billed.</None>}
      </Section>

      <Section icon={Ticket} title="Issues on this flat" count={d.issues.length}>
        {d.issues.length ? (
          <div className="a-tbl-wrap"><table className="a-tbl compact"><tbody>
            <tr><th>Issue</th><th>What</th><th>Raised by</th><th>Raised</th><th>Priority</th><th>Status</th></tr>
            {d.issues.map(i => (
              <tr key={i.ref}><td className="num"><Link to={`/issues?open=${i.ref}`} style={{ color: 'var(--acc-ink)', fontWeight: 700 }}>{i.ref}</Link></td><td>{i.title}<div style={small}>{i.category}</div></td><td>{i.by ?? '—'}</td>
                <td>{day(i.createdAt)}</td><td>{i.priority}</td><td><Pill tone={issueTone(i.status)} dot>{i.status}</Pill></td></tr>
            ))}
          </tbody></table></div>
        ) : <None>No issue has been raised from this flat.</None>}
      </Section>

      <Section icon={FileText} title="Documents the owner can open" count={d.documents.length}>
        {d.documents.length ? (
          <div className="a-tbl-wrap"><table className="a-tbl compact"><tbody>
            <tr><th>Document</th><th>Kind</th><th>For</th><th>Added</th><th>Owner sees it</th></tr>
            {d.documents.map(x => (
              <tr key={x.id}><td><a href={x.fileUrl} target="_blank" rel="noreferrer" className="cell-t">{x.title}</a></td><td>{x.kind}</td><td>{x.forAll ? 'Every owner' : 'This flat'}</td>
                <td>{day(x.createdAt)}<div style={small}>{x.byName}</div></td><td><Pill tone={x.shared ? 'good' : 'dim'}>{x.shared ? 'Yes' : 'Hidden'}</Pill></td></tr>
            ))}
          </tbody></table></div>
        ) : <None>No document has been shared with this flat. Add one from Owners → Documents.</None>}
      </Section>

      <Section icon={UsersThree} title="Recent visitors and deliveries" count={d.visits.length}>
        {d.visits.length ? (
          <div className="a-tbl-wrap"><table className="a-tbl compact"><tbody>
            <tr><th>When</th><th>Who</th><th>Type</th><th>Status</th></tr>
            {d.visits.map(v => <tr key={v.id}><td>{when(v.createdAt)}</td><td>{v.who}</td><td>{v.visitorType}</td><td>{v.status}</td></tr>)}
          </tbody></table></div>
        ) : <None>No visitor or delivery has been logged for this flat.</None>}
      </Section>

      <Section icon={Key} title="What the owner did in the portal" count={d.activity.length}>
        {d.activity.length ? (
          <div className="a-tbl-wrap"><table className="a-tbl compact"><tbody>
            <tr><th>When</th><th>Owner</th><th>What they did</th></tr>
            {d.activity.map((l, i) => <tr key={i}><td className="num">{when(l.at)}</td><td>{l.name}</td><td>{l.action}</td></tr>)}
          </tbody></table></div>
        ) : <None>The owner has not opened the owner portal yet.</None>}
      </Section>
    </>
  );
}
