import { Lightning, ListChecks, LockSimple, MapPin, Timer, User, Wrench, X } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { mergeTimeline } from '../lib/timeline';
import { NEXT_LABEL, VENDORS, type Issue } from '../store/data';
import { useStore } from '../store/context';
import { priTone } from '../lib/format';
import { Pill } from './ui';

export function IssueDrawer({ issue: i, onClose }: { issue: Issue; onClose: () => void }) {
  const { actions } = useStore();
  const [note, setNote] = useState('');
  const [internal, setInternal] = useState(false);
  const [vendor, setVendor] = useState(VENDORS[1]);
  const resolved = i.status === 'Resolved' || i.status === 'Closed';
  const next = NEXT_LABEL[i.status];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);

  const advance = () => {
    actions.advanceIssue(i.id, { note: note.trim(), internal, vendor });
    onClose();
  };
  const addNote = () => {
    if (actions.addIssueNote(i.id, note.trim(), internal)) onClose();
  };

  return (
    <>
      <div className="drawer-veil" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={i.id + ' details'}>
        <button className="d-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Pill tone={resolved ? 'good' : 'acc'}>{i.status}</Pill>
          <Pill tone={priTone(i.pri)}>{i.pri}</Pill>
          {i.slaState === 'over' && <Pill tone="bad">SLA breached</Pill>}
        </div>
        <h2>{i.title}</h2>
        <div className="num" style={{ fontSize: 12, color: 'var(--ink3)', marginBottom: 12 }}>{i.id} · {i.cat} · raised {i.when}</div>
        <div className="d-row"><span><User size={16} />Raised by</span><b>{i.by} · {i.unit}</b></div>
        <div className="d-row"><span><MapPin size={16} />Location</span><b>{i.loc}</b></div>
        <div className="d-row"><span><Wrench size={16} />Assigned vendor</span><b>{i.vendor}</b></div>
        <div className="d-row"><span><Timer size={16} />SLA</span><b style={i.slaState === 'over' ? { color: 'var(--bad)' } : undefined}>{i.sla}</b></div>

        <h3 className="d-h"><ListChecks size={17} />Timeline</h3>
        <div className="atl">
          {mergeTimeline(i).map((e, k) => e.kind === 'internal' ? (
            <div key={k} className="tstep internal">
              <b><LockSimple size={12} /> Internal note</b>
              <span className="when">{e.w}</span>
              <div>{e.n}</div>
            </div>
          ) : (
            <div key={k} className={'tstep ' + (e.last && !resolved ? 'cur' : 'done')}>
              <b>{e.s}</b>
              <span className="when">{e.w}</span>
              {e.n && <div>{e.n}</div>}
            </div>
          ))}
        </div>

        {resolved ? (
          <div className="flow-note" style={{ marginTop: 14 }}>Resolved · resident was asked to rate the fix privately. Reopening returns it to the queue.</div>
        ) : (
          <>
            <h3 className="d-h"><Lightning size={17} />Take action</h3>
            {i.status === 'Acknowledged' && (
              <div style={{ marginBottom: 8 }}>
                <select className="a-in" value={vendor} onChange={e => setVendor(e.target.value)} aria-label="Vendor to assign">
                  {VENDORS.map(v => <option key={v}>{v}</option>)}
                </select>
              </div>
            )}
            <textarea className="a-in" value={note} onChange={e => setNote(e.target.value)} placeholder="Add an update… (visible to the resident)" />
            <label className="chk">
              <input type="checkbox" checked={internal} onChange={e => setInternal(e.target.checked)} />
              Internal note — hide from resident
            </label>
            <div className="d-actions">
              {next && <button className="a-btn" onClick={advance}>{next}</button>}
              <button className="a-btn ghost" onClick={addNote}>Add update only</button>
            </div>
            <div className="flow-note">Advancing status notifies the resident (privacy-safe) and writes to the audit log.</div>
          </>
        )}
      </aside>
    </>
  );
}
