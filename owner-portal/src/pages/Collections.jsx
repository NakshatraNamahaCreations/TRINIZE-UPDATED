import { FilePlus2, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { BilledChart } from '../components/charts/Charts';
import { DataList } from '../components/DataList';
import { Ink, Kpi, PageHead, Pill } from '../components/ui';
import { chasePlan } from '../data/insights';
import { BILLED, findAssoc, fmtI, fmtL, INVOICES } from '../data/portal';
import { LIVE } from '../lib/api';
import { usePortal } from '../store/context';
import { RaiseInvoice } from './AccountActions';

const invTone = s => (s === 'Overdue' ? 'bad' : s === 'Part paid' ? 'warn' : 'sky');

/** Connected: money received against an invoice. */
function PaymentModal({ id }) {
  const { recordPayment, closeModal } = usePortal();
  const inv = INVOICES.find(x => x.id === id);
  const [amount, setAmount] = useState(inv ? String(inv.amt) : '');
  const [busy, setBusy] = useState(false);
  if (!inv) return null;
  const n = Number(amount), bad = !n || n > inv.amt;
  const save = async () => { setBusy(true); await recordPayment(id, n); setBusy(false); };
  return (
    <>
      <h2>Record a payment</h2>
      <div className="msub">{inv.id} · {findAssoc(inv.a).n}</div>
      <div className="kv"><span>Invoice total</span><b className="num">{fmtI(inv.total)}</b></div>
      <div className="kv"><span>Still outstanding</span><b className="num">{fmtI(inv.amt)}</b></div>
      <label className="fl" style={{ marginTop: 12 }}>Amount received (₹)
        <input className="in num" inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value.replace(/\D/g, ''))} autoFocus />
      </label>
      {n > inv.amt && <div className="f-err">Only {fmtI(inv.amt)} is outstanding on this invoice.</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <button className="btn" onClick={save} disabled={bad || busy}>{busy ? 'Saving…' : n === inv.amt ? 'Mark as paid in full' : 'Record part payment'}</button>
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
      </div>
    </>
  );
}

