import { ArrowCounterClockwise, CalendarCheck, CalendarX, Check, CheckCircle, Plus, Trash, UserCircle, X } from '@phosphor-icons/react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useToast } from '../components/toast-context';
import { Empty, IconBtn, PageHead, PanelHead, Pill, Stat } from '../components/ui';
import { ApiError, LIVE } from '../lib/api';
import { confirmBox } from '../lib/dialog';
import { addItem, clearPlan, clock, dayLabel, removeItem, savePlan, setDay, siteBoard, updateItem, WEEKDAYS, type SiteBoard, type SiteDay, type SiteItem } from '../lib/visits';

const KINDS = ['Inspection', 'Meeting', 'Follow-up'] as const;
type Draft = { time: string; title: string; location: string; kind: (typeof KINDS)[number] };
const blank: Draft = { time: '', title: '', location: '', kind: 'Inspection' };
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86_400_000).toISOString().slice(0, 10);
const small = { fontSize: 12, color: 'var(--ink3)' } as const;

/**
 * Visits & planning: the Virtual Property Manager's weekly on-site visit. The regular slot, residents' requests
 * to have something looked at, and each visit day's agenda. Residents see the plan in the app's On-site visits screen.
 */
export function Visits() {
  const toast = useToast();
  const [board, setBoard] = useState<SiteBoard | null>(null);
  const [busy, setBusy] = useState(false);
  const [plan, setPlanDraft] = useState({ weekday: 5, start: '09:00', end: '12:00' });
  const [adding, setAdding] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(blank);
  const [answer, setAnswer] = useState<{ id: string; date: string; time: string; reply: string } | null>(null);

  const fail = useCallback((e: unknown) => toast(e instanceof ApiError ? e.message : 'Something went wrong', undefined, 'warn'), [toast]);
  const load = useCallback(() => siteBoard(28).then(b => { setBoard(b); if (b.plan) setPlanDraft(b.plan); }).catch(fail), [fail]);
  useEffect(() => { if (LIVE) void load(); }, [load]);

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try { await fn(); if (done) toast(done); await load(); } catch (e) { fail(e); } finally { setBusy(false); }
  };

  if (!LIVE) return <><PageHead title="Visits & planning" sub="The property manager’s weekly on-site visit" /><Empty icon={CalendarCheck} title="Available when connected" body="Visits are kept on the server, so this page works only in the connected console." /></>;

  // the server's IST day; nothing is drawn until the board has loaded
  const today = board?.today ?? '';
  const planned = (board?.days ?? []).filter(d => d.status === 'Planned');
  const upcoming = planned.filter(d => d.date >= today);
  const anyDay = today ? Array.from({ length: 21 }, (_, i) => addDays(today, i)) : [];
  /** the days a request can go on: a planned visit, or any day for a visit outside the schedule (a cancelled visit is never offered) */
  const offered = (r: SiteItem) => (r.extra ? anyDay : upcoming.map(d => d.date));

  const submitPlan = (e: FormEvent) => {
    e.preventDefault();
    if (plan.start >= plan.end) { toast('The visit has to end after it starts', undefined, 'warn'); return; }
    void run(() => savePlan(plan), `Regular visit: every ${WEEKDAYS[plan.weekday]}, ${clock(plan.start)} – ${clock(plan.end)}`);
  };
  const stopPlan = async () => {
    if (!(await confirmBox('Stop the regular weekly visit? Days already planned stay on the schedule.'))) return;
    void run(clearPlan, 'Regular visit stopped');
  };
  const submitItem = (d: SiteDay) => (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await addItem({ date: d.date, title: draft.title.trim(), location: draft.location.trim(), kind: draft.kind, ...(draft.time ? { time: draft.time } : {}) });
      setAdding(null); setDraft(blank);
    }, 'Added to the visit');
  };
  const schedule = (r: SiteItem) => {
    if (!answer) return;
    void run(async () => {
      await updateItem(r.id, { status: 'Scheduled', date: answer.date, ...(answer.time ? { time: answer.time } : {}), ...(answer.reply.trim() ? { reply: answer.reply.trim() } : {}) });
      setAnswer(null);
    }, 'Scheduled — the resident was told');
  };
  const decline = async (r: SiteItem) => {
    if (!(await confirmBox(`Decline “${r.title}”? ${r.resident?.name ?? 'The resident'} will be told.`))) return;
    void run(async () => { await updateItem(r.id, { status: 'Declined', ...(answer?.id === r.id && answer.reply.trim() ? { reply: answer.reply.trim() } : {}) }); setAnswer(null); }, 'Request declined');
  };
  const cancelDay = async (d: SiteDay) => {
    if (!(await confirmBox(`Cancel the visit on ${dayLabel(d.date)}? Residents with requests on it will be told.`))) return;
    void run(() => setDay(d.date, { status: 'Cancelled' }), 'Visit cancelled');
  };

  const items = (board?.days ?? []).flatMap(d => d.items);
  return (
    <>
      <PageHead title="Visits & planning" sub={board?.manager ? `${board.manager.name} (${board.manager.title}) visits on site once a week — residents see this plan in the app and can ask for something to be looked at` : 'The property manager’s weekly on-site visit — residents see this plan in the app'} />
      <div className="stats">
        <Stat label="Visits planned · 4 weeks" value={upcoming.length} icon={CalendarCheck} />
        <Stat label="Items on the agenda" value={items.filter(i => i.status === 'Scheduled').length} />
        <Stat label="Done" value={items.filter(i => i.status === 'Done').length} tone="good" />
        <Stat label="Resident requests waiting" value={board?.requests.length ?? 0} tone={board?.requests.length ? 'warn' : undefined} />
      </div>

      {board && !board.manager && (
        <div className="panel"><Empty icon={UserCircle} title="No property manager assigned" body="Trinize assigns a Virtual Property Manager to your society. You can still plan visits here." /></div>
      )}

      <div className="panel">
        <PanelHead icon={CalendarCheck} title="Regular visit" sub={board?.plan ? `Every ${WEEKDAYS[board.plan.weekday]}, ${clock(board.plan.start)} – ${clock(board.plan.end)} (IST)` : 'Not set — residents see no upcoming visit until you set one'} />
        <form className="form-grid" onSubmit={submitPlan}>
          <label>Day<select className="a-in" value={plan.weekday} onChange={e => setPlanDraft({ ...plan, weekday: Number(e.target.value) })}>{WEEKDAYS.map((w, i) => <option key={w} value={i}>{w}</option>)}</select></label>
          <label>From<input className="a-in" type="time" value={plan.start} onChange={e => setPlanDraft({ ...plan, start: e.target.value })} required /></label>
          <label>To<input className="a-in" type="time" value={plan.end} onChange={e => setPlanDraft({ ...plan, end: e.target.value })} required /></label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="a-btn" disabled={busy}><Check size={15} />Save</button>
            {board?.plan && <button type="button" className="a-btn ghost" disabled={busy} onClick={stopPlan}>Stop</button>}
          </div>
        </form>
      </div>

      {!!board?.requests.length && (
        <div className="panel">
          <PanelHead icon={UserCircle} title={`Residents’ requests (${board.requests.length})`} sub="Things residents asked the property manager to look at — schedule them on a visit, or decline" tone="warn" />
          <div className="a-tbl-wrap" style={{ boxShadow: 'none' }}>
            <table className="a-tbl">
              <thead><tr><th>Resident</th><th>Request</th><th>Wants</th><th>Asked</th><th /></tr></thead>
              <tbody>
                {board.requests.map(r => (
                  <tr key={r.id}>
                    <td><b style={{ color: 'var(--ink)', fontWeight: 600 }}>{r.resident?.name ?? 'Former resident'}</b><div style={small}>{r.resident?.unit ?? ''}</div></td>
                    <td style={{ whiteSpace: 'normal', maxWidth: 340 }}>
                      <b style={{ color: 'var(--ink)', fontWeight: 600 }}>{r.title}</b>{r.ref && <span style={small}> · {r.ref}</span>}
                      {r.note && r.note !== r.title && <div style={small}>“{r.note}”</div>}
                      {answer?.id === r.id && (
                        <div className="form-grid" style={{ marginTop: 10 }}>
                          <label>Visit day<select className="a-in" value={answer.date} onChange={e => setAnswer({ ...answer, date: e.target.value })}>
                            {offered(r).map(d => <option key={d} value={d}>{dayLabel(d)}</option>)}
                          </select></label>
                          <label>Time (optional)<input className="a-in" type="time" value={answer.time} onChange={e => setAnswer({ ...answer, time: e.target.value })} /></label>
                          <label className="full">Note to the resident (optional)<input className="a-in" value={answer.reply} maxLength={300} onChange={e => setAnswer({ ...answer, reply: e.target.value })} /></label>
                          <div style={{ display: 'flex', gap: 8 }}>
                            <button className="a-btn sm" disabled={busy || !answer.date} onClick={() => schedule(r)}><Check size={14} />Schedule</button>
                            <button className="a-btn ghost sm" onClick={() => setAnswer(null)}>Cancel</button>
                          </div>
                        </div>
                      )}
                    </td>
                    <td>{r.extra ? <Pill tone="warn">Visit outside schedule</Pill> : r.date ? dayLabel(r.date) : '—'}</td>
                    <td style={small}>{new Date(r.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      <IconBtn icon={CalendarCheck} label="Schedule" primary disabled={busy} onClick={() => { const days = offered(r); setAnswer({ id: r.id, date: r.date && days.includes(r.date) ? r.date : days[0] ?? '', time: r.time ?? '', reply: '' }); }} />
                      <IconBtn icon={X} label="Decline" tone="danger" disabled={busy} onClick={() => decline(r)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {board && !board.days.length && <div className="panel"><Empty icon={CalendarCheck} title="No visit days in the next four weeks" body="Set the regular visit above, and its days appear here." /></div>}
      {(board?.days ?? []).map(d => (
        <div key={d.date} className="panel">
          <PanelHead icon={d.status === 'Cancelled' ? CalendarX : CalendarCheck} tone={d.status === 'Cancelled' ? 'bad' : d.status === 'Done' ? 'good' : 'acc'}
            title={`${dayLabel(d.date)}${d.date === today ? ' · today' : ''}`}
            sub={`${clock(d.start)} – ${clock(d.end)}${d.note ? ' · ' + d.note : ''}`}
            right={<div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <Pill tone={d.status === 'Cancelled' ? 'bad' : d.status === 'Done' ? 'good' : 'acc'}>{d.status}</Pill>
              {d.status === 'Planned' && <button className="a-btn soft xs" onClick={() => { setAdding(d.date); setDraft(blank); }}><Plus size={13} />Add</button>}
              {d.status === 'Planned' && d.date <= today && <button className="a-btn ghost xs" disabled={busy} onClick={() => void run(() => setDay(d.date, { status: 'Done' }), 'Visit marked complete')}><CheckCircle size={13} />Complete</button>}
              {d.status === 'Planned'
                ? <button className="a-btn ghost xs" disabled={busy} onClick={() => cancelDay(d)}><CalendarX size={13} />Cancel</button>
                : <button className="a-btn ghost xs" disabled={busy} onClick={() => void run(() => setDay(d.date, { status: 'Planned', note: '' }), 'Visit restored')}><ArrowCounterClockwise size={13} />Restore</button>}
            </div>} />
          {adding === d.date && (
            <form className="form-grid" onSubmit={submitItem(d)} style={{ marginBottom: 14 }}>
              <label>Time (optional)<input className="a-in" type="time" value={draft.time} min={d.start} max={d.end} onChange={e => setDraft({ ...draft, time: e.target.value })} /></label>
              <label>Task<input className="a-in" value={draft.title} maxLength={120} required minLength={3} placeholder="e.g. Tower 1 water pressure check" onChange={e => setDraft({ ...draft, title: e.target.value })} autoFocus /></label>
              <label>Location<input className="a-in" value={draft.location} maxLength={120} placeholder="e.g. Tower 1" onChange={e => setDraft({ ...draft, location: e.target.value })} /></label>
              <label>Type<select className="a-in" value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value as Draft['kind'] })}>{KINDS.map(k => <option key={k}>{k}</option>)}</select></label>
              <div style={{ display: 'flex', gap: 8 }}><button className="a-btn" disabled={busy || draft.title.trim().length < 3}><Plus size={15} />Add</button><button type="button" className="a-btn ghost" onClick={() => setAdding(null)}>Cancel</button></div>
            </form>
          )}
          {d.items.length ? (
            <div className="a-tbl-wrap" style={{ boxShadow: 'none' }}>
              <table className="a-tbl compact">
                <thead><tr><th>Time</th><th>Task · location</th><th>Type</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {d.items.map(i => (
                    <tr key={i.id}>
                      <td className="num">{i.time ? clock(i.time) : '—'}</td>
                      <td style={{ whiteSpace: 'normal' }}>
                        <b style={{ color: 'var(--ink)', fontWeight: 600, textDecoration: i.status === 'Done' ? 'line-through' : 'none' }}>{i.title}</b>{i.ref && <span style={small}> · {i.ref}</span>}
                        <div style={small}>{[i.resident && `${i.resident.name}${i.resident.unit ? ' · ' + i.resident.unit : ''}`, i.location].filter(Boolean).join(' · ')}</div>
                      </td>
                      <td>{i.kind === 'Request' ? 'Resident request' : i.kind}</td>
                      <td><Pill tone={i.status === 'Done' ? 'good' : 'acc'}>{i.status}</Pill></td>
                      <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                        <IconBtn icon={i.status === 'Done' ? ArrowCounterClockwise : Check} label={i.status === 'Done' ? 'Not done' : 'Mark done'} tone={i.status === 'Done' ? undefined : 'good'} disabled={busy}
                          onClick={() => void run(() => updateItem(i.id, { status: i.status === 'Done' ? 'Scheduled' : 'Done' }))} />
                        <IconBtn icon={Trash} label="Remove" tone="danger" disabled={busy} onClick={async () => { if (await confirmBox(`Remove “${i.title}” from this visit?`)) void run(() => removeItem(i.id), 'Removed'); }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : adding !== d.date && <div className="d-none" style={small}>Nothing planned yet.</div>}
        </div>
      ))}
    </>
  );
}
