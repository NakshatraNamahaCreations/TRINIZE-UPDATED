import { ChatsCircle, CurrencyInr, Pause, Play, SealCheck } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { association } from '../lib/live';
import { decideEstimate, moveTo, recordInvoice, rupees, sendMessage, setEstimate, threads, vendorProgress, when, workOrder, type Msg, type WorkOrder } from '../lib/maintenance';
import { useStore } from '../store/context';
import { useToast } from './toast-context';
import { Pill } from './ui';

/**
 * The work-order side of a ticket (connected mode): what the repair will cost and whether that needs
 * approval, where the vendor is with it (recorded here — vendors don't use the app), the vendor's bill,
 * and the conversation with the resident.
 */
export function WorkOrderPanel({ issueRef }: { issueRef: string }) {
  const toast = useToast();
  const { actions } = useStore();
  const [wo, setWo] = useState<WorkOrder | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [amount, setAmount] = useState('');
  const [visit, setVisit] = useState('');
  const [bill, setBill] = useState('');
  const [billNote, setBillNote] = useState('');
  const [text, setText] = useState('');
  const [sug, setSug] = useState<{ category: string; priority: string; slaHours: number; vendor: { name: string; openJobs: number } | null; differs: boolean; by: 'ai' | 'rules' } | null>(null);

  const fail = useCallback((e: unknown) => toast(e instanceof ApiError ? e.message : 'That didn’t go through.', undefined, 'warn'), [toast]);
  const load = useCallback(() => {
    workOrder(issueRef).then(w => { setWo(w); setAmount(a => a || (w.costEstimate ? String(w.costEstimate) : '')); }).catch(fail);
    threads(issueRef).then(setMsgs).catch(() => {});
    // how the assistant reads this complaint: the trade, the urgency, and the least-loaded vendor for it
    api<NonNullable<typeof sug>>('GET', `/v1/admin/${association()}/issues/${issueRef}/suggestion`).then(setSug).catch(() => {});
  }, [issueRef, fail]);
  useEffect(load, [load]);

  if (!wo) return null;
  const closed = wo.status === 'Resolved' || wo.status === 'Closed';
  /** every change here also shows on the issues list behind the drawer */
  const apply = (work: Promise<WorkOrder>, done: string) => work.then(w => { setWo(w); toast(done); actions.refresh(); }).catch(fail);

  const saveEstimate = () => {
    const n = Number(amount);
    if (!amount || Number.isNaN(n)) { toast('Enter the estimated cost in rupees.', undefined, 'warn'); return; }
    void apply(setEstimate(issueRef, n), 'Estimate saved');
  };
  const send = () => {
    const v = text.trim();
    if (!v) return;
    setText('');
    sendMessage(issueRef, v).then(setMsgs).catch(e => { setText(v); fail(e); });
  };

  const vs = wo.vendorState ?? 'Assigned';
  const working = !!wo.vendor && (wo.status === 'Assigned' || wo.status === 'In Progress');
  const schedule = () => {
    if (!visit) { toast('Pick the visit date and time.', undefined, 'warn'); return; }
    void apply(vendorProgress(issueRef, 'Scheduled', { scheduledAt: new Date(visit).toISOString() }), 'Visit scheduled — resident told');
  };
  const saveBill = () => {
    const n = Number(bill);
    if (!n) { toast('Enter the bill amount.', undefined, 'warn'); return; }
    recordInvoice(issueRef, n, billNote.trim()).then(() => { setBill(''); setBillNote(''); toast('Bill recorded', 'Approve and pay it from Maintenance → Invoices.'); }).catch(fail);
  };

  return (
    <>
      <h3 className="d-h"><CurrencyInr size={17} />Work order</h3>
      {sug && !closed && !wo.vendor && (
        <div className="flow-note" style={{ marginBottom: 8 }}>
          <b>Assistant’s reading:</b> {sug.category} · {sug.priority} priority · respond within {sug.slaHours} hours.{' '}
          {sug.vendor ? <>Suggested vendor: <b>{sug.vendor.name}</b> ({sug.vendor.openJobs} open job{sug.vendor.openJobs === 1 ? '' : 's'}).</> : 'No vendor on file for this trade.'}
          {sug.differs && ' This differs from how the request was filed.'} <span style={{ opacity: 0.7 }}>({sug.by === 'ai' ? 'AI model' : 'built-in rules'})</span>
        </div>
      )}
      <div className="d-row"><span>Type</span><b>{wo.scope === 'common' ? 'Common area' + (wo.asset ? ' · ' + wo.asset : '') : 'Resident’s flat'}</b></div>
      {wo.vendor && <div className="d-row"><span>Vendor progress</span><b>{wo.vendorState ?? 'Assigned'}{wo.scheduledAt ? ' · visit ' + when(wo.scheduledAt) : ''}</b></div>}
      {wo.accessNote && <div className="d-row"><span>Entry instructions</span><b>{wo.accessNote}</b></div>}
      <div className="d-row">
        <span>Estimate</span>
        <b style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {wo.approval === 'pending' && <Pill tone="warn">Needs approval</Pill>}
          {wo.approval === 'approved' && <Pill tone="good">Approved</Pill>}
          {wo.approval === 'rejected' && <Pill tone="bad">Rejected</Pill>}
          {wo.costEstimate !== null ? rupees(wo.costEstimate) : 'Not set'}
        </b>
      </div>
      {wo.costActual !== null && <div className="d-row"><span>Actual cost (approved invoices)</span><b>{rupees(wo.costActual)}</b></div>}
      {wo.rating !== null && <div className="d-row"><span>Resident’s rating</span><b>{wo.rating} / 5</b></div>}

      {!closed && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <input className="a-in" style={{ flex: 1, minWidth: 140 }} inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value.replace(/[^\d]/g, ''))} placeholder="Estimated cost (₹)" aria-label="Estimated cost in rupees" />
          <button className="a-btn ghost" onClick={saveEstimate}>Save estimate</button>
        </div>
      )}
      {wo.approval === 'pending' && (
        <div className="d-actions">
          <button className="a-btn" onClick={() => apply(decideEstimate(issueRef, 'approved'), 'Estimate approved')}><SealCheck size={16} /> Approve estimate</button>
          <button className="a-btn ghost" onClick={() => apply(decideEstimate(issueRef, 'rejected'), 'Estimate rejected')}>Reject</button>
        </div>
      )}
      {working && (
        <div className="d-actions" style={{ alignItems: 'center' }}>
          {vs === 'Assigned' && <button className="a-btn" onClick={() => apply(vendorProgress(issueRef, 'Accepted'), 'Recorded — work started')}>Vendor confirmed the job</button>}
          {vs === 'Accepted' && <>
            <input className="a-in" type="datetime-local" value={visit} onChange={e => setVisit(e.target.value)} aria-label="Visit date and time" style={{ flex: 1, minWidth: 190 }} />
            <button className="a-btn" onClick={schedule} disabled={wo.approval === 'pending'}>Schedule visit</button>
          </>}
          {vs === 'Scheduled' && <button className="a-btn" onClick={() => apply(vendorProgress(issueRef, 'Visited'), 'Recorded')}>Vendor has visited</button>}
          {vs === 'Visited' && <button className="a-btn" onClick={() => apply(vendorProgress(issueRef, 'Completed'), 'Completed — resident asked to confirm')}>Work is completed</button>}
        </div>
      )}
      {!!wo.vendor && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
          <input className="a-in" style={{ width: 130 }} inputMode="numeric" value={bill} onChange={e => setBill(e.target.value.replace(/[^\d]/g, ''))} placeholder="Vendor’s bill (₹)" aria-label="Vendor’s bill in rupees" />
          <input className="a-in" style={{ flex: 1, minWidth: 140 }} value={billNote} onChange={e => setBillNote(e.target.value)} placeholder="What it covers" aria-label="What the bill covers" />
          <button className="a-btn ghost" onClick={saveBill}>Record bill</button>
        </div>
      )}
      {!closed && wo.status !== 'Submitted' && (
        <div className="d-actions">
          {wo.status === 'On Hold'
            ? <button className="a-btn ghost" onClick={() => apply(moveTo(issueRef, wo.vendor ? 'Assigned' : 'In Progress', 'Work resumed'), 'Work resumed')}><Play size={16} /> Resume work</button>
            : <button className="a-btn ghost" onClick={() => apply(moveTo(issueRef, 'On Hold', 'Put on hold'), 'Put on hold')}><Pause size={16} /> Put on hold</button>}
        </div>
      )}

      <h3 className="d-h"><ChatsCircle size={17} />Messages with the resident</h3>
      <div style={{ display: 'grid', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
        {!msgs.length && <div style={{ fontSize: 12.5, color: 'var(--ink3)' }}>No messages yet.</div>}
        {msgs.map(m => (
          <div key={m.id} style={{ justifySelf: m.from === 'staff' ? 'end' : 'start', maxWidth: '86%', background: m.from === 'staff' ? 'var(--acc)' : 'var(--wash, #F3F1FB)', color: m.from === 'staff' ? '#fff' : 'var(--ink)', borderRadius: 12, padding: '7px 11px', fontSize: 13 }}>
            {m.from !== 'staff' && <div style={{ fontSize: 11.5, fontWeight: 700, opacity: 0.8 }}>{m.by ?? 'Resident'}</div>}
            {m.text}
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <input className="a-in" style={{ flex: 1 }} value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') send(); }} placeholder="Message the resident…" aria-label="Message the resident" />
        <button className="a-btn" onClick={send}>Send</button>
      </div>
    </>
  );
}
