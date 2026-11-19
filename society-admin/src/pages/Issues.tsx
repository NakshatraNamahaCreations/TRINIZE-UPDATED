import { Alarm, CheckCircle, DownloadSimple, MagnifyingGlassMinus, Ticket, Wrench, X } from '@phosphor-icons/react';
import { TableCard } from '../components/TableCard';
import { useCallback } from 'react';
import { useSearchParams } from 'react-router';
import { IssueDrawer } from '../components/IssueDrawer';
import { Avatar, Empty, PageHead, Pill, Stat } from '../components/ui';
import { downloadCsv, priTone, slaTone, statusTone } from '../lib/format';
import { useStore } from '../store/context';
import { isOpen, type Issue } from '../store/data';

const FILTERS = ['All', 'Open', 'In progress', 'Resolved', 'SLA breached'] as const;
type Filter = (typeof FILTERS)[number];

const MATCH: Record<Filter, (i: Issue) => boolean> = {
  All: () => true,
  Open: isOpen,
  'In progress': i => i.status === 'In Progress',
  Resolved: i => !isOpen(i),
  'SLA breached': i => i.slaState === 'over',
};

const matchesQuery = (i: Issue, q: string) =>
  !q || [i.id, i.title, i.cat, i.loc, i.by, i.unit, i.vendor].some(v => v.toLowerCase().includes(q));

export function Issues() {
  const { state } = useStore();
  const [params, setParams] = useSearchParams();
  const f = (FILTERS as readonly string[]).includes(params.get('filter') ?? '') ? (params.get('filter') as Filter) : 'All';
  const q = params.get('q') ?? '';
  const openId = params.get('open');
  const list = state.issues.filter(MATCH[f]).filter(i => matchesQuery(i, q.trim().toLowerCase()));
  const drawerIssue = openId ? state.issues.find(i => i.id === openId) : undefined;

  const setParam = (k: string, v: string | null) =>
    setParams(p => { const n = new URLSearchParams(p); if (v === null || v === '') n.delete(k); else n.set(k, v); return n; }, { replace: k === 'q' });
  const close = useCallback(() => setParams(p => { const n = new URLSearchParams(p); n.delete('open'); return n; }), [setParams]);

  const open = state.issues.filter(isOpen);
  const exportCsv = () => downloadCsv(`issues-${f.toLowerCase().replace(/\s+/g, '-')}.csv`, [
    ['ID', 'Title', 'Category', 'Location', 'Raised by', 'Unit', 'Priority', 'Vendor', 'SLA', 'Status', 'Raised'],
    ...list.map(i => [i.id, i.title, i.cat, i.loc, i.by, i.unit, i.pri, i.vendor, i.sla, i.status, i.when]),
  ]);

  return (
    <>
      <PageHead
        title="Issues & concerns"
        sub="Raised by residents in the app or through the AI assistant. Assign, update and resolve — residents see public updates only; internal notes stay here."
        actions={<button className="a-btn ghost" onClick={exportCsv} disabled={!list.length}><DownloadSimple size={15} />Export CSV</button>}
      />
      <div className="stats">
        <Stat icon={Ticket} label="Open" value={open.length} />
        <Stat icon={Wrench} label="In progress" value={state.issues.filter(i => i.status === 'In Progress').length} />
        <Stat icon={Alarm} label="SLA breached" value={state.issues.filter(i => i.slaState === 'over').length} tone="bad" />
        <Stat icon={CheckCircle} label="Resolved" value={state.issues.length - open.length} tone="good" />
      </div>

      <div className="toolbar">
        <div className="filters">
          {FILTERS.map(x => <button key={x} className={x === f ? 'on' : ''} onClick={() => setParam('filter', x === 'All' ? null : x)}>{x}</button>)}
        </div>
        <div className="search-in">
          <input className="a-in" value={q} onChange={e => setParam('q', e.target.value)} placeholder="Filter by ID, title, resident, vendor…" aria-label="Filter issues" />
          {q && <button onClick={() => setParam('q', null)} aria-label="Clear search"><X size={14} /></button>}
        </div>
      </div>

      <TableCard rows={list} noun="issue" filters={[{ key: 'pri', label: 'Priority', get: i => i.pri }, { key: 'status', label: 'Status', get: i => i.status }, { key: 'cat', label: 'Category', get: i => i.cat }, { key: 'vendor', label: 'Vendor', get: i => i.vendor }]}>{(page, sl) => (<div className="a-tbl-wrap">
        <table className="a-tbl">
          <tbody>
            <tr><th className="sl">Sl. no.</th><th>Issue</th><th>Raised by</th><th>Priority</th><th>Vendor</th><th>SLA</th><th>Status</th></tr>
            {page.map((i, rowNo) => (
              <tr key={i.id} className="rowbtn" tabIndex={0} onClick={() => setParam('open', i.id)}
                onKeyDown={e => { if (e.key === 'Enter') setParam('open', i.id); }}><td className="sl num">{sl(rowNo)}</td>
                <td>
                  <span className="cell-id num">{i.id}</span> · <span className="cell-t">{i.title}</span>
                  <div className="cell-m">{i.cat} · {i.loc} · {i.when}</div>
                </td>
                <td data-l="Raised by">
                  <span className="who-cell"><Avatar name={i.by} size={26} /><span>{i.by}<small>{i.unit}</small></span></span>
                </td>
                <td data-l="Priority"><Pill tone={priTone(i.pri)}>{i.pri}</Pill></td>
                <td data-l="Vendor">{i.vendor}</td>
                <td data-l="SLA"><Pill tone={slaTone(i.slaState)}>{i.sla}</Pill></td>
                <td data-l="Status"><Pill tone={statusTone(i.status)} dot>{i.status}</Pill></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length && <Empty icon={MagnifyingGlassMinus} title="No issues match" body={q ? `Nothing matches “${q}” in ${f.toLowerCase()} issues.` : 'Nothing matches this filter.'} />}
      </div>)}</TableCard>
      <div className="flow-note">Issues residents report through the AI assistant arrive here with “Reported via chatbot” in their timeline. Every status change notifies the resident and writes an audit entry.</div>
      {drawerIssue && <IssueDrawer key={drawerIssue.id} issue={drawerIssue} onClose={close} />}
    </>
  );
}