export function Collections() {
  const { go, toast, chase, copAsk, openModal } = usePortal();
  const inv = INVOICES.slice().sort((a, b) => a.days - b.days); // oldest debt first
  const overdue = inv.filter(i => i.days < 0);
  const upcoming = inv.filter(i => i.days >= 0);
  const oldest = overdue[0], month = BILLED[BILLED.length - 1];
  const plan = LIVE ? chasePlan() : [];

  return (
    <>
      <PageHead crumb="Run the business" title="Collections" icon="money_bag">
        Subscription dues owed to you, <b>oldest first</b>, with the one action each invoice needs. Recording a payment here updates the account, the dashboard and the activity feed together.
      </PageHead>

      <div className="kpis">
        <Kpi label="Overdue" value={fmtL(overdue.reduce((s, i) => s + i.amt, 0))} sub={overdue.length + ' invoices past their due date'} hint={'Access restricts automatically at 30 days past due.'} icon="money_with_wings" tone="bad" hot />
        <Kpi label="Issued, not yet due" value={fmtL(upcoming.reduce((s, i) => s + i.amt, 0))} sub={upcoming.length ? upcoming.length + ' invoice' + (upcoming.length === 1 ? '' : 's') + ' · ' + findAssoc(upcoming[upcoming.length - 1].a).n.split(' ').slice(0, 2).join(' ') + (upcoming.length > 1 ? ' and others' : '') : 'nothing waiting'} onClick={() => (upcoming.length ? go('a360', upcoming[upcoming.length - 1].a) : toast('Nothing issued', 'Every open invoice is already past its due date.'))} icon="outbox_tray" tone="sky" />
        <Kpi label="Oldest debt" value={oldest ? -oldest.days + (oldest.days === -1 ? ' day' : ' days') : '—'} sub={oldest ? findAssoc(oldest.a).n + ' · ' + oldest.state.toLowerCase() : 'nothing is overdue'} onClick={() => (oldest ? go('a360', oldest.a) : toast('Nothing overdue', 'No invoice is past its due date.'))} icon="stopwatch" tone="warn" />
        <Kpi label={'Collected · ' + (month ? month[0] : 'this month')} value={fmtL(month ? month[2] : 0)} sub={'against ' + fmtL(month ? month[1] : 0) + ' invoiced'} hint={LIVE ? 'What was invoiced this month, and how much of it has come in so far.' : 'August is dominated by the ₹11.6L Prestige renewal invoice, which is issued but not yet due.'} icon="check_mark_button" tone="good" />
      </div>

      <DataList
        rows={inv} rowKey={i => i.id} noun="invoice" minWidth={860}
        search={i => [i.id, findAssoc(i.a)?.n, i.state]} searchPlaceholder="Search by invoice number or association"
        defaultSort={{ key: 'due', dir: 'asc' }} emptyAll="No invoice is outstanding."
        actions={LIVE && <button className="btn sm" onClick={() => openModal(<RaiseInvoice />)}><FilePlus2 size={14} /> Raise invoice</button>}
        filters={[
          { key: 'state', label: 'State', get: i => i.state },
          { key: 'when', label: 'Due', get: i => (i.days < 0 ? 'Overdue' : i.days <= 30 ? 'Due within 30 days' : 'Due later'), options: ['Overdue', 'Due within 30 days', 'Due later'] },
          { key: 'assoc', label: 'Association', get: i => findAssoc(i.a)?.n },
        ]}
        csv={{ name: 'outstanding-invoices', head: ['Invoice', 'Association', 'Outstanding', 'Invoice total', 'Due', 'State', 'Reminders sent'], row: i => [i.id, findAssoc(i.a)?.n, i.amt, i.total ?? i.amt, i.due, i.state, i.chases ?? 0] }}
        columns={[
          { key: 'id', label: 'Invoice', sort: i => i.id, cell: i => <b className="num" style={{ color: 'var(--ink)' }}>{i.id}</b> },
          { key: 'assoc', label: 'Association', sort: i => findAssoc(i.a)?.n ?? '', stop: true, cell: i => { const a = findAssoc(i.a); return a ? <button onClick={() => go('a360', a.id)} style={{ color: 'var(--acc-ink)', fontWeight: 700, textAlign: 'left' }}>{a.n}</button> : '—'; } },
          { key: 'amt', label: 'Outstanding', right: true, dir: 'desc', sort: i => i.amt, cell: i => <><b className="num" style={{ color: 'var(--ink)' }}>{fmtI(i.amt)}</b>{i.total && i.total !== i.amt ? <i className="a-sub">of {fmtI(i.total)}</i> : null}</> },
          { key: 'due', label: 'Due', sort: i => i.days, cell: i => <span style={i.days < 0 ? { color: 'var(--bad)', fontWeight: 600 } : undefined}>{i.due}</span> },
          { key: 'state', label: 'State', sort: i => i.state, cell: i => <Pill tone={invTone(i.state)}>{i.state}</Pill> },
          { key: 'act', label: 'Actions', right: true, stop: true, cell: i => (
            <div className="row-acts">
              {i.days < 0 && <button className="btn sm soft" onClick={() => chase(i.id)}>Send reminder{i.chases ? ' · ' + i.chases + ' sent' : ''}</button>}
              {LIVE ? <button className="btn sm" onClick={() => openModal(<PaymentModal id={i.id} />)}>Record payment</button>
                : i.days >= 0 && <button className="btn sm ghost" onClick={() => toast('Invoice opened', i.id + ' · ' + fmtI(i.amt), 'page_facing_up')}>View</button>}
            </div>
          ) },
        ]}
      />

      <div className="grid2" style={{ marginTop: 14 }}>
          <div className="panel">
            <h3>Billed against banked</h3>
            <div className="p-sub">What was invoiced each month, and how much of it came in</div>
            <div className="leg">
              <span><i style={{ background: 'var(--s1)' }} />Invoiced</span>
              <span><i style={{ background: 'var(--s2)' }} />Collected</span>
            </div>
            <div className="chart-box"><BilledChart /></div>
          </div>

        <div className="panel">
          <h3>Chase plan</h3>
          <div className="p-sub">Drafted from the invoice ages and account health</div>
          {LIVE && (plan.length ? plan.map((r, i) => (
            <div key={r.name} style={{ fontSize: 12.5, color: 'var(--ink2)', marginTop: i ? 10 : 0 }}><Ink>{r.name}</Ink> — {r.text}</div>
          )) : <div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>Nothing is overdue, so there is nobody to chase.</div>)}
          {!LIVE && <><div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>
            <Ink>Green Meadows Villas</Ink> — two invoices, 36 and 5 days late, totalling ₹2,016. Access restricts in 15 days. Their adoption is also sliding, so send the payment link <i>and</i> the onboarding help in one message rather than a bare reminder.
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--ink2)', marginTop: 10 }}>
            <Ink>Mytri Apartments</Ink> — ₹9,000 part paid for 80 days on an otherwise healthy account. Almost always a missing PO reference, not a refusal. One call to Sudhakar Rao clears it.
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--ink2)', marginTop: 10 }}>
            <Ink>Silver Oak Enclave</Ink> — ₹1,152 outstanding on a suspended account. This is a win-back, not a chase; leading with the invoice will lose it.
          </div></>}
          <button className="btn ai sm" style={{ marginTop: 12 }} onClick={() => copAsk(LIVE ? 'Draft a payment reminder' : 'Draft the Green Meadows reminder')}><Sparkles size={14} /> Draft the reminders</button>
        </div>
      </div>
    </>
  );
}
