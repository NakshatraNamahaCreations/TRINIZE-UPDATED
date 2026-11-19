import { useEffect, useState } from 'react';
import { DataList } from '../components/DataList';
import { useSearchParams } from 'react-router';
import { Kpi, PageHead, Pill } from '../components/ui';
import { findAssoc, priTone, PROPERTY_MANAGERS, SLA_ORDER, slaTone, statusTone } from '../data/portal';
import { LIVE } from '../lib/api';
import { ago, ticketDetail } from '../lib/live';
import { usePortal } from '../store/context';

const SLA_NAME = { over: 'Breached', risk: 'At risk', ok: 'On track', met: 'Met' };

/** Assign a property manager and reply to the raiser — opened from the table and from ⌘K. */
export function IssueModal({ id }) {
  const { issues, assignIssue, closeModal } = usePortal();
  const i = issues.find(x => x.id === id);
  const [pm, setPm] = useState(!i || i.pm === 'Unassigned' ? PROPERTY_MANAGERS[0] : i.pm);
  const [note, setNote] = useState('');
  const [resolve, setResolve] = useState(false);
  const [busy, setBusy] = useState(false);
  // connected: what has already been said on the ticket
  const [replies, setReplies] = useState([]);
  const uid = i?.uid;
  useEffect(() => {
    if (!LIVE || !uid) return;
    ticketDetail(uid).then(d => setReplies(d.replies)).catch(() => {});
  }, [uid]);
  if (!i) return null;
  const a = findAssoc(i.a);
  const people = PROPERTY_MANAGERS.includes(pm) ? PROPERTY_MANAGERS : [pm, ...PROPERTY_MANAGERS];
  const save = async () => { setBusy(true); await assignIssue(i.id, pm, note, resolve); setBusy(false); };
  return (
    <>
      <h2>{i.t}</h2>
      <div className="msub">{i.id} · {i.cat} · raised {i.raised}</div>
      <div className="kv"><span>Association</span><b>{a.n}</b></div>
      <div className="kv"><span>Raised by</span><b>{i.by} · {i.src}</b></div>
      <div className="kv"><span>Priority</span><b>{i.pri}</b></div>
      <div className="kv"><span>Assigned to</span><b>{i.pm}</b></div>
      <div className="kv"><span>SLA</span><b>{i.sla}</b></div>
      {replies.length > 0 && (
        <div className="thread">
          {replies.map((r, n) => <div key={n}><b>{r.by}</b><span>{ago(r.at)}</span><p>{r.text}</p></div>)}
        </div>
      )}
      <div style={{ marginTop: 14 }}>
        <select className="in" value={pm} onChange={e => setPm(e.target.value)} style={{ width: '100%', marginBottom: 8 }} aria-label="Property manager">
          {people.map(p => <option key={p}>{p}</option>)}
        </select>
        <textarea className="in" value={note} onChange={e => setNote(e.target.value)} placeholder="Add an update visible to the raiser…" />
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <button className="btn" onClick={save} disabled={busy || (resolve && !note.trim())}>{busy ? 'Saving…' : resolve ? 'Reply & resolve' : 'Assign & reply'}</button>
          <button className="btn ghost" onClick={closeModal}>Cancel</button>
        </div>
        {LIVE && i.st !== 'Resolved' && (
          <label className="check" style={{ margin: '12px 0 0' }}><input type="checkbox" checked={resolve} onChange={e => setResolve(e.target.checked)} /><span>This reply resolves the ticket{resolve && !note.trim() ? ' — write the reply first' : ''}</span></label>
        )}
        {!LIVE && <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 10 }}>Concept demo — assignment updates the table, the KPI counts and the activity feed together.</div>}
      </div>
    </>
  );
}

