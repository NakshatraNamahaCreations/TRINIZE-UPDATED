import { ChartBar, CheckCircle, ClockCountdown, PencilSimple, Receipt, Siren, Wrench, ArrowCounterClockwise, Check, Prohibit, X } from '@phosphor-icons/react';
import { TableCard } from '../components/TableCard';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useToast } from '../components/toast-context';
import { Empty, PageHead, Pill, Stat, IconBtn } from '../components/ui';
import { ApiError, LIVE } from '../lib/api';
import { confirmBox, formBox } from '../lib/dialog';
import { addVendor, invoiceList, logRequest, report, rupees, saveVendor, setInvoice, setVendorActive, vendorList, type Invoice, type Report, type Vendor } from '../lib/maintenance';
import { useStore } from '../store/context';

const CATEGORIES = ['Electrical', 'Plumbing', 'Lifts', 'Sanitation', 'HVAC', 'Pest control', 'Appliance', 'Security', 'General maintenance'];
const ASSETS = ['Lift', 'STP', 'Water motor', 'Generator', 'CCTV', 'Gate / security cabin', 'Parking area', 'Clubhouse', 'Garden', 'Corridor lights', 'Sump / tank', 'Drainage'];
const INV_TONE = { Pending: 'warn', Approved: 'acc', Paid: 'good', Rejected: 'bad' } as const;
type Tab = 'vendors' | 'invoices' | 'report' | 'log';

