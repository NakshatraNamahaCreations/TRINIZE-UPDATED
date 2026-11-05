import { Receipt, Sparkles, Ticket } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { NAV } from '../data/nav';
import { ASSOC, findAssoc, fmtI, INVOICES } from '../data/portal';
import { IssueModal } from '../pages/Issues';
import { usePortal } from '../store/context';

/** ⌘K — one search across pages, accounts, invoices, issues and the copilot. */
export function CommandPalette() {
  const { cmdkOpen, setCmdkOpen } = usePortal();
  return (
    <div className={'cmdk' + (cmdkOpen ? ' open' : '')} onClick={e => { if (e.target === e.currentTarget) setCmdkOpen(false); }}>
      {/* mounted only while open, so every opening starts with an empty query */}
      {cmdkOpen && <PaletteBox />}
    </div>
  );
}

function PaletteBox() {
  const portal = usePortal();
  const { setCmdkOpen, issues } = portal;
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const resRef = useRef(null);

  const items = useMemo(() => [
    ...NAV.filter(n => !n.grp).map(n => ({ g: 'Go to', ic: n.ic, t: n.l, s: 'Page', run: p => p.go(n.k) })),
    ...ASSOC.map(a => ({ g: 'Associations', ic: a.ini, t: a.n, s: a.city + ' · ' + a.plan, run: p => p.go('a360', a.id) })),
    ...INVOICES.map(i => ({ g: 'Invoices', ic: Receipt, t: i.id, s: findAssoc(i.a).n + ' · ' + fmtI(i.amt), run: p => p.go('collections') })),
    ...issues.map(i => ({ g: 'Issues', ic: Ticket, t: i.id + ' · ' + i.t, s: findAssoc(i.a).n, run: p => p.openModal(<IssueModal id={i.id} />) })),
    { g: 'Ask', ic: Sparkles, t: 'Ask the copilot what needs me today', s: 'AI', run: p => p.copAsk('What needs me today?') },
  ], [issues]);

  const list = useMemo(() => {
    const s = q.toLowerCase().trim();
    return items.filter(i => !s || (i.t + ' ' + i.s + ' ' + i.g).toLowerCase().includes(s)).slice(0, 26);
  }, [items, q]);

  useEffect(() => { resRef.current?.querySelector('.item.sel')?.scrollIntoView({ block: 'nearest' }); }, [sel]);

  const run = item => { setCmdkOpen(false); item.run(portal); };
  const onKey = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel(s => Math.min(list.length - 1, s + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel(s => Math.max(0, s - 1)); }
    else if (e.key === 'Enter' && list[sel]) run(list[sel]);
  };

  let lastG = '';
  return (
    <div className="box">
      <input autoFocus value={q} onChange={e => { setQ(e.target.value); setSel(0); }} onKeyDown={onKey} placeholder="Type to search — try “prestige”, “invoice”, “issues”…" />
      <div className="res" ref={resRef}>
        {list.length ? list.map((i, n) => {
          const head = i.g !== lastG ? <div className="grp-t">{i.g}</div> : null;
          lastG = i.g;
          return (
            <div key={i.g + i.t}>
              {head}
              <button className={'item' + (n === sel ? ' sel' : '')} onMouseMove={() => setSel(n)} onClick={() => run(i)}>
                <span className="ic">{typeof i.ic === 'string' ? i.ic : <i.ic size={14} />}</span>
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.t}</span>
                <span className="sub">{i.s}</span>
              </button>
            </div>
          );
        }) : <div className="empty">Nothing matches</div>}
      </div>
      <div className="hint"><span>↑↓ navigate</span><span>↵ open</span><span>esc close</span><span style={{ marginLeft: 'auto' }}>One search across the whole portal</span></div>
    </div>
  );
}