export function Issues() {
  const { issues, openModal } = usePortal();
  const [, setParams] = useSearchParams();
  /** a summary card narrows the list to what it counts */
  const only = filter => setParams(filter, { replace: true });
  const count = fn => issues.filter(fn).length;

  return (
    <>
      <PageHead crumb="Delivery" title="Support issues" icon="ticket">
        Raised by residents, committee members and service associates across every association. <b>Sorted by SLA urgency</b> — breached and at-risk tickets sit at the top whatever their age.
      </PageHead>

      <div className="kpis">
        <Kpi label="Open" value={count(i => i.st !== 'Resolved')} sub={`of ${issues.length} raised`} onClick={() => only({})} icon="ticket" tone="sky" />
        <Kpi label="SLA breached" value={count(i => i.slaState === 'over')} sub="response time missed" onClick={() => only({ sla: 'Breached' })} icon="alarm_clock" tone="bad" hot />
        <Kpi label="Unassigned" value={count(i => i.pm === 'Unassigned')} sub="no property manager yet" onClick={() => only({ assigned: 'Unassigned' })} icon="red_question_mark" tone="warn" hot />
        <Kpi label="Resolved" value={count(i => i.st === 'Resolved')} sub={LIVE ? 'closed with a reply' : 'both inside SLA'} onClick={() => only({ status: 'Resolved' })} icon="check_mark_button" tone="good" />
      </div>

      <DataList
        rows={issues} rowKey={i => i.id} noun="issue" minWidth={980} onRow={i => openModal(<IssueModal id={i.id} />)}
        search={i => [i.id, i.t, i.cat, i.by, i.src, i.pm, findAssoc(i.a)?.n]} searchPlaceholder="Search by issue number, title, category, who raised it or association"
        defaultSort={{ key: 'sla', dir: 'asc' }} emptyAll="No support issue has been raised."
        filters={[
          { key: 'status', label: 'Status', get: i => i.st },
          { key: 'pri', label: 'Priority', get: i => i.pri, options: ['High', 'Medium', 'Low'] },
          { key: 'sla', label: 'SLA', get: i => SLA_NAME[i.slaState], options: ['Breached', 'At risk', 'On track', 'Met'] },
          { key: 'assigned', label: 'Assigned to', get: i => i.pm },
          { key: 'assoc', label: 'Association', get: i => findAssoc(i.a)?.n },
          { key: 'cat', label: 'Category', get: i => i.cat },
        ]}
        csv={{ name: 'support-issues', head: ['Issue', 'Category', 'Title', 'Raised by', 'Source', 'Association', 'Priority', 'Assigned to', 'SLA', 'Status'], row: i => [i.id, i.cat, i.t, i.by, i.src, findAssoc(i.a)?.n, i.pri, i.pm, i.sla, i.st] }}
        columns={[
          { key: 'issue', label: 'Issue', sort: i => i.id, cell: i => <><b className="num" style={{ color: 'var(--ink3)', fontSize: 11 }}>{i.id} · {i.cat}</b><div style={{ color: 'var(--ink)', fontWeight: 600, marginTop: 2 }}>{i.t}</div></> },
          { key: 'by', label: 'Raised by', sort: i => i.by.toLowerCase(), cell: i => <>{i.by}<i className="a-sub">{i.src} · {i.raised}</i></> },
          { key: 'assoc', label: 'Association', sort: i => findAssoc(i.a)?.n ?? '', cell: i => findAssoc(i.a)?.n ?? '—' },
          { key: 'pri', label: 'Priority', sort: i => ({ High: 0, Medium: 1, Low: 2 })[i.pri] ?? 3, cell: i => <Pill tone={priTone(i.pri)}>{i.pri}</Pill> },
          { key: 'pm', label: 'Assigned to', sort: i => i.pm.toLowerCase(), cell: i => (i.pm === 'Unassigned' ? <Pill tone="warn">Unassigned</Pill> : i.pm) },
          { key: 'sla', label: 'SLA', sort: i => SLA_ORDER[i.slaState], cell: i => <Pill tone={slaTone(i.slaState)}>{i.sla}</Pill> },
          { key: 'st', label: 'Status', sort: i => i.st, cell: i => <Pill tone={statusTone(i.st)}>{i.st}</Pill> },
        ]}
      />
    </>
  );
}
