import { confirmBox, promptBox } from '../lib/dialog';
import { CheckCircle, Door, DoorOpen, Eye, HandWaving, IdentificationBadge, Package, Prohibit, QrCode, SignIn, Siren, ArrowsLeftRight, Check, Trash, X } from '@phosphor-icons/react';
import qrcode from 'qrcode-generator';
import { TableCard, type PageQuery } from '../components/TableCard';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useToast } from '../components/toast-context';
import { Empty, PageHead, Pill, Stat, IconBtn } from '../components/ui';
import { ApiError, LIVE } from '../lib/api';
import {
  ackIncident, addGuard, addSticker, addWatch, decide, guards as fetchGuards, incidents as fetchIncidents, moveGuard, resolveIncident, removeGuard, removeSticker, removeWatch, STATUS_LABEL, STATUS_TONE, stickers as fetchStickers, summary, time, VIA, visitsPage, watchlist,
  type Filter, type Guard, type Incident, type Sticker, type Summary, type Visit, type Watch,
} from '../lib/gate';

type Tab = 'register' | 'guards' | 'watch' | 'qr' | 'sos';

/** the QR as an image the page can show and print; level M survives a scuffed sticker */
function qrImage(url: string) {
  const q = qrcode(0, 'M');
  q.addData(url);
  q.make();
  return q.createDataURL(8, 16);
}
const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
/** one sticker on its own page, ready for the printer */
function printSticker(x: Sticker) {
  const w = window.open('', '_blank', 'width=520,height=760');
  if (!w) return false;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Visitor QR · ${esc(x.gate)}</title><style>
    body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1B1B2A;text-align:center}
    .s{width:105mm;margin:8mm auto;padding:9mm 7mm;border:1.2mm solid #7C55F7;border-radius:6mm}
    h1{font-size:8mm;margin:0 0 1mm}h2{font-size:5mm;margin:0;font-weight:600;color:#5A5F73}
    img{width:78mm;height:78mm;margin:5mm 0 3mm;image-rendering:pixelated}
    ol{text-align:left;font-size:4.2mm;line-height:1.5;margin:0 4mm;padding-left:6mm}p{font-size:3.4mm;color:#8A8FA3;margin:4mm 0 0}
    @page{margin:6mm}</style></head><body><div class="s">
    <h1>Visitors: scan to check in</h1><h2>${esc(x.society)} · ${esc(x.gate)}</h2>
    <img src="${qrImage(x.url)}" alt="">
    <ol><li>Scan this code with your phone camera.</li><li>Fill in your details and the flat you are visiting.</li><li>When the flat approves, show your phone to the security guard.</li></ol>
    <p>No app needed. Deliveries, cabs and vendors too.</p></div></body></html>`);
  w.document.close();
  w.onload = () => { w.focus(); w.print(); };
  return true;
}
const PHONE = /^[6-9]\d{9}$/;
const STATUSES = ['Pending', 'Approved', 'Inside', 'AtGate', 'Left', 'Collected', 'Rejected', 'Expected', 'Cancelled', 'Expired'] as const;

/** The gate, from the office: every visitor and delivery, the guards, and who is blocked. Connected mode only. */
export function Gate() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('register');
  const [alerts, setAlerts] = useState<Incident[]>([]);
  const [sum, setSum] = useState<Summary | null>(null);
  /** bumped whenever the register should be read again: on the timer, and after an answer is recorded */
  const [tick, setTick] = useState(0);
  const started = useRef(false);
  const [filter, setFilter] = useState<Filter>({});
  const [team, setTeam] = useState<Guard[]>([]);
  const [watch, setWatch] = useState<Watch[]>([]);
  const [codes, setCodes] = useState<Sticker[]>([]);
  const [codeGate, setCodeGate] = useState('Main gate');
  const [g, setG] = useState({ name: '', phone: '', gate: 'Main gate' });
  const [w, setW] = useState({ name: '', phone: '', vehicle: '', reason: '', level: 'block' as 'block' | 'watch' });

  const fail = useCallback((e: unknown) => toast(e instanceof ApiError ? e.message : 'That didn’t go through.', undefined, 'warn'), [toast]);
  const load = useCallback(() => {
    if (!LIVE) return;
    summary().then(setSum).catch(fail);
    // the register reads its own first page; after that, every reload here refreshes it too
    if (started.current) setTick(n => n + 1);
    started.current = true;
    fetchGuards().then(setTeam).catch(fail);
    watchlist().then(setWatch).catch(fail);
    fetchIncidents().then(setAlerts).catch(fail);
    fetchStickers().then(setCodes).catch(fail);
  }, [fail]);
  /** one page of the register for the filters above it; the server finds, counts and slices */
  const registerPage = useCallback((q: PageQuery) => visitsPage(filter, q.page, q.limit), [filter]);
  // the gate moves all day: keep the register current while the page is open
  useEffect(() => {
    load();
    const h = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 15000);
    return () => clearInterval(h);
  }, [load]);

  if (!LIVE) {
    return (
      <>
        <PageHead title="Gate" sub="Visitors, deliveries, guards and the block list." />
        <Empty icon={Door} title="Connect the console to the API" body="The visitor register comes from the server. Set VITE_API_URL to use it." />
      </>
    );
  }

  const answer = (v: Visit, d: 'approve' | 'reject' | 'gate') =>
    decide(v.id, d).then(() => { toast(d === 'approve' ? 'Approved — the guard can let them in' : d === 'reject' ? 'Turned away' : 'To be kept at the gate', `${v.partner || v.name} · ${v.unit ?? ''}`); load(); }).catch(fail);

  const submitGuard = (e: FormEvent) => {
    e.preventDefault();
    if (g.name.trim().length < 2) { toast('Enter the guard’s name.', undefined, 'warn'); return; }
    if (!PHONE.test(g.phone)) { toast('Mobile numbers have 10 digits and start with 6, 7, 8 or 9.', undefined, 'warn'); return; }
    addGuard({ name: g.name.trim(), phone: g.phone, gate: g.gate.trim() || 'Main gate' })
      .then(() => { toast('Guard added', `They sign in to the app with ${g.phone} and a one-time code.`); setG({ name: '', phone: '', gate: g.gate }); load(); }).catch(fail);
  };
  const dropGuard = async (x: Guard) => {
    if (!(await confirmBox(`Remove ${x.name}? They are signed out of the app at once.`))) return;
    removeGuard(x.id).then(() => { toast('Guard removed', x.name); load(); }).catch(fail);
  };
  const changeGate = async (x: Guard) => {
    const gate = (await promptBox(`Which gate is ${x.name} posted at?`, x.gate ?? 'Main gate'))?.trim();
    if (gate && gate !== x.gate) moveGuard(x.id, gate).then(load).catch(fail);
  };

  const submitWatch = (e: FormEvent) => {
    e.preventDefault();
    if (w.name.trim().length < 2) { toast('Enter a name or a short description of the person.', undefined, 'warn'); return; }
    if (w.phone && !PHONE.test(w.phone)) { toast('Mobile numbers have 10 digits and start with 6, 7, 8 or 9.', undefined, 'warn'); return; }
    if (!w.phone && !w.vehicle.trim()) { toast('Give a mobile number or a vehicle number — that is how the gate recognises them.', undefined, 'warn'); return; }
    if (w.reason.trim().length < 3) { toast('Say why, so the guard and the committee know.', undefined, 'warn'); return; }
    addWatch({ name: w.name.trim(), phone: w.phone || undefined, vehicle: w.vehicle.trim() || undefined, reason: w.reason.trim(), level: w.level })
      .then(() => { toast(w.level === 'block' ? 'Blocked at the gate' : 'Put on watch', w.name.trim()); setW({ name: '', phone: '', vehicle: '', reason: '', level: w.level }); load(); }).catch(fail);
  };

  const submitSticker = (e: FormEvent) => {
    e.preventDefault();
    if (codeGate.trim().length < 2) { toast('Say which gate the sticker is for.', undefined, 'warn'); return; }
    addSticker(codeGate.trim()).then(() => { toast('QR sticker ready', 'Print it and put it up where visitors wait.'); load(); }).catch(fail);
  };
  const dropSticker = async (x: Sticker) => {
    if (!(await confirmBox(`Cancel the QR sticker for ${x.gate}? A printed copy stops working at once.`))) return;
    removeSticker(x.id).then(() => { toast('Sticker cancelled', x.gate); load(); }).catch(fail);
  };

  const openAlerts = alerts.filter(i => i.status !== 'Resolved').length;
  const onIt = (i: Incident) => ackIncident(i.id).then(() => { toast('Marked as being handled', i.kind); load(); }).catch(fail);
  const closeAlert = async (i: Incident) => {
    const r = (await promptBox(`Close the ${i.kind.toLowerCase()} alert from ${i.by}`, '', { body: 'Say what happened and what was done. It goes on the incident log, and the person who raised it is told.', type: 'textarea', confirm: 'Close alert', required: true }))?.trim();
    if (r) resolveIncident(i.id, r).then(() => { toast('Alert closed', i.kind); load(); }).catch(fail);
  };

  const set = (k: keyof Filter) => (e: { target: { value: string } }) => setFilter(f => ({ ...f, [k]: e.target.value }));

  return (
    <>
      <PageHead title="Gate" sub="Every visitor and delivery, as the guards log them. Residents answer from the app; you can answer for a flat that doesn’t." />
      <div className="stats">
        <Stat icon={SignIn} label="Entries today" value={sum?.entries_today ?? 0} />
        <Stat icon={DoorOpen} label="Inside now" value={sum?.inside_now ?? 0} tone="good" />
        <Stat icon={Door} label="Waiting at the gate" value={sum?.waiting ?? 0} tone={sum?.waiting ? 'warn' : undefined} />
        <Stat icon={Package} label="Parcels at the gate" value={sum?.parcels_at_gate ?? 0} tone={sum?.parcels_at_gate ? 'warn' : undefined} />
        <Stat icon={Prohibit} label="Turned away today" value={sum?.rejected_today ?? 0} tone={sum?.rejected_today ? 'bad' : undefined} />
      </div>
      {openAlerts > 0 && tab !== 'sos' && (
        <div className="card" style={{ display: 'flex', gap: 12, alignItems: 'center', borderColor: 'var(--bad)', background: 'var(--bad-bg)', marginBottom: 14 }}>
          <Siren size={22} color="var(--bad)" weight="fill" /><b style={{ flex: 1 }}>{openAlerts} emergency alert{openAlerts === 1 ? '' : 's'} still open</b>
          <button className="a-btn" onClick={() => setTab('sos')}>See the alert{openAlerts === 1 ? '' : 's'}</button>
        </div>
      )}
      <div className="toolbar" style={{ gap: 6 }}>
        {([['register', 'Register'], ['guards', `Guards (${team.length})`], ['watch', `Block & watch list (${watch.length})`], ['qr', `Visitor QR (${codes.length})`], ['sos', `Emergency alerts${openAlerts ? ` (${openAlerts})` : ''}`]] as [Tab, string][]).map(([k, l]) => (
          <button key={k} className={'a-btn' + (tab === k ? '' : ' ghost')} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'register' && (
        <>
          <div className="card" style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', alignItems: 'end', marginBottom: 12 }}>
            <label>Search<input className="a-in" value={filter.q ?? ''} onChange={set('q')} placeholder="Name, phone, vehicle" /></label>
            <label>Flat<input className="a-in" value={filter.unit ?? ''} onChange={set('unit')} placeholder="e.g. T4-1108" /></label>
            <label>Kind<select className="a-in" value={filter.kind ?? ''} onChange={set('kind')}><option value="">All</option><option value="visitor">Visitors</option><option value="delivery">Deliveries</option></select></label>
            <label>Status<select className="a-in" value={filter.status ?? ''} onChange={set('status')}><option value="">All</option>{STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></label>
            <label>From<input className="a-in" type="date" value={filter.from ?? ''} onChange={set('from')} /></label>
            <label>To<input className="a-in" type="date" value={filter.to ?? ''} onChange={set('to')} /></label>
          </div>
            <TableCard<Visit> remote={registerPage} reloadKey={JSON.stringify(filter) + tick} noun="entry" pageSize={25}
              empty={<Empty icon={Door} title="Nothing matches" body="No visitor or delivery fits these filters." />}>{(page, sl) => (<div className="a-tbl-wrap">
              <table className="a-tbl">
                <tbody>
                  <tr><th className="sl">Sl. no.</th><th>Who</th><th>Flat</th><th>Type</th><th>In</th><th>Out</th><th>Decided</th><th>Status</th><th /></tr>
                  {page.map((v, rowNo) => (
                    <tr key={v.id}><td className="sl num">{sl(rowNo)}</td>
                      <td>
                        <span className="cell-t">{v.partner || v.name}</span>
                        <div style={{ fontSize: 12, color: 'var(--ink3)' }}>{[v.partner && v.name !== v.partner && v.name, v.phone, v.vehicle, v.people > 1 && `${v.people} people`, v.purpose].filter(Boolean).join(' · ') || '—'}</div>
                        {v.selfCheckIn && <div style={{ fontSize: 12, color: 'var(--acc)' }}>Self check-in by QR · code {v.ref}</div>}
                        {v.flagged && <div style={{ fontSize: 12, color: 'var(--bad)' }}>Watch list: {v.flagged}</div>}
                        {(v.photoUrl || v.proofUrl) && <div style={{ fontSize: 12 }}>{v.photoUrl && <a href={v.photoUrl} target="_blank" rel="noreferrer">Photo</a>}{v.photoUrl && v.proofUrl && ' · '}{v.proofUrl && <a href={v.proofUrl} target="_blank" rel="noreferrer">Delivery proof</a>}</div>}
                      </td>
                      <td data-l="Flat" className="num">{v.unit ?? 'Society'}</td>
                      <td data-l="Type">{v.deliveryType ? `${v.visitorType} · ${v.deliveryType}` : v.visitorType}</td>
                      <td data-l="In" className="num">{time(v.enteredAt ?? v.keptAt)}{v.gate && (v.enteredAt || v.keptAt) && <div style={{ fontSize: 12, color: 'var(--ink3)' }}>{v.gate}{v.guardName ? ' · ' + v.guardName : ''}</div>}</td>
                      <td data-l="Out" className="num">{time(v.exitedAt ?? v.collectedAt)}{v.collectedBy && <div style={{ fontSize: 12, color: 'var(--ink3)' }}>{v.collectedBy}</div>}</td>
                      <td data-l="Decided">{v.decidedVia ? VIA[v.decidedVia] ?? v.decidedVia : '—'}{v.decidedByName && <div style={{ fontSize: 12, color: 'var(--ink3)' }}>{v.decidedByName}</div>}</td>
                      <td data-l="Status"><Pill tone={STATUS_TONE[v.status]}>{STATUS_LABEL[v.status]}</Pill></td>
                      <td>
                        {v.status === 'Pending' && (
                          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <IconBtn icon={Check} label="Approve" tone="good" primary onClick={() => answer(v, 'approve')} />
                            {v.kind === 'delivery' && <IconBtn icon={Package} label="Keep at gate" onClick={() => answer(v, 'gate')} />}
                            <IconBtn icon={X} label="Reject" tone="danger" onClick={() => answer(v, 'reject')} />
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>)}</TableCard>
        </>
      )}

      {tab === 'guards' && (
        <>
          {team.length ? (
            <TableCard rows={team} noun="guard" search={x => [x.name, x.phone, x.gate]} placeholder="Search guards by name, number or gate" filters={[{ key: 'gate', label: 'Posted at', get: x => x.gate ?? 'Main gate' }]}>{(page, sl) => (<div className="a-tbl-wrap">
              <table className="a-tbl">
                <tbody>
                  <tr><th className="sl">Sl. no.</th><th>Guard</th><th>Signs in with</th><th>Posted at</th><th /></tr>
                  {page.map((x, rowNo) => (
                    <tr key={x.id}><td className="sl num">{sl(rowNo)}</td>
                      <td><span className="cell-t">{x.name}</span></td>
                      <td data-l="Signs in with" className="num">+91 {x.phone}<div style={{ fontSize: 12, color: 'var(--ink3)' }}>one-time code, in the mobile app</div></td>
                      <td data-l="Posted at">{x.gate ?? 'Main gate'}</td>
                      <td style={{ display: 'flex', gap: 6 }}><IconBtn icon={ArrowsLeftRight} label="Change gate" onClick={() => changeGate(x)} /><IconBtn icon={Trash} label="Remove" tone="danger" onClick={() => dropGuard(x)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>)}</TableCard>
          ) : <Empty icon={IdentificationBadge} title="No guards yet" body="Add the guards who log visitors at each gate. They use the same mobile app, signing in with their number." />}
          <form onSubmit={submitGuard} className="card" style={{ marginTop: 14, display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', alignItems: 'end' }}>
            <label>Guard’s name<input className="a-in" value={g.name} onChange={e => setG({ ...g, name: e.target.value })} /></label>
            <label>Mobile number<input className="a-in" inputMode="numeric" maxLength={10} value={g.phone} onChange={e => setG({ ...g, phone: e.target.value.replace(/\D/g, '') })} placeholder="10 digits" /></label>
            <label>Gate<input className="a-in" value={g.gate} onChange={e => setG({ ...g, gate: e.target.value })} placeholder="Main gate" /></label>
            <button className="a-btn" type="submit">Add guard</button>
          </form>
        </>
      )}

      {tab === 'watch' && (
        <>
          {watch.length ? (
            <TableCard rows={watch} noun="entry" search={x => [x.name, x.phone, x.vehicle, x.reason]} placeholder="Search by name, number, vehicle or reason" filters={[{ key: 'rule', label: 'Rule', get: x => (x.level === 'block' ? 'Do not allow in' : 'Watch'), options: ['Do not allow in', 'Watch'] }]}>{(page, sl) => (<div className="a-tbl-wrap">
              <table className="a-tbl">
                <tbody>
                  <tr><th className="sl">Sl. no.</th><th>Who</th><th>Recognised by</th><th>Why</th><th>Rule</th><th>Added</th><th /></tr>
                  {page.map((x, rowNo) => (
                    <tr key={x.id}><td className="sl num">{sl(rowNo)}</td>
                      <td><span className="cell-t">{x.name}</span></td>
                      <td data-l="Recognised by" className="num">{[x.phone, x.vehicle].filter(Boolean).join(' · ')}</td>
                      <td data-l="Why">{x.reason}</td>
                      <td data-l="Rule"><Pill tone={x.level === 'block' ? 'bad' : 'warn'}>{x.level === 'block' ? 'Blocked' : 'Watch'}</Pill></td>
                      <td data-l="Added">{x.addedBy || '—'}<div style={{ fontSize: 12, color: 'var(--ink3)' }}>{time(x.createdAt)}</div></td>
                      <td><IconBtn icon={Trash} label="Remove" tone="danger" onClick={() => removeWatch(x.id).then(() => { toast('Removed from the list', x.name); load(); }).catch(fail)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>)}</TableCard>
          ) : <Empty icon={Eye} title="Nobody is on the list" body="Block someone who must not come in, or put them on watch so the guard and the flat are warned." />}
          <form onSubmit={submitWatch} className="card" style={{ marginTop: 14, display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', alignItems: 'end' }}>
            <label>Name or description<input className="a-in" value={w.name} onChange={e => setW({ ...w, name: e.target.value })} /></label>
            <label>Mobile number<input className="a-in" inputMode="numeric" maxLength={10} value={w.phone} onChange={e => setW({ ...w, phone: e.target.value.replace(/\D/g, '') })} placeholder="If known" /></label>
            <label>Vehicle number<input className="a-in" value={w.vehicle} onChange={e => setW({ ...w, vehicle: e.target.value.toUpperCase() })} placeholder="If known" /></label>
            <label>Rule<select className="a-in" value={w.level} onChange={e => setW({ ...w, level: e.target.value as 'block' | 'watch' })}><option value="block">Block — turn away</option><option value="watch">Watch — warn, don’t refuse</option></select></label>
            <label style={{ gridColumn: '1 / -1' }}>Why<input className="a-in" value={w.reason} onChange={e => setW({ ...w, reason: e.target.value })} placeholder="What happened" /></label>
            <button className="a-btn" type="submit">Add to list</button>
          </form>
        </>
      )}

      {tab === 'qr' && (
        <>
          <div className="card" style={{ marginBottom: 12, fontSize: 14, color: 'var(--ink2)' }}>
            Put a sticker up at each gate. A visitor scans it with their phone camera, fills in who they are and which flat they are visiting, and the flat is asked in the app.
            The answer shows on the visitor’s phone and in the guard’s app at the same time — the guard lets them in from there. No app is needed on the visitor’s phone.
          </div>
          {codes.length ? (
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
              {codes.map(x => (
                <div key={x.id} className="card" style={{ textAlign: 'center' }}>
                  <img src={qrImage(x.url)} alt={`QR code for ${x.gate}`} style={{ width: 180, height: 180, imageRendering: 'pixelated' }} />
                  <div className="cell-t" style={{ marginTop: 6 }}>{x.gate}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink3)' }}>Made {time(x.createdAt)}</div>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap', marginTop: 10 }}>
                    <button className="a-btn" onClick={() => { if (!printSticker(x)) toast('Allow pop-ups for this site to print the sticker.', undefined, 'warn'); }}>Print</button>
                    <button className="a-btn ghost" onClick={() => navigator.clipboard.writeText(x.url).then(() => toast('Link copied', x.gate)).catch(async () => (await promptBox('Copy this link', x.url)))}>Copy link</button>
                    <button className="a-btn ghost" onClick={() => dropSticker(x)}>Cancel</button>
                  </div>
                </div>
              ))}
            </div>
          ) : <Empty icon={QrCode} title="No QR sticker yet" body="Make one for each gate, print it, and put it up where visitors wait." />}
          <form onSubmit={submitSticker} className="card" style={{ marginTop: 14, display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', alignItems: 'end' }}>
            <label>Gate<input className="a-in" value={codeGate} onChange={e => setCodeGate(e.target.value)} placeholder="Main gate" maxLength={40} /></label>
            <button className="a-btn" type="submit">Make a QR sticker</button>
          </form>
        </>
      )}

      {tab === 'sos' && (alerts.length ? (
        <TableCard rows={alerts} noun="alert" search={i => [i.kind, i.by, i.unit, i.place, i.note, i.resolution]} placeholder="Search alerts by kind, who raised it or where"
          filters={[{ key: 'kind', label: 'Kind', get: i => i.kind }, { key: 'status', label: 'Status', get: i => i.status, options: ['Open', 'Acknowledged', 'Resolved'] }, { key: 'role', label: 'Raised by', get: i => (i.role === 'guard' ? 'A guard' : 'A resident'), options: ['A resident', 'A guard'] }]}>{(page, sl) => (<div className="a-tbl-wrap"><table className="a-tbl"><tbody>
          <tr><th className="sl">Sl. no.</th><th>Alert</th><th>Raised by</th><th>When</th><th>Status</th><th /></tr>
          {page.map((i, rowNo) => (
            <tr key={i.id}><td className="sl num">{sl(rowNo)}</td>
              <td><span className="cell-t">{i.kind}</span><div style={{ fontSize: 12, color: 'var(--ink3)' }}>{i.place}{i.note ? ' · ' + i.note : ''}</div></td>
              <td data-l="Raised by">{i.by}<div style={{ fontSize: 12, color: 'var(--ink3)' }}>{i.role === 'guard' ? 'Security guard' : i.unit}</div></td>
              <td data-l="When" className="num">{time(i.createdAt)}</td>
              <td data-l="Status"><Pill tone={i.status === 'Open' ? 'bad' : i.status === 'Acknowledged' ? 'warn' : 'good'}>{i.status}</Pill>{i.ackByName && <div style={{ fontSize: 12, color: 'var(--ink3)' }}>responded: {i.ackByName}</div>}{i.resolution && <div style={{ fontSize: 12, color: 'var(--ink3)' }}>{i.resolution}</div>}</td>
              <td>
                {i.status === 'Open' && <IconBtn icon={HandWaving} label="We’re on it" tone="good" primary onClick={() => onIt(i)} />}
                {i.status !== 'Resolved' && <IconBtn icon={CheckCircle} label="Close the alert" onClick={() => closeAlert(i)} />}
              </td>
            </tr>
          ))}
        </tbody></table></div>)}</TableCard>
      ) : <Empty icon={Siren} title="No emergency alerts" body="Residents and guards can raise an SOS from the app. It shows here and on the guards’ phones at once. To warn everyone, send an Emergency message from Communication." />)}
    </>
  );
}
