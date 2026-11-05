import { useState } from 'react';
import { Icon3D } from '../components/Icon3D';
import { Kpi, PageHead, Pill } from '../components/ui';
import { findAssoc, priTone, PROPERTY_MANAGERS, SLA_ORDER, slaTone, statusTone } from '../data/portal';
import { usePortal } from '../store/context';

const TABS = ['All', 'Unassigned', 'SLA at risk', 'From residents', 'From associates', 'Resolved'];
const FILTERS = {
  All: () => true,
  Unassigned: i => i.pm === 'Unassigned',
  'SLA at risk': i => i.slaState === 'over' || i.slaState === 'risk',
  'From residents': i => i.src.startsWith('End user'),
  'From associates': i => i.src.startsWith('Associate'),
  Resolved: i => i.st === 'Resolved',
};

/** Assign a property manager and reply to the raiser — opened from the table and from ⌘K. */
export function IssueModal({ id }) {
  const { issues, assignIssue, closeModal } = usePortal();
  const i = issues.find(x => x.id === id);
  const [pm, setPm] = useState(i.pm === 'Unassigned' ? PROPERTY_MANAGERS[0] : i.pm);
  const [note, setNote] = useState('');
  const a = findAssoc(i.a);
  return (
    <>
      <h2>{i.t}</h2>
      <div className="msub">{i.id} · {i.cat} · raised {i.raised}</div>
      <div className="kv"><span>Association</span><b>{a.n}</b></div>
      <div className="kv"><span>Raised by</span><b>{i.by} · {i.src}</b></div>
      <div className="kv"><span>Priority</span><b>{i.pri}</b></div>
      <div className="kv"><span>Assigned to</span><b>{i.pm}</b></div>
      <div className="kv"><span>SLA</span><b>{i.sla}</b></div>
      <div style={{ marginTop: 14 }}>
        <select className="in" value={pm} onChange={e => setPm(e.target.value)} style={{ width: '100%', marginBottom: 8 }} aria-label="Property manager">
          {PROPERTY_MANAGERS.map(p => <option key={p}>{p}</option>)}
        </select>
        <textarea className="in" value={note} onChange={e => setNote(e.target.value)} placeholder="Add an update visible to the raiser…" />
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => assignIssue(i.id, pm)}>Assign & reply</button>
          <button className="btn ghost" onClick={closeModal}>Cancel</button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 10 }}>Concept demo — assignment updates the table, the KPI counts and the activity feed together.</div>
      </div>
    </>
  );
}

export function Issues() {
  const { issues, view, patchView, openModal } = usePortal();
  const F = view.issueFilter;
  // SLA urgency, not age: breached and at-risk sit on top
  const list = issues.filter(FILTERS[F]).sort((a, b) => SLA_ORDER[a.slaState] - SLA_ORDER[b.slaState]);
  const count = fn => issues.filter(fn).length;

  return (
    <>
      <PageHead crumb="Delivery" title="Support issues" icon="ticket">
        Raised by residents, committee members and service associates across every association. <b>Sorted by SLA urgency</b> — breached and at-risk tickets sit at the top whatever their age.
      </PageHead>

      <div className="kpis">
        <Kpi label="Open" value={count(i => i.st !== 'Resolved')} sub={`of ${issues.length} raised`} onClick={() => patchView({ issueFilter: 'All' })} icon="ticket" tone="sky" />
        <Kpi label="SLA breached" value={count(i => i.slaState === 'over')} sub="response time missed" onClick={() => patchView({ issueFilter: 'SLA at risk' })} icon="alarm_clock" tone="bad" hot />
        <Kpi label="Unassigned" value={count(i => i.pm === 'Unassigned')} sub="no property manager yet" onClick={() => patchView({ issueFilter: 'Unassigned' })} icon="red_question_mark" tone="warn" hot />
        <Kpi label="Resolved" value={count(i => i.st === 'Resolved')} sub="both inside SLA" onClick={() => patchView({ issueFilter: 'Resolved' })} icon="check_mark_button" tone="good" />
      </div>

      <div className="filters">
        {TABS.map(t => <button key={t} className={t === F ? 'on' : ''} onClick={() => patchView({ issueFilter: t })}>{t}</button>)}
      </div>

      {list.length ? (
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Issue</th><th>Raised by</th><th>Association</th><th>Priority</th><th>Assigned</th><th>SLA</th><th>Status</th></tr></thead>
            <tbody>
              {list.map(i => (
                <tr key={i.id} className="rowbtn" onClick={() => openModal(<IssueModal id={i.id} />)}>
                  <td>
                    <b className="num" style={{ color: 'var(--ink3)', fontSize: 11 }}>{i.id} · {i.cat}</b>
                    <div style={{ color: 'var(--ink)', fontWeight: 600, marginTop: 2 }}>{i.t}</div>
                  </td>
                  <td>{i.by}<div style={{ fontSize: 11, color: 'var(--ink3)' }}>{i.src}</div></td>
                  <td>{findAssoc(i.a).n}</td>
                  <td><Pill tone={priTone(i.pri)}>{i.pri}</Pill></td>
                  <td>{i.pm === 'Unassigned' ? <Pill tone="warn">Unassigned</Pill> : i.pm}</td>
                  <td><Pill tone={slaTone(i.slaState)}>{i.sla}</Pill></td>
                  <td><Pill tone={statusTone(i.st)}>{i.st}</Pill></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <div className="empty"><Icon3D name="magnifying_glass_tilted_left" size={44} className="empty-3d" />Nothing matches this filter</div>}
    </>
  );
}
