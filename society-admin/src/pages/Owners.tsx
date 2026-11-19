import { confirmBox, formBox } from '../lib/dialog';
import { Buildings, FileText, HandCoins, Key, Eye, PencilSimple, Trash } from '@phosphor-icons/react';
import { TableCard, type PageQuery, type PageResult } from '../components/TableCard';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useToast } from '../components/toast-context';
import { Link, useNavigate } from 'react-router';
import { Drawer, Empty, Facts, PageHead, Pill, Stat, IconBtn } from '../components/ui';
import { api, ApiError, LIVE, upload } from '../lib/api';
import { association } from '../lib/live';

/* The owner portal, from the office: how each flat is occupied, what is held for its owner, the
   documents shared with owners, and how much of the books and the repairs owners may see. */

const A = () => `/v1/admin/${association()}`;
type Flat = { unitId: string; unit: string; occupancy: 'Owner-occupied' | 'Rented' | 'Vacant'; monthlyRent: number; leaseEnd: string | null; owner: string | null; ownerPhone: string | null; tenant: string | null;
  rentPending: number; heldForOwner: number; duesOnFlat: number; lastSeen: string | null };
type Settings = { enabled: boolean; reports: { statement: boolean; transactions: boolean; expenses: boolean; societyAccounts: boolean }; showRequests: boolean; showMessages: boolean; showCosts: boolean; approveAbove: number };
type Doc = { id: string; title: string; kind: string; fileUrl: string; unit: string | null; shared: boolean; byName: string; createdAt: string };
type Payout = { id: string; unit: string; amount: number; paidOn: string; mode: string; reference: string; byName: string };
type Tab = 'flats' | 'documents' | 'access' | 'activity';
const KINDS = ['Lease', 'Insurance', 'Tax', 'Statement', 'Invoice', 'Notice', 'Other'];
const OCC_TONE = { 'Owner-occupied': 'dim', Rented: 'good', Vacant: 'warn' } as const;
const rupees = (n: number) => (n < 0 ? '−' : '') + '₹' + Math.abs(n).toLocaleString('en-IN');
const grid = { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', alignItems: 'end' } as const;
const small = { fontSize: 12, color: 'var(--ink3)' } as const;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');

export function Owners() {
  const toast = useToast();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>('flats');
  /** every flat, for the "For" list when sharing a document — read only when that tab is opened */
  const [flats, setFlats] = useState<Flat[]>([]);
  const [sum, setSum] = useState<{ flats: number; let: number; vacant: number; heldForOwners: number; rentPending: number } | null>(null);
  /** bumped after a save, so the table reads its current page again */
  const [version, setVersion] = useState(0);
  const started = useRef(false);
  const [s, setS] = useState<Settings | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [paid, setPaid] = useState<Payout[]>([]);
  const [log, setLog] = useState<{ name: string; action: string; at: string }[]>([]);
  const [edit, setEdit] = useState<Flat | null>(null);
  const [saving, setSaving] = useState(false);
  const [d, setD] = useState({ title: '', kind: 'Lease', unitId: '', file: null as { url: string; name: string } | null });

  const fail = useCallback((e: unknown) => toast(e instanceof ApiError ? e.message : 'That didn’t go through.', undefined, 'warn'), [toast]);
  const load = useCallback(() => {
    if (!LIVE) return;
    api<NonNullable<typeof sum>>('GET', `${A()}/owners/summary`).then(setSum).catch(fail);
    if (tab === 'documents') api<Flat[]>('GET', `${A()}/owners`).then(setFlats).catch(fail);
    // the table reads its own first page; after that, every reload here refreshes it too
    if (started.current) setVersion(v => v + 1);
    started.current = true;
    api<Settings>('GET', `${A()}/owners/settings`).then(setS).catch(fail);
    api<Doc[]>('GET', `${A()}/documents`).then(setDocs).catch(fail);
    api<Payout[]>('GET', `${A()}/owners/payouts`).then(setPaid).catch(fail);
    api<{ name: string; action: string; at: string }[]>('GET', `${A()}/owners/activity`).then(setLog).catch(fail);
  }, [fail, tab]);
  // re-read when a tab is opened: owners use the portal while this page is up
  useEffect(load, [load]);
  /** one page of flats, searched, filtered and sorted by the server */
  const flatsPage = useCallback((q: PageQuery) => {
    const qs = new URLSearchParams({ page: String(q.page), limit: String(q.limit), ...(q.q ? { q: q.q } : {}), ...(q.sort ? { sort: q.sort } : {}), ...(q.filters.occ ? { occ: q.filters.occ } : {}), ...(q.filters.owner ? { owner: q.filters.owner } : {}) });
    return api<PageResult<Flat>>('GET', `${A()}/owners?${qs}`);
  }, []);

  if (!LIVE) {
    return (
      <>
        <PageHead title="Owners" sub="The owner portal." />
        <Empty icon={Key} title="Connect the console to the API" body="Owner access, documents and payouts are kept on the server. Set VITE_API_URL to use them." />
      </>
    );
  }

  const save = (patch: Partial<Settings> | { reports: Partial<Settings['reports']> }) => api<Settings>('PUT', `${A()}/owners/settings`, patch).then(n => { setS(n); toast('Saved', 'Owners see the change straight away.'); }).catch(fail);
  const saveFlat = (e: FormEvent) => {
    e.preventDefault();
    if (!edit || saving) return;
    // a flat that is not let has no rent and no lease
    const let_ = edit.occupancy === 'Rented';
    setSaving(true);
    api('PUT', `${A()}/owners/units/${edit.unitId}`, { occupancy: edit.occupancy, monthlyRent: let_ ? edit.monthlyRent : 0, leaseEnd: let_ ? edit.leaseEnd || null : null })
      .then(() => { toast(`Flat ${edit.unit} saved`, let_ ? `Rented · ${rupees(edit.monthlyRent)} a month` : edit.occupancy); setEdit(null); load(); }).catch(fail).finally(() => setSaving(false));
  };
  const payOut = async (f: Flat) => {
    const v = await formBox({ title: `Pay the owner of ${f.unit}`, body: `${rupees(f.heldForOwner)} is held for them. You can pay all of it or part.`, confirm: 'Record payout', fields: [
      { key: 'amount', label: 'Amount (₹)', type: 'number', value: String(f.heldForOwner), required: true },
      { key: 'reference', label: 'Bank reference', hint: 'Optional.' },
    ] });
    const amount = Number((v?.amount ?? '').replace(/[^\d]/g, ''));
    if (!v || !amount) return;
    const reference = v.reference?.trim() ?? '';
    api('POST', `${A()}/owners/payouts`, { unitId: f.unitId, amount, reference }).then(() => { toast(`${rupees(amount)} paid to the owner`, f.unit); load(); }).catch(fail);
  };
  const addDoc = (e: FormEvent) => {
    e.preventDefault();
    if (d.title.trim().length < 2 || !d.file) { toast('Give the document a title and choose the file.', undefined, 'warn'); return; }
    api('POST', `${A()}/documents`, { title: d.title.trim(), kind: d.kind, fileUrl: d.file.url, unitId: d.unitId || null }).then(() => { toast('Document shared', d.unitId ? 'The flat’s owner has been told.' : 'Every owner has been told.'); setD({ title: '', kind: d.kind, unitId: '', file: null }); load(); }).catch(fail);
  };
  const tick = (label: string, on: boolean, change: (v: boolean) => void, note?: string) => (
    <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13.5, padding: '6px 0' }}>
      <input type="checkbox" checked={on} onChange={e => change(e.target.checked)} style={{ marginTop: 3 }} /><span>{label}{note && <div style={small}>{note}</div>}</span>
    </label>
  );

  const held = sum?.heldForOwners ?? 0;
  return (
    <>
      <PageHead title="Owners" sub="Flat owners see their rent, repairs and documents in the app. You decide how much — and you see what they opened." />
      <div className="stats">
        <Stat icon={Buildings} label="Flats let" value={sum?.let ?? 0} tone="good" />
        <Stat icon={Buildings} label="Vacant" value={sum?.vacant ?? 0} tone={sum?.vacant ? 'warn' : undefined} />
        <Stat icon={HandCoins} label="Rent held for owners" value={rupees(held)} tone={held ? 'acc' : undefined} />
        <Stat icon={HandCoins} label="Rent pending from tenants" value={rupees(sum?.rentPending ?? 0)} />
        <Stat icon={FileText} label="Documents shared" value={docs.filter(x => x.shared).length} />
      </div>
      <div className="toolbar" style={{ gap: 6 }}>
        {([['flats', 'Flats & payouts'], ['documents', `Documents (${docs.length})`], ['access', 'What owners see'], ['activity', 'Owner activity']] as [Tab, string][]).map(([k, l]) => <button key={k} className={'a-btn' + (tab === k ? '' : ' ghost')} onClick={() => setTab(k)}>{l}</button>)}
      </div>

      {tab === 'flats' && (
        <>
          <TableCard<Flat> remote={flatsPage} reloadKey={version} noun="flat" search placeholder="Search by flat, owner, phone or tenant"
            empty={<Empty icon={Buildings} title="No flats yet" body="Add the society’s flats under Flats & units; they appear here with their owners." />}
            filters={[{ key: 'occ', label: 'Occupied by', options: ['Owner-occupied', 'Rented', 'Vacant'] }, { key: 'owner', label: 'Owner on the app', options: ['Yes', 'No'] }]}
            sorts={[{ label: 'Highest rent', key: 'rent' }, { label: 'Lease ending soonest', key: 'lease' }]}>{(page, sl) => (<div className="a-tbl-wrap"><table className="a-tbl"><tbody>
            <tr><th className="sl">Sl. no.</th><th>Flat</th><th>Owner</th><th>Occupied by</th><th>Rent</th><th>Held for owner</th><th>Last looked</th><th /></tr>
            {page.map((f, rowNo) => (
              <tr key={f.unitId} className="rowbtn" tabIndex={0} onClick={() => nav('/owners/' + f.unitId)} onKeyDown={e => { if (e.key === 'Enter') nav('/owners/' + f.unitId); }}><td className="sl num">{sl(rowNo)}</td>
                <td><span className="cell-t">{f.unit}</span></td>
                <td data-l="Owner">{f.owner ?? <span style={small}>No owner on the app</span>}<div className="num" style={small}>{f.ownerPhone}</div></td>
                <td data-l="Occupied by"><Pill tone={OCC_TONE[f.occupancy]}>{f.occupancy}</Pill>{f.tenant && <div style={small}>{f.tenant}</div>}{f.leaseEnd && <div style={small}>lease to {f.leaseEnd}</div>}</td>
                <td data-l="Rent" className="num">{f.monthlyRent ? rupees(f.monthlyRent) : '—'}{f.rentPending > 0 && <div style={{ fontSize: 12, color: 'var(--bad)' }}>{rupees(f.rentPending)} pending</div>}</td>
                <td data-l="Held for owner" className="num"><b>{f.heldForOwner ? rupees(f.heldForOwner) : '—'}</b></td>
                <td data-l="Last looked">{when(f.lastSeen)}</td>
                <td onClick={e => e.stopPropagation()}><div style={{ display: 'flex', gap: 6 }}><IconBtn icon={Eye} label="View details" primary onClick={() => nav('/owners/' + f.unitId)} /><IconBtn icon={PencilSimple} label="Edit" onClick={() => setEdit(f)} />{f.heldForOwner > 0 && <IconBtn icon={HandCoins} label="Pay owner" tone="good" onClick={() => payOut(f)} />}</div></td>
              </tr>
            ))}
          </tbody></table></div>)}</TableCard>
          {edit && (
            <Drawer label={'Edit ' + edit.unit} onClose={() => setEdit(null)}>
              <form onSubmit={saveFlat} style={{ display: 'grid', gap: 14 }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 800 }}>Flat {edit.unit}</div>
                  <div style={{ ...small, marginTop: 3 }}>Who lives in this flat, and the rent if it is let</div>
                </div>
                <Facts items={{ Owner: edit.owner ?? 'No owner on the app', 'Owner’s phone': edit.ownerPhone ?? '—', Tenant: edit.tenant ?? '—', 'Held for owner': edit.heldForOwner ? rupees(edit.heldForOwner) : '—' }} />
                <div style={small}>The owner’s and tenant’s names and numbers are changed under <Link to="/residents" style={{ color: 'var(--acc-ink)', fontWeight: 700 }}>Users &amp; Units</Link>. Here you set how the flat is occupied.</div>
                <label>Occupied by
                  <select className="a-in" value={edit.occupancy} onChange={e => setEdit({ ...edit, occupancy: e.target.value as Flat['occupancy'] })} autoFocus>{['Owner-occupied', 'Rented', 'Vacant'].map(o => <option key={o}>{o}</option>)}</select>
                  <span style={small}>{edit.occupancy === 'Rented' ? 'A tenant lives here and pays rent through the society.' : edit.occupancy === 'Vacant' ? 'Nobody lives here at the moment.' : 'The owner lives here, so there is no rent.'}</span>
                </label>
                {edit.occupancy === 'Rented' ? (
                  <>
                    <label>Monthly rent (₹)<input className="a-in num" inputMode="numeric" value={edit.monthlyRent || ''} onChange={e => setEdit({ ...edit, monthlyRent: Number(e.target.value.replace(/\D/g, '').slice(0, 8)) || 0 })} placeholder="e.g. 32000" /></label>
                    <label>Lease ends <span style={small}>(optional)</span><input className="a-in" type="date" value={edit.leaseEnd ?? ''} onChange={e => setEdit({ ...edit, leaseEnd: e.target.value || null })} /></label>
                    <div style={small}>Rent is billed from Accounts → Billing with the charge “Rent”. What the tenant pays is held for the owner; approved repairs on the flat come out of it.</div>
                  </>
                ) : <div style={small}>Choose <b>Rented</b> to enter a monthly rent and the date the lease ends.{(edit.monthlyRent || edit.leaseEnd) ? ' The rent and lease date saved earlier will be cleared.' : ''}</div>}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="a-btn" type="submit" disabled={saving || (edit.occupancy === 'Rented' && !edit.monthlyRent)}>{saving ? 'Saving…' : 'Save changes'}</button>
                  <button className="a-btn ghost" type="button" onClick={() => setEdit(null)}>Cancel</button>
                </div>
                {edit.occupancy === 'Rented' && !edit.monthlyRent && <div style={{ ...small, color: 'var(--warn)' }}>Enter the monthly rent to save a let flat.</div>}
              </form>
            </Drawer>
          )}
          {paid.length > 0 && (
            <div className="card" style={{ marginTop: 14 }}><b>Paid to owners</b>
              <table className="a-tbl compact" style={{ marginTop: 8 }}><tbody>
                <tr><th>Date</th><th>Flat</th><th>Amount</th><th>How</th><th>By</th></tr>
                {paid.map(p => <tr key={p.id}><td className="num">{p.paidOn}</td><td>{p.unit}</td><td className="num"><b>{rupees(p.amount)}</b></td><td>{p.mode}{p.reference ? ' · ' + p.reference : ''}</td><td>{p.byName}</td></tr>)}
              </tbody></table>
            </div>
          )}
        </>
      )}

      {tab === 'documents' && (
        <>
          <form onSubmit={addDoc} className="card" style={grid}>
            <label>Title<input className="a-in" value={d.title} onChange={e => setD({ ...d, title: e.target.value })} placeholder="e.g. Lease agreement 2026" /></label>
            <label>Kind<select className="a-in" value={d.kind} onChange={e => setD({ ...d, kind: e.target.value })}>{KINDS.map(k => <option key={k}>{k}</option>)}</select></label>
            <label>For<select className="a-in" value={d.unitId} onChange={e => setD({ ...d, unitId: e.target.value })}><option value="">Every owner</option>{flats.map(f => <option key={f.unitId} value={f.unitId}>{f.unit}{f.owner ? ' · ' + f.owner : ''}</option>)}</select></label>
            <label className="a-btn ghost" style={{ cursor: 'pointer', display: 'inline-flex' }}>{d.file ? d.file.name : 'Choose a PDF or image'}<input type="file" accept="application/pdf,image/*" hidden onChange={e => { const x = e.target.files?.[0]; if (x) upload(x).then(url => setD(cur => ({ ...cur, file: { url, name: x.name } }))).catch(fail); }} /></label>
            <button className="a-btn" type="submit">Share document</button>
          </form>
          {docs.length ? (
            <TableCard rows={docs} noun="document" search={x => [x.title, x.kind, x.unit, x.byName]} placeholder="Search documents by title, kind or flat"
              filters={[{ key: 'kind', label: 'Kind', get: x => x.kind }, { key: 'for', label: 'For', get: x => x.unit ?? 'Every owner' }, { key: 'shared', label: 'Owners see it', get: x => (x.shared ? 'Yes' : 'No'), options: ['Yes', 'No'] }]} style={{ marginTop: 14 }}>{(page, sl) => (<div className="a-tbl-wrap"><table className="a-tbl"><tbody>
              <tr><th className="sl">Sl. no.</th><th>Document</th><th>Kind</th><th>For</th><th>Added</th><th>Owners see it</th><th /></tr>
              {page.map((x, rowNo) => (
                <tr key={x.id}><td className="sl num">{sl(rowNo)}</td>
                  <td><a href={x.fileUrl} target="_blank" rel="noreferrer" className="cell-t">{x.title}</a></td><td data-l="Kind">{x.kind}</td><td data-l="For">{x.unit ?? 'Every owner'}</td>
                  <td data-l="Added">{when(x.createdAt)}<div style={small}>{x.byName}</div></td>
                  <td data-l="Owners see it"><input type="checkbox" checked={x.shared} aria-label={`Share ${x.title} with owners`} onChange={e => api('PUT', `${A()}/documents/${x.id}`, { shared: e.target.checked }).then(load).catch(fail)} /></td>
                  <td><IconBtn icon={Trash} label="Remove" tone="danger" onClick={async () => { if ((await confirmBox(`Remove “${x.title}”?`))) void api('DELETE', `${A()}/documents/${x.id}`).then(load).catch(fail); }} /></td>
                </tr>
              ))}
            </tbody></table></div>)}</TableCard>
          ) : <Empty icon={FileText} title="No documents yet" body="Share a lease with one flat’s owner, or a notice with every owner." />}
        </>
      )}

      {tab === 'access' && s && (
        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
          <div className="card"><b>The portal</b>
            {tick('Owners can use the owner portal', s.enabled, v => save({ enabled: v }), 'Switched off, owners see nothing at all.')}
            <b style={{ display: 'block', marginTop: 10 }}>Reports</b>
            {tick('Owner statement', s.reports.statement, v => save({ reports: { statement: v } }), 'Rent, repairs, payouts and what is held for them.')}
            {tick('Transaction log', s.reports.transactions, v => save({ reports: { transactions: v } }))}
            {tick('Repair cost report', s.reports.expenses, v => save({ reports: { expenses: v } }))}
            {tick('The society’s own accounts', s.reports.societyAccounts, v => save({ reports: { societyAccounts: v } }), 'Income and expenditure and the balance sheet of the whole society.')}
          </div>
          <div className="card"><b>Repairs on their flat</b>
            {tick('Owners see repair requests on their flat', s.showRequests, v => save({ showRequests: v }))}
            {tick('…and what they cost', s.showCosts, v => save({ showCosts: v }), 'Estimates, bills and the vendor’s invoice.')}
            {tick('…and the conversation with the resident', s.showMessages, v => save({ showMessages: v }))}
            <label style={{ marginTop: 10 }}>Ask the owner to approve a repair estimated at or above (₹)
              <input className="a-in" defaultValue={s.approveAbove} inputMode="numeric" onBlur={e => { const n = Number(e.target.value.replace(/\D/g, '')) || 0; if (n !== s.approveAbove) void save({ approveAbove: n }); }} />
              <span style={small}>0 = owners are never asked. Work can’t start while an owner’s answer is awaited.</span>
            </label>
          </div>
        </div>
      )}

      {tab === 'activity' && (log.length ? (
        <div className="a-tbl-wrap"><table className="a-tbl compact"><tbody>
          <tr><th>When</th><th>Owner</th><th>What they did</th></tr>
          {log.map((l, i) => <tr key={i}><td className="num">{when(l.at)}</td><td>{l.name}</td><td>{l.action}</td></tr>)}
        </tbody></table></div>
      ) : <Empty icon={Key} title="No owner has opened the portal yet" body="When owners look at their dashboard, reports or documents, it shows here." />)}
    </>
  );
}
