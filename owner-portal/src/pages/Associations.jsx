import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChevronsUpDown, Download, LayoutGrid, List, Plus, Search, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Kpi, Pill, Ring } from '../components/ui';
import { ASSOC, bandColor, bandTone, fmtL, health, num, payTone, stateTone } from '../data/portal';
import { LIVE } from '../lib/api';
import { Onboard } from './Onboard';
import { usePortal } from '../store/context';

/* Every association the operator serves. Search, five filters, sortable columns and paging — all
   kept in the address bar, so a filtered list survives a refresh, the back button and a shared link. */

const BANDS = ['Healthy', 'Watch', 'At risk', 'Critical'];
const SIZES = [10, 25, 50, 100];
/** column key → [how to read it, the direction a first click sorts in] */
const SORTS = {
  health: [a => health(a).score, 'asc'], name: [a => a.n.toLowerCase(), 'asc'], status: [a => a.state, 'asc'], plan: [a => ({ Starter: 1, Professional: 2, Enterprise: 3 })[a.plan] ?? 0, 'desc'],
  plots: [a => a.plots, 'desc'], adopt: [a => a.adopt, 'desc'], annual: [a => a.annual, 'desc'], pay: [a => a.pay, 'asc'], renewal: [a => (a.state === 'Suspended' ? Infinity : a.days), 'asc'],
};
const DEFAULTS = { q: '', status: '', plan: '', health: '', pay: '', city: '', sort: 'health', dir: 'asc', page: '1', size: '10', view: '' };
const when = a => (a.state === 'Suspended' ? 'Suspended' : a.days < 0 ? Math.abs(a.days) + ' days ago' : a.days === 0 ? 'today' : 'in ' + a.days + ' days');
const uniq = list => [...new Set(list.filter(Boolean))].sort((a, b) => a.localeCompare(b));