/** Vendors, their invoices, the maintenance report, and logging a common-area job. Connected mode only. */
export function Maintenance() {
  const toast = useToast();
  const { actions } = useStore();
  const [tab, setTab] = useState<Tab>('vendors');
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [rep, setRep] = useState<Report | null>(null);
  const [form, setForm] = useState({ name: '', category: CATEGORIES[1], contact: '', phone: '', serviceArea: '' });
  const [job, setJob] = useState({ title: '', category: CATEGORIES[0], asset: ASSETS[0], location: '', priority: 'Medium' });

  const fail = useCallback((e: unknown) => toast(e instanceof ApiError ? e.message : 'That didn’t go through.', undefined, 'warn'), [toast]);
  const load = useCallback(() => {
    if (!LIVE) return;
    vendorList().then(setVendors).catch(fail);
    invoiceList().then(setInvoices).catch(fail);
    report().then(setRep).catch(fail);
  }, [fail]);
  useEffect(load, [load]);

  if (!LIVE) {
    return (
      <>
        <PageHead title="Maintenance" sub="Vendors, invoices and reports." />
        <Empty icon={Wrench} title="Connect the console to the API" body="Vendors, invoices and maintenance reports come from the server. Set VITE_API_URL to use them." />
      </>
    );
  }

  /** change a vendor's details: the name, trade and how to reach them */
  const editVendor = async (v: Vendor) => {
    const r = await formBox({ title: `Edit ${v.name}`, confirm: 'Save changes', fields: [
      { key: 'name', label: 'Vendor name', value: v.name, required: true },
      { key: 'category', label: 'Trade', value: v.category, options: CATEGORIES.includes(v.category) ? CATEGORIES : [v.category, ...CATEGORIES] },
      { key: 'contact', label: 'Contact person', value: v.contact },
      { key: 'phone', label: 'Phone', value: v.phone, hint: 'The number you call them on about a job.' },
      { key: 'email', label: 'Email', value: v.email ?? '', placeholder: 'Optional' },
      { key: 'serviceArea', label: 'Service area', value: v.serviceArea },
    ] });
    if (!r) return;
    const name = r.name!.trim(), email = r.email?.trim() ?? '';
    if (name.length < 2) { toast('Give the vendor a name.', undefined, 'warn'); return; }
    saveVendor(v.id, { name, category: r.category!, contact: r.contact!.trim(), phone: r.phone!.trim(), serviceArea: r.serviceArea!.trim(), ...(email ? { email } : {}) })
      .then(() => { toast('Vendor updated', name); load(); }).catch(fail);
  };
  /** a deactivated vendor keeps their history but can no longer be given a job */
  const toggleVendor = async (v: Vendor) => {
    if (v.active && !(await confirmBox(`Deactivate ${v.name}? They keep their past jobs and invoices, but can no longer be assigned new work.${v.openJobs ? ` They have ${v.openJobs} open job${v.openJobs === 1 ? '' : 's'} — reassign those first.` : ''}`, { confirm: 'Deactivate', danger: true }))) return;
    setVendorActive(v.id, !v.active).then(() => { toast(v.active ? 'Vendor deactivated' : 'Vendor reactivated', v.name); load(); }).catch(fail);
  };
  const submitVendor = (e: FormEvent) => {
    e.preventDefault();
    if (form.name.trim().length < 2) { toast('Enter the vendor’s name.', undefined, 'warn'); return; }
    addVendor({ name: form.name.trim(), category: form.category, contact: form.contact.trim(), serviceArea: form.serviceArea.trim(), phone: form.phone.trim() })
      .then(() => { toast('Vendor added', 'You can now assign jobs to them.'); setForm({ name: '', category: CATEGORIES[1], contact: '', phone: '', serviceArea: '' }); load(); })
      .catch(fail);
  };
  const submitJob = (e: FormEvent) => {
    e.preventDefault();
    if (job.title.trim().length < 4) { toast('Describe the job in a few words.', undefined, 'warn'); return; }
    logRequest({ title: job.title.trim(), category: job.category, asset: job.asset, location: job.location.trim() || job.asset, priority: job.priority })
      .then(r => { toast(r.ref + ' logged', 'It’s in the Issues queue.'); setJob(j => ({ ...j, title: '', location: '' })); actions.refresh(); load(); })
      .catch(fail);
  };
  const decide = (inv: Invoice, status: 'Approved' | 'Paid' | 'Rejected') =>
    setInvoice(inv.id, status).then(() => { toast(`Invoice ${status.toLowerCase()}`, `${inv.vendor} · ${rupees(inv.amount)}`); load(); }).catch(fail);

  const pending = invoices.filter(i => i.status === 'Pending').length;
  const t = rep?.totals;

  return (
    <>
      <PageHead title="Maintenance" sub="The vendors this society uses, their bills to approve and pay, and how the work is going. Estimates, approvals, vendor progress and messages are on each issue." />
      <div className="stats">
        <Stat icon={Wrench} label="Open work (30 days)" value={t?.open ?? 0} />
        <Stat icon={CheckCircle} label="Completed" value={t?.completed ?? 0} tone="good" />
        <Stat icon={ClockCountdown} label="Missed response time" value={t?.sla_missed ?? 0} tone={t?.sla_missed ? 'bad' : undefined} />
        <Stat icon={Siren} label="Emergencies" value={t?.emergency ?? 0} tone={t?.emergency ? 'warn' : undefined} />
        <Stat icon={Receipt} label="Invoices to review" value={pending} tone={pending ? 'warn' : undefined} />
      </div>
      <div className="toolbar" style={{ gap: 6 }}>
        {([['vendors', 'Vendors'], ['invoices', `Invoices${pending ? ` (${pending})` : ''}`], ['report', 'Report'], ['log', 'Log a common-area job']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} className={'a-btn' + (tab === k ? '' : ' ghost')} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'vendors' && (
        <>
          <TableCard rows={vendors} noun="vendor" search={v => [v.name, v.category, v.contact, v.phone, v.serviceArea]} placeholder="Search vendors by name, trade, contact or phone"
            filters={[{ key: 'trade', label: 'Trade', get: v => v.category }, { key: 'state', label: 'Status', get: v => (v.active ? 'Active' : 'Inactive'), options: ['Active', 'Inactive'] }]}
            sorts={[{ label: 'Most open jobs', by: v => v.openJobs, dir: 'desc' }, { label: 'Best rated', by: v => v.rating ?? 0, dir: 'desc' }, { label: 'Name', by: v => v.name.toLowerCase() }]}
            csv={{ name: 'vendors', head: ['Vendor', 'Trade', 'Contact', 'Phone', 'Service area', 'Open jobs', 'Rating'], row: v => [v.name, v.category, v.contact, v.phone, v.serviceArea, v.openJobs, v.rating ?? ''] }}>{(page, sl) => (<div className="a-tbl-wrap">
            <table className="a-tbl">
              <tbody>
                <tr><th className="sl">Sl. no.</th><th>Vendor</th><th>Trade</th><th>Contact</th><th>Open jobs</th><th>Rating</th><th /></tr>
                {page.map((v, rowNo) => (
                  <tr key={v.id} style={v.active ? undefined : { opacity: 0.55 }}><td className="sl num">{sl(rowNo)}</td>
                    <td><span className="cell-t">{v.name}</span>{v.serviceArea && <div style={{ fontSize: 12, color: 'var(--ink3)' }}>{v.serviceArea}</div>}</td>
                    <td data-l="Trade">{v.category}</td>
                    <td data-l="Contact">{v.contact || '—'}{v.phone && <div className="num" style={{ fontSize: 12, color: 'var(--ink3)' }}>{v.phone}</div>}</td>
                    <td data-l="Open jobs" className="num">{v.openJobs}</td>
                    <td data-l="Rating" className="num">{v.rating ?? '—'}</td>
                    <td><IconBtn icon={PencilSimple} label="Edit vendor" onClick={() => editVendor(v)} /><IconBtn icon={v.active ? Prohibit : ArrowCounterClockwise} label={v.active ? 'Deactivate' : 'Reactivate'} tone={v.active ? 'danger' : 'good'} onClick={() => toggleVendor(v)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>)}</TableCard>
          <form onSubmit={submitVendor} className="card" style={{ marginTop: 14, display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', alignItems: 'end' }}>
            <label>Vendor name<input className="a-in" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. PestAway Services" /></label>
            <label>Trade<select className="a-in" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></label>
            <label>Contact person<input className="a-in" value={form.contact} onChange={e => setForm({ ...form, contact: e.target.value })} /></label>
            <label>Phone<input className="a-in" inputMode="tel" maxLength={20} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="To call them about a job" /></label>
            <label>Service area<input className="a-in" value={form.serviceArea} onChange={e => setForm({ ...form, serviceArea: e.target.value })} /></label>
            <button className="a-btn" type="submit">Add vendor</button>
          </form>
        </>
      )}

      {tab === 'invoices' && (invoices.length ? (
        <TableCard rows={invoices} noun="invoice" search={x => [x.issue, x.title, x.vendor, x.note]} placeholder="Search by issue, vendor or note"
          filters={[{ key: 'status', label: 'Status', get: x => x.status, options: ['Pending', 'Approved', 'Paid', 'Rejected'] }, { key: 'vendor', label: 'Vendor', get: x => x.vendor }]}
          sorts={[{ label: 'Largest amount', by: x => x.amount, dir: 'desc' }, { label: 'Newest', by: x => x.createdAt, dir: 'desc' }]}
          csv={{ name: 'vendor-invoices', head: ['Issue', 'Title', 'Vendor', 'Amount', 'Note', 'Status'], row: x => [x.issue, x.title, x.vendor, x.amount, x.note, x.status] }}>{(page, sl) => (<div className="a-tbl-wrap">
          <table className="a-tbl">
            <tbody>
              <tr><th className="sl">Sl. no.</th><th>Issue</th><th>Vendor</th><th>Amount</th><th>Note</th><th>Status</th><th /></tr>
              {page.map((inv, rowNo) => (
                <tr key={inv.id}><td className="sl num">{sl(rowNo)}</td>
                  <td><span className="cell-t num">{inv.issue}</span><div style={{ fontSize: 12, color: 'var(--ink3)' }}>{inv.title}</div></td>
                  <td data-l="Vendor">{inv.vendor}</td>
                  <td data-l="Amount" className="num"><b>{rupees(inv.amount)}</b></td>
                  <td data-l="Note">{inv.note || '—'}{inv.fileUrl && <div><a href={inv.fileUrl} target="_blank" rel="noreferrer">View bill</a></div>}</td>
                  <td data-l="Status"><Pill tone={INV_TONE[inv.status]}>{inv.status}</Pill></td>
                  <td style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {inv.status === 'Pending' && <><IconBtn icon={Check} label="Approve" tone="good" primary onClick={() => decide(inv, 'Approved')} /><IconBtn icon={X} label="Reject" tone="danger" onClick={() => decide(inv, 'Rejected')} /></>}
                    {inv.status === 'Approved' && <IconBtn icon={CheckCircle} label="Mark paid" tone="good" primary onClick={() => decide(inv, 'Paid')} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>)}</TableCard>
      ) : <Empty icon={Receipt} title="No invoices yet" body="Record a vendor’s bill on the issue when the job is done." />)}

      {tab === 'report' && rep && (
        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
          <ReportTable icon={Wrench} title="Vendor performance" head={['Vendor', 'Jobs', 'Done', 'Avg hours', 'Rating', 'Spent']}
            rows={rep.byVendor.map(v => [v.vendor, v.jobs, v.completed, v.avg_hours ?? '—', v.rating ?? '—', rupees(v.spent)])} />
          <ReportTable icon={ChartBar} title="By category" head={['Category', 'Requests', 'Still open']} rows={rep.byCategory.map(c => [c.category, c.total, c.open])} />
          <ReportTable icon={ChartBar} title="Where the problems are" head={['Place', 'Requests']} rows={rep.byPlace.map(p => [p.place, p.total])} />
          <ReportTable icon={Receipt} title="Spending by category" head={['Category', 'Approved + paid']} rows={rep.expenseByCategory.map(c => [c.category, rupees(c.amount)])} />
        </div>
      )}

      {tab === 'log' && (
        <form onSubmit={submitJob} className="card" style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', alignItems: 'end' }}>
          <label style={{ gridColumn: '1 / -1' }}>What needs doing<input className="a-in" value={job.title} onChange={e => setJob({ ...job, title: e.target.value })} placeholder="e.g. Generator not starting" /></label>
          <label>Asset<select className="a-in" value={job.asset} onChange={e => setJob({ ...job, asset: e.target.value })}>{ASSETS.map(a => <option key={a}>{a}</option>)}</select></label>
          <label>Category<select className="a-in" value={job.category} onChange={e => setJob({ ...job, category: e.target.value })}>{CATEGORIES.map(c => <option key={c}>{c}</option>)}</select></label>
          <label>Where exactly<input className="a-in" value={job.location} onChange={e => setJob({ ...job, location: e.target.value })} placeholder="e.g. Basement 1" /></label>
          <label>Priority<select className="a-in" value={job.priority} onChange={e => setJob({ ...job, priority: e.target.value })}>{['Low', 'Medium', 'High', 'Emergency'].map(p => <option key={p}>{p}</option>)}</select></label>
          <button className="a-btn" type="submit">Log request</button>
        </form>
      )}
    </>
  );
}

function ReportTable({ icon: Icon, title, head, rows }: { icon: typeof Wrench; title: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="card">
      <h3 className="d-h" style={{ marginTop: 0 }}><Icon size={17} />{title}</h3>
      {rows.length ? (
        <table className="a-tbl">
          <tbody>
            <tr>{head.map(h => <th key={h}>{h}</th>)}</tr>
            {rows.map((r, i) => <tr key={i}>{r.map((c, k) => <td key={k} className={k ? 'num' : undefined}>{c}</td>)}</tr>)}
          </tbody>
        </table>
      ) : <div style={{ fontSize: 13, color: 'var(--ink3)' }}>Nothing in the last 30 days.</div>}
    </div>
  );
}
