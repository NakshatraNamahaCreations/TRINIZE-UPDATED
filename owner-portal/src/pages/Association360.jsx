import { ExternalLink, FilePlus2, Heart, Pencil, Phone, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { UsageChart } from '../components/charts/Charts';
import { DataList } from '../components/DataList';
import { CommunityPanel, Kpi, Pill, Ring } from '../components/ui';
import { bandColor, COMMUNITY_SIM_URL, findAssoc, fmtL, health, initials, INVOICES, num, payTone, priTone, slaTone, stateTone, statusTone } from '../data/portal';
import { LIVE } from '../lib/api';
import { addPlots, assocDetail } from '../lib/live';
import { usePortal } from '../store/context';
import { EditSociety, RaiseInvoice, RemoveSociety } from './AccountActions';
import { ManageSubscription } from './Subscriptions';

/** The account's subscription at a glance; changing it is its own guided flow. */
function Subscription({ a }) {
  const { openModal, go } = usePortal();
  return (
    <div className="panel">
      <div className="panel-h">
        <div><h3>Subscription</h3><div className="p-sub" style={{ marginBottom: 0 }}>Plan, state, price and renewal for this society</div></div>
        <button className="more" onClick={() => go('subscriptions')}>All subscriptions</button>
      </div>
      <div className="sub-now">
        <div><span>Plan</span><b>{a.plan}</b></div>
        <div><span>State</span><b><Pill tone={stateTone(a.state)}>{a.state}</Pill></b></div>
        <div><span>Annual value</span><b className="num">{fmtL(a.annual)}</b></div>
        <div><span>{a.trial ? 'Trial ends' : 'Renews'}</span><b>{a.renew}</b></div>
        <button className="btn sm" onClick={() => openModal(<ManageSubscription id={a.id} />)}>Manage subscription</button>
      </div>
    </div>
  );
}

/** Set up a run of numbered plots for the society, e.g. P-001 to P-096 in "Phase 1". */
function SetUpPlots({ a, onDone }) {
  const left = Math.max(1, a.plots - a.homes.length);
  const [f, setF] = useState({ block: '', prefix: 'P', from: String(a.homes.length + 1), to: String(a.homes.length + left), flatType: a.type === 'Apartment' ? '' : 'Plot' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const set = k => e => setF(v => ({ ...v, [k]: e.target.value }));
  const digits = k => e => setF(v => ({ ...v, [k]: e.target.value.replace(/\D/g, '') }));
  const from = Number(f.from), to = Number(f.to), count = to >= from && from > 0 ? to - from + 1 : 0;
  const block = f.block.trim(), prefix = f.prefix.trim().toUpperCase(), width = Math.max(3, f.to.length);
  const code = n => `${prefix}-${String(n).padStart(width, '0')}`;
  const ready = block && prefix && count > 0 && count <= 2000;

  const submit = async e => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true); setMsg(null);
    try {
      const units = Array.from({ length: count }, (_, i) => ({ code: code(from + i), tower: block, label: `${block}, Plot ${from + i}`, flatType: f.flatType, occupancy: 'Vacant' }));
      const r = await addPlots(a.id, units);
      setMsg({ ok: true, text: `${r.added} added${r.skipped ? ` · ${r.skipped} already existed` : ''}.` });
      await onDone();
    } catch (err) {
      setMsg({ ok: false, text: err?.message || 'That didn’t go through.' });
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', alignItems: 'end', marginTop: 14 }}>
      <label className="fl">Block or phase<input className="in" value={f.block} onChange={set('block')} maxLength={40} placeholder="Phase 1" /></label>
      <label className="fl">Short code<input className="in" value={f.prefix} onChange={set('prefix')} maxLength={8} placeholder="P" /></label>
      <label className="fl">From number<input className="in num" inputMode="numeric" value={f.from} onChange={digits('from')} /></label>
      <label className="fl">To number<input className="in num" inputMode="numeric" value={f.to} onChange={digits('to')} /></label>
      <label className="fl">Type<select className="in" value={f.flatType} onChange={set('flatType')}>{['', 'Plot', 'Villa', '1BHK', '2BHK', '3BHK', '4BHK'].map(t => <option key={t} value={t}>{t || 'Not set'}</option>)}</select></label>
      <button className="btn" type="submit" disabled={!ready || busy}>{busy ? 'Adding…' : count > 0 ? `Add ${num(count)} plot${count === 1 ? '' : 's'}` : 'Add plots'}</button>
      <div style={{ gridColumn: '1 / -1', fontSize: 12, color: msg ? (msg.ok ? 'var(--good)' : 'var(--bad)') : 'var(--ink3)' }} role="status">
        {msg ? msg.text : ready ? `Creates ${code(from)} to ${code(to)} in ${block}, all marked vacant. Numbers that already exist are skipped.` : count > 2000 ? 'Add at most 2,000 at a time.' : 'Name the block, then choose the range of plot numbers.'}
      </div>
    </form>
  );
}

/** bring a section of this page into view */
const jump = id => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

export function Association360() {
  const { id } = useParams();
  const { go, copAsk, issues, patchView, openModal } = usePortal();
  const a = findAssoc(id);
  // the sidebar's "Association 360" reopens whichever account was viewed last
  useEffect(() => { if (a) patchView({ lastAssoc: a.id }); }, [a, patchView]);
  // connected: blocks, committee and app numbers come with the account's own record
  const [, repaint] = useState(0);
  useEffect(() => {
    if (!LIVE || !a || a.detail) return;
    let on = true;
    assocDetail(a.id).then(d => { Object.assign(a, d); if (on) repaint(n => n + 1); }).catch(() => {});
    return () => { on = false; };
  }, [a]);
  /** read the account again after its plots change */
  const reload = () => assocDetail(a.id).then(d => { Object.assign(a, d); repaint(n => n + 1); });

  if (!a) {
    return (
      <div className="empty">
        No association with id “{id}”.{' '}
        <button onClick={() => go('associations')} style={{ color: 'var(--acc-ink)', fontWeight: 800 }}>See all associations →</button>
      </div>
    );
  }

  const h = health(a), col = bandColor(h.band);
  const inv = INVOICES.filter(i => i.a === a.id);
  const iss = issues.filter(i => i.a === a.id);
  const outstanding = inv.filter(i => i.state !== 'Paid').reduce((s, i) => s + i.amt, 0);

  return (
    <>
      <div className="crumb">
        <button onClick={() => go('associations')} style={{ color: 'var(--acc-ink)', fontWeight: 800 }}>‹ All associations</button> · Association 360
      </div>

      <div className="a360-head">
        <div className="logo" style={{ background: a.c, color: a.tc }}>{a.ini}</div>
        <div className="hh">
          <h1>{a.n}</h1>
          <div className="meta">{a.type} · {a.city}{LIVE ? '' : ', Karnataka'} · reg. {a.reg} · onboarded {a.since}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <Pill tone={stateTone(a.state)}>{a.state}</Pill>
            <Pill tone={payTone(a.pay)}>{a.pay}</Pill>
            <Pill>{a.plan} · billed {a.bill}</Pill>
          </div>
          {LIVE && <div className="a360-acts">
            <button className="btn sm soft" onClick={() => openModal(<EditSociety id={a.id} />)}><Pencil size={13} /> Edit details</button>
            <button className="btn sm soft" onClick={() => openModal(<RaiseInvoice id={a.id} />)}><FilePlus2 size={13} /> Raise invoice</button>
            <button className="btn sm ghost danger-txt" onClick={() => openModal(<RemoveSociety id={a.id} />)}><Trash2 size={13} /> Remove society</button>
          </div>}
        </div>
        <div className="healthbox">
          <div className="ring"><Ring pct={h.score} size={56} color={col} /><b className="num" style={{ color: col }}>{h.score}</b></div>
          <div className="hl"><b style={{ color: col }}>{h.band}</b><span>{h.why}</span></div>
        </div>
      </div>

      <div className={'att ' + (h.band === 'Healthy' ? 'good' : 'warn')} style={{ marginBottom: 16 }}>
        <div className="t">What matters on this account</div>
        <b className="head">{a.note}</b>
        <div className="act">
          <button className="btn sm ai" onClick={() => copAsk('What should I do about ' + a.n.replace(/'/g, '') + '?')}><Sparkles size={14} /> Ask the assistant</button>
          <a className="btn sm ghost" href={a.ph ? 'tel:' + String(a.ph).replace(/[^\d+]/g, '') : undefined} aria-disabled={!a.ph} title={a.ph || 'No phone number on file'}><Phone size={13} /> Call {a.admin.split(' ')[0]}</a>
        </div>
      </div>

      <div className="kpis">
        <Kpi label="Plots" value={num(a.plots)} sub={LIVE ? (a.homes ? `${num(a.homes.length)} set up on the app` : 'loading…') : a.blocks.length + ' blocks'} onClick={() => jump(LIVE ? 'plots' : 'blocks')} hint={LIVE ? 'See the list of this society’s plots' : 'Go to this society’s blocks and units'} icon="office_building" tone="indigo" />
        <Kpi label="Owners registered" value={a.adopt + '%'} sub={`${num(a.owners)} of ${num(a.plots)} plots`} onClick={() => jump('adoption')} hint={`${num(Math.max(0, a.plots - a.owners))} plots still to claim an account`} icon="busts_in_silhouette" tone="good" />
        <Kpi label="Annual value" value={fmtL(a.annual)} sub={`${a.plan} · billed ${a.bill}`} onClick={() => go('renewals')} icon="chart_increasing" tone="sky" />
        <Kpi label="Outstanding" value={outstanding ? fmtL(outstanding) : '₹0'} sub={inv.length + ' invoice' + (inv.length === 1 ? '' : 's')} onClick={() => go('collections')} icon="receipt" tone={outstanding ? 'bad' : 'good'} hot={outstanding > 0 && a.pay !== 'Paid'} />
        <Kpi label="Open tickets" value={iss.filter(i => i.st !== 'Resolved').length} sub={iss.length + ' raised in total'} onClick={() => go('issues')} icon="ticket" tone="warn" />
        {LIVE ? <Kpi label="On the resident app" value={a.onApp ? num(a.onApp.residents) : '—'} sub={a.onApp ? num(a.onApp.units) + ' homes set up' : 'loading…'} hint="Residents who have a home on the app in this society" icon="mobile_phone" tone="violet" />
          : <Kpi label="Wallet credits" value={num(a.credits)} sub={a.credits ? '~' + Math.round(a.credits / 197) + ' days left' : 'none purchased'} hint="₹1 = 1 credit. Credits fund SMS, WhatsApp and payment-gateway charges." icon="coin" tone="violet" />}
      </div>

      <div className="grid2">
        <div className="panel">
          <h3 id="adoption">Adoption over 12 months</h3>
          <div className="p-sub">Share of plots with a registered owner — the strongest renewal signal we have</div>
          <div style={{ minHeight: 170 }}><UsageChart assoc={a} /></div>
        </div>
        <div className="panel">
          <h3>Account timeline</h3>
          <div className="p-sub">What has actually happened on this account</div>
          <div className="tl">
            {a.tl.map(([title, detail, when, hot], n) => (
              <div key={n} className={'tstep' + (hot ? ' hot' : '')}><b>{title}</b><div>{detail}</div><span className="when">{when}</span></div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid2e">
        <div className="panel">
          <h3 id="blocks">Blocks & units</h3>
          <div className="p-sub">How the society is divided</div>
          <div className="tbl-wrap">
            <table className="tbl" style={{ minWidth: 0 }}>
              <thead><tr><th>Block</th><th>Units</th><th>Floors</th><th>Share</th></tr></thead>
              <tbody>
                {a.blocks.map(([name, units, floors]) => (
                  <tr key={name}><td style={{ color: 'var(--ink)', fontWeight: 600 }}>{name}</td><td className="num">{units}</td><td className="num">{floors ?? '—'}</td><td className="num">{Math.round(units / a.plots * 100)}%</td></tr>
                ))}
                {!a.blocks.length && <tr><td colSpan={4} style={{ color: 'var(--ink3)' }}>{a.detail ? 'No homes have been added in the society console yet.' : 'Loading…'}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <div className="panel">
          <h3>Managing committee</h3>
          <div className="p-sub">Office bearers and their direct contacts</div>
          {a.committee.map(([name, role, ph]) => (
            <div key={name} className="person">
              <div className="av" style={{ background: a.c, color: a.tc }}>{initials(name)}</div>
              <div style={{ flex: 1 }}><b>{name}</b><span>{role} · {ph}</span></div>
              <a className="btn sm ghost" href={ph ? 'tel:' + String(ph).replace(/[^\d+]/g, '') : undefined} title={ph || 'No phone number on file'}>Call</a>
            </div>
          ))}
          {LIVE && a.detail && !a.committee.length && <div style={{ fontSize: 12.5, color: 'var(--ink3)' }}>No committee contacts have been added yet.</div>}
          <div className="kv" style={{ marginTop: 10 }}><span>Registered address</span><b style={{ maxWidth: '60%' }}>{a.addr}</b></div>
          <div className="kv"><span>Association admin</span><b>{a.admin} · {a.role}</b></div>
          <div className="kv"><span>Email</span><b>{a.em || '—'}</b></div>
        </div>
      </div>

      {LIVE && a.detail && (
        <div id="plots" style={{ marginBottom: 14, scrollMarginTop: 90 }}>
          {a.homes.length ? (
            <DataList
              local pageSize={10} rows={a.homes} rowKey={u => u.code} noun="plot" minWidth={680} title="Plots & flats" sub={`${num(a.homes.length)} of ${num(a.plots)} contracted plots are set up on the app`}
              search={u => [u.code, u.tower, u.flatType, u.owner]} searchPlaceholder="Search by plot number, block or owner" defaultSort={{ key: 'code', dir: 'asc' }}
              filters={[{ key: 'block', label: 'Block', get: u => u.tower }, { key: 'occ', label: 'Occupied by', get: u => u.occupancy, options: ['Owner-occupied', 'Rented', 'Vacant'] }, { key: 'claimed', label: 'Owner on the app', get: u => (u.owner ? 'Yes' : 'No'), options: ['Yes', 'No'] }]}
              csv={{ name: 'plots', head: ['Plot', 'Block', 'Type', 'Area (sq ft)', 'Occupied by', 'Owner', 'Residents on the app'], row: u => [u.code, u.tower, u.flatType, u.area || '', u.occupancy, u.owner ?? '', u.residents] }}
              columns={[
                { key: 'code', label: 'Plot', sort: u => u.code, cell: u => <b className="num" style={{ color: 'var(--ink)' }}>{u.code}</b> },
                { key: 'tower', label: 'Block', sort: u => u.tower, cell: u => u.tower },
                { key: 'type', label: 'Type', sort: u => u.flatType, cell: u => <>{u.flatType || '—'}{u.area > 0 && <i className="a-sub num">{num(u.area)} sq ft</i>}</> },
                { key: 'occ', label: 'Occupied by', sort: u => u.occupancy, cell: u => <Pill tone={u.occupancy === 'Vacant' ? 'warn' : u.occupancy === 'Rented' ? 'good' : undefined}>{u.occupancy}</Pill> },
                { key: 'owner', label: 'Owner', sort: u => (u.owner ?? '').toLowerCase(), cell: u => u.owner ?? <span style={{ color: 'var(--ink3)' }}>Not registered yet</span> },
                { key: 'residents', label: 'On the app', right: true, sort: u => u.residents, cell: u => <span className="num">{u.residents}</span> },
              ]}
            />
          ) : (
            <div className="panel" style={{ marginBottom: 0 }}>
              <h3>Plots & flats</h3>
              <div className="p-sub">None of the {num(a.plots)} contracted plots is set up on the app yet</div>
              <div style={{ fontSize: 13, color: 'var(--ink2)', maxWidth: '75ch' }}>
                The {num(a.plots)} is the size agreed when the society was onboarded. The plots themselves are set up below, or by the society’s office in its own console (<b>Users &amp; units → Flats → Add flats</b>, which can also build a tower floor by floor).
              </div>
              <SetUpPlots a={a} onDone={reload} />
            </div>
          )}
          {a.homes.length > 0 && a.homes.length < a.plots && (
            <div className="panel" style={{ marginTop: 14, marginBottom: 0 }}>
              <h3>Add more plots</h3>
              <div className="p-sub">{num(a.plots - a.homes.length)} of the contracted {num(a.plots)} are still to be set up</div>
              <SetUpPlots key={a.homes.length} a={a} onDone={reload} />
            </div>
          )}
        </div>
      )}

      {LIVE && <Subscription a={a} />}

      {iss.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          <DataList
            local pageSize={5} rows={iss} rowKey={i => i.id} noun="issue" minWidth={720} title="Support issues on this account" sub="Raised by residents, committee members or service associates"
            search={i => [i.id, i.t, i.by, i.src]} searchPlaceholder="Search this account’s issues" defaultSort={{ key: 'st', dir: 'asc' }}
            filters={[{ key: 'status', label: 'Status', get: i => i.st }, { key: 'pri', label: 'Priority', get: i => i.pri, options: ['High', 'Medium', 'Low'] }]}
            columns={[
              { key: 'issue', label: 'Issue', sort: i => i.id, cell: i => <><b className="num" style={{ color: 'var(--ink3)', fontSize: 11 }}>{i.id}</b><div style={{ color: 'var(--ink)', fontWeight: 600 }}>{i.t}</div></> },
              { key: 'by', label: 'Raised by', sort: i => i.by.toLowerCase(), cell: i => <>{i.by}<i className="a-sub">{i.src}</i></> },
              { key: 'pri', label: 'Priority', sort: i => ({ High: 0, Medium: 1, Low: 2 })[i.pri] ?? 3, cell: i => <Pill tone={priTone(i.pri)}>{i.pri}</Pill> },
              { key: 'sla', label: 'SLA', cell: i => <Pill tone={slaTone(i.slaState)}>{i.sla}</Pill> },
              { key: 'st', label: 'Status', sort: i => i.st, cell: i => <Pill tone={statusTone(i.st)}>{i.st}</Pill> },
            ]}
          />
        </div>
      )}

      {a.id === 'asn-2' && (
        <CommunityPanel
          title="Community Engagement — the module this account asked for"
          sub="Requested at the August business review · not yet in any plan"
          actions={(
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              <a className="btn ai" href={COMMUNITY_SIM_URL} target="_blank" rel="noopener noreferrer"><Heart size={14} /> Open the Community simulation <ExternalLink size={13} /></a>
              <button className="btn ghost" onClick={() => go('modules')}>See it in the module catalog</button>
            </div>
          )}
        >
          Prestige Lakeside Habitat asked for a resident community app: announcements, discussions, events, polls and an AI assistant that files real issues, with a moderation console for the committee. A working simulation of exactly that already exists — it uses this account's own demo records.
        </CommunityPanel>
      )}
    </>
  );
}