function exportCsv(rows) {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['Sl. no.', 'Association', 'City', 'Type', 'Status', 'Plan', 'Plots', 'Owners', 'Onboarded %', 'Annual value', 'Payment', 'Renewal', 'Health', 'Score', 'Contact', 'Email', 'Phone'];
  const lines = rows.map((a, i) => [i + 1, a.n, a.city, a.type, a.state, a.plan, a.plots, a.owners, a.adopt, a.annual, a.pay, a.renew, health(a).band, health(a).score, a.admin, a.em, a.ph]);
  const blob = new Blob(['﻿' + [head, ...lines].map(l => l.map(q).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob); link.download = 'associations.csv'; link.click();
  URL.revokeObjectURL(link.href);
}

export function Associations() {
  const { go, toast, openModal } = usePortal();
  const [params, setParams] = useSearchParams();
  const p = Object.fromEntries(Object.keys(DEFAULTS).map(k => [k, params.get(k) ?? DEFAULTS[k]]));
  /** change some of the list's settings; anything but a page change goes back to page 1 */
  const set = patch => setParams(prev => {
    const next = { ...Object.fromEntries(Object.keys(DEFAULTS).map(k => [k, prev.get(k) ?? DEFAULTS[k]])), ...('page' in patch ? {} : { page: '1' }), ...patch };
    return Object.fromEntries(Object.entries(next).filter(([k, v]) => v !== DEFAULTS[k]));
  }, { replace: true });

  // The search box answers at once from its own state — typing must never wait on the address bar,
  // or fast typing drops letters. The address bar catches up a moment after the last keystroke.
  const [text, setText] = useState(p.q);
  const timer = useRef(null);
  const search = value => {
    setText(value);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => set({ q: value.trim() }), 250);
  };
  /** set filters from outside the box (a chip, "Clear all", a KPI card) — the box follows */
  const apply = patch => { if ('q' in patch) { clearTimeout(timer.current); setText(patch.q); } set(patch); };

  const mode = p.view || (window.innerWidth < 760 ? 'cards' : 'table');
  const term = text.trim().toLowerCase();
  const matches = a => (!term || [a.n, a.city, a.type, a.plan, a.state, a.admin, a.em, a.ph, a.reg].some(v => String(v ?? '').toLowerCase().includes(term)))
    && (!p.status || a.state === p.status) && (!p.plan || a.plan === p.plan) && (!p.health || health(a).band === p.health) && (!p.pay || a.pay === p.pay) && (!p.city || a.city === p.city);
  const [read] = SORTS[p.sort] ?? SORTS.health, sign = p.dir === 'desc' ? -1 : 1;
  const found = ASSOC.filter(matches).sort((x, y) => { const a = read(x), b = read(y); return (a < b ? -1 : a > b ? 1 : x.n.localeCompare(y.n)) * sign; });

  const size = SIZES.includes(Number(p.size)) ? Number(p.size) : 10;
  const pages = Math.max(1, Math.ceil(found.length / size));
  const page = Math.min(pages, Math.max(1, Number(p.page) || 1));
  const from = (page - 1) * size, rows = found.slice(from, from + size);

  const active = [['q', text.trim() && `“${text.trim()}”`], ['status', p.status], ['plan', p.plan], ['health', p.health], ['pay', p.pay], ['city', p.city]].filter(([, v]) => v);
  const clear = () => apply({ q: '', status: '', plan: '', health: '', pay: '', city: '' });
  const sortBy = key => set(p.sort === key ? { dir: p.dir === 'asc' ? 'desc' : 'asc' } : { sort: key, dir: SORTS[key][1] });
  /** a column heading that sorts: plain functions, not components, so nothing remounts as you type */
  const th = (k, children, right) => (
    <th key={k} className={right ? 'r' : ''} aria-sort={p.sort === k ? (p.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button className={'th-sort' + (p.sort === k ? ' on' : '')} onClick={() => sortBy(k)}>{children}{p.sort === k ? (p.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ChevronsUpDown size={12} />}</button>
    </th>
  );
  const select = (k, label, options) => (
    <label key={k} className={'flt' + (p[k] ? ' on' : '')}><span>{label}</span>
      <select value={p[k]} onChange={e => set({ [k]: e.target.value })} aria-label={label}><option value="">All</option>{options.map(o => <option key={o}>{o}</option>)}</select>
    </label>
  );

  const count = f => ASSOC.filter(f).length;
  const arr = ASSOC.filter(a => a.state === 'Active').reduce((s, a) => s + a.annual, 0);
  const plots = ASSOC.reduce((s, a) => s + a.plots, 0), owners = ASSOC.reduce((s, a) => s + a.owners, 0);
  const risky = count(a => ['At risk', 'Critical'].includes(health(a).band)), late = count(a => a.pay === 'Past due' || a.pay === 'Suspended');
  const onboard = () => (LIVE ? openModal(<Onboard />) : toast('Onboarding wizard', 'The real flow captures registration, bank proof, blocks and the first invoice.'));

  return (
    <>
      <div className="dash-head">
        <div>
          <h1 className="pgt">Associations</h1>
          <div className="dash-sub">{num(ASSOC.length)} association{ASSOC.length === 1 ? '' : 's'} · {num(plots)} plots · {fmtL(arr)} annual recurring revenue</div>
        </div>
        <div className="dash-act">
          <button className="btn ghost sm" onClick={() => exportCsv(found)} disabled={!found.length}><Download size={14} /> Export {found.length !== ASSOC.length ? `${found.length} ` : ''}to CSV</button>
          <button className="btn sm" onClick={onboard}><Plus size={14} /> Onboard association</button>
        </div>
      </div>

      <div className="kpis">
        <Kpi label="Active" value={count(a => a.state === 'Active')} sub={`of ${ASSOC.length} associations`} onClick={() => apply({ status: 'Active', q: '', plan: '', health: '', pay: '', city: '' })} />
        <Kpi label="On trial" value={count(a => a.state === 'Trial')} sub={count(a => a.trial) ? fmtL(ASSOC.filter(a => a.trial).reduce((s, a) => s + a.annual, 0)) + ' a year if they convert' : 'No trial running'} onClick={() => apply({ status: 'Trial', q: '', plan: '', health: '', pay: '', city: '' })} />
        <Kpi label="At risk" value={risky} sub="Health score below 52" onClick={() => apply({ sort: 'health', dir: 'asc', status: '', q: '', plan: '', health: '', pay: '', city: '' })} hot={risky > 0} />
        <Kpi label="Past due or suspended" value={late} sub={late ? 'Sorted by payment state' : 'Everyone is paid up'} onClick={() => apply({ sort: 'pay', dir: 'asc', status: '', q: '', plan: '', health: '', pay: '', city: '' })} hot={late > 0} />
        <Kpi label="Owner onboarding" value={(plots ? Math.round(owners / plots * 100) : 0) + '%'} sub={`${num(owners)} of ${num(plots)} plots`} onClick={() => set({ sort: 'adopt', dir: 'asc' })} />
        <Kpi label="Renewing in 30 days" value={count(a => a.state !== 'Suspended' && a.days <= 30)} sub="Renewals and trial ends" onClick={() => set({ sort: 'renewal', dir: 'asc' })} />
      </div>

      <div className="list-card">
        <div className="list-bar">
          <label className="tb-search"><Search size={15} />
            <input value={text} onChange={e => search(e.target.value)} placeholder="Search by name, city, plan, contact, email, phone or registration no." aria-label="Search associations" />
            {text && <button onClick={() => apply({ q: '' })} aria-label="Clear search"><X size={14} /></button>}
          </label>
          {select('status', 'Status', ['Active', 'Trial', 'Pending', 'Suspended'])}
          {select('plan', 'Plan', ['Starter', 'Professional', 'Enterprise'])}
          {select('health', 'Health', BANDS)}
          {select('pay', 'Payment', uniq(ASSOC.map(a => a.pay)))}
          {select('city', 'City', uniq(ASSOC.map(a => a.city)))}
          <div className="seg" role="group" aria-label="View">
            <button className={mode === 'table' ? 'on' : ''} onClick={() => set({ view: 'table', page: String(page) })} aria-label="Table view" title="Table"><List size={15} /></button>
            <button className={mode === 'cards' ? 'on' : ''} onClick={() => set({ view: 'cards', page: String(page) })} aria-label="Card view" title="Cards"><LayoutGrid size={15} /></button>
          </div>
        </div>
        <div className="list-info">
          <span>{found.length === ASSOC.length ? `${num(found.length)} association${found.length === 1 ? '' : 's'}` : `${num(found.length)} of ${num(ASSOC.length)} match`}</span>
          {active.map(([k, v]) => <button key={k} className="chip" onClick={() => apply({ [k]: '' })} aria-label={`Remove filter ${v}`}>{k === 'q' ? 'Search' : k === 'pay' ? 'Payment' : k[0].toUpperCase() + k.slice(1)}: <b>{v}</b><X size={12} /></button>)}
          {active.length > 0 && <button className="clear" onClick={clear}>Clear all</button>}
        </div>

        {!rows.length ? (
          <div className="empty">
            {ASSOC.length ? <>No association matches these filters.<br /><button className="btn ghost sm" style={{ marginTop: 10 }} onClick={clear}>Clear filters</button></> : 'No associations yet. Onboard the first one to get started.'}
          </div>
        ) : mode === 'table' ? (
          <div className="tbl-wrap">
            <table className="tbl assoc-tbl">
              <thead><tr>
                <th className="sl">Sl. no.</th>{th('name', 'Association')}{th('status', 'Status')}{th('plan', 'Plan')}{th('plots', 'Plots', true)}{th('adopt', 'Owners onboarded')}
                {th('annual', 'Annual value', true)}{th('pay', 'Payment')}{th('renewal', 'Renewal')}{th('health', 'Health')}<th />
              </tr></thead>
              <tbody>
                {rows.map((a, i) => {
                  const h = health(a);
                  return (
                    <tr key={a.id} className="rowbtn" onClick={() => go('a360', a.id)}>
                      <td className="sl num">{from + i + 1}</td>
                      <td>
                        <div className="a-cell">
                          <span className="a-logo" style={{ background: a.c, color: a.tc }}>{a.ini}</span>
                          <span><b>{a.n}</b><i>{a.city} · {a.type}</i></span>
                        </div>
                      </td>
                      <td><Pill tone={stateTone(a.state)}>{a.state}</Pill></td>
                      <td>{a.plan}</td>
                      <td className="r num">{num(a.plots)}</td>
                      <td><div className="a-bar"><span><i style={{ width: Math.min(100, a.adopt) + '%', background: a.adopt >= 70 ? 'var(--good)' : a.adopt >= 40 ? '#E5A13B' : 'var(--bad)' }} /></span><b className="num">{a.adopt}%</b></div></td>
                      <td className="r num" style={{ color: 'var(--ink)', fontWeight: 700 }}>{fmtL(a.annual)}</td>
                      <td><Pill tone={payTone(a.pay)}>{a.pay}</Pill>{a.overdue?.count ? <i className="a-sub bad">{fmtL(a.overdue.amount)} overdue</i> : null}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{a.renew}<i className={'a-sub' + (a.days <= 30 && a.state !== 'Suspended' ? ' warn' : '')}>{a.trial ? 'trial ends ' : ''}{when(a)}</i></td>
                      <td><Pill tone={bandTone(h.band)}>{h.band} {h.score}</Pill><i className="a-sub">{h.why}</i></td>
                      <td className="r"><ChevronRight size={16} style={{ color: 'var(--ink3)' }} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="assoc-grid" style={{ padding: 14 }}>
            {rows.map((a, i) => {
              const h = health(a), col = bandColor(h.band);
              return (
                <button key={a.id} className="acard" onClick={() => go('a360', a.id)}>
                  <div className="top">
                    <div className="logo" style={{ background: a.c, color: a.tc }}>{a.ini}</div>
                    <div style={{ minWidth: 0 }}><b className="nm">{from + i + 1}. {a.n}</b><span className="loc">{a.city} · {a.type}</span></div>
                    <div className="ring"><Ring pct={h.score} size={46} color={col} /><b style={{ color: col }} className="num">{h.score}</b></div>
                  </div>
                  <div className="mid">
                    <Pill tone={stateTone(a.state)}>{a.state}</Pill>
                    {a.pay !== a.state && <Pill tone={payTone(a.pay)}>{a.pay}</Pill>}
                    <Pill>{a.plan}</Pill>
                  </div>
                  <div style={{ fontSize: 11.5, color: col, fontWeight: 700 }}>{h.band} · {h.why}</div>
                  <div className="stats">
                    <div><b className="num">{num(a.plots)}</b><span>PLOTS</span></div>
                    <div><b className="num">{a.adopt}%</b><span>ONBOARDED</span></div>
                    <div><b className="num">{fmtL(a.annual)}</b><span>ANNUAL</span></div>
                  </div>
                  <div className="foot"><span>{a.trial ? 'Trial ends ' : 'Renews '}{a.renew}</span><span className="go">Open →</span></div>
                </button>
              );
            })}
          </div>
        )}

        {found.length > 0 && (
          <div className="pager">
            <span>Showing <b>{from + 1}–{from + rows.length}</b> of <b>{num(found.length)}</b></span>
            <label>Rows per page<select value={size} onChange={e => set({ size: e.target.value })} aria-label="Rows per page">{SIZES.map(s => <option key={s}>{s}</option>)}</select></label>
            <span className="spacer" />
            <div className="pg-btns">
              <button onClick={() => set({ page: '1' })} disabled={page === 1} aria-label="First page"><ChevronsLeft size={15} /></button>
              <button onClick={() => set({ page: String(page - 1) })} disabled={page === 1} aria-label="Previous page"><ChevronLeft size={15} /></button>
              <span>Page <b>{page}</b> of <b>{pages}</b></span>
              <button onClick={() => set({ page: String(page + 1) })} disabled={page === pages} aria-label="Next page"><ChevronRight size={15} /></button>
              <button onClick={() => set({ page: String(pages) })} disabled={page === pages} aria-label="Last page"><ChevronsRight size={15} /></button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
