import { Sparkles } from 'lucide-react';
import { Icon3D } from '../components/Icon3D';
import { BilledChart } from '../components/charts/Charts';
import { Ink, Kpi, PageHead, Pill } from '../components/ui';
import { findAssoc, fmtI, fmtL, INVOICES } from '../data/portal';
import { usePortal } from '../store/context';

const invTone = s => (s === 'Overdue' ? 'bad' : s === 'Part paid' ? 'warn' : 'sky');

export function Collections() {
  const { go, toast, chase, copAsk } = usePortal();
  const inv = INVOICES.slice().sort((a, b) => a.days - b.days); // oldest debt first
  const overdue = inv.filter(i => i.days < 0);
  const upcoming = inv.filter(i => i.days > 0);

  return (
    <>
      <PageHead crumb="Run the business" title="Collections" icon="money_bag">
        Subscription dues owed to you, <b>oldest first</b>, with the one action each invoice needs. Recording a payment here updates the account, the dashboard and the activity feed together.
      </PageHead>

      <div className="kpis">
        <Kpi label="Overdue" value={fmtL(overdue.reduce((s, i) => s + i.amt, 0))} sub={overdue.length + ' invoices past their due date'} onClick={() => toast('Overdue', 'Access restricts automatically at 30 days past due.')} icon="money_with_wings" tone="bad" hot />
        <Kpi label="Issued, not yet due" value={fmtL(upcoming.reduce((s, i) => s + i.amt, 0))} sub="1 invoice · the Prestige renewal" onClick={() => go('a360', 'asn-2')} icon="outbox_tray" tone="sky" />
        <Kpi label="Oldest debt" value="80 days" sub="Mytri Apartments · part paid" onClick={() => go('a360', 'asn-1')} icon="stopwatch" tone="warn" />
        <Kpi label="Collected in Aug" value={fmtL(120000)} sub={'against ' + fmtL(1298000) + ' invoiced'} onClick={() => toast('Collection rate', 'August is dominated by the ₹11.6L Prestige renewal invoice, which is issued but not yet due.')} icon="check_mark_button" tone="good" />
      </div>

      <div className="grid2">
        <div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Invoice</th><th>Association</th><th>Amount</th><th>Due</th><th>State</th><th /></tr></thead>
              <tbody>
                {inv.map(i => {
                  const a = findAssoc(i.a);
                  return (
                    <tr key={i.id}>
                      <td><b className="num" style={{ color: 'var(--ink)' }}>{i.id}</b></td>
                      <td><button onClick={() => go('a360', a.id)} style={{ color: 'var(--sky-ink)', fontWeight: 700 }}>{a.n}</button></td>
                      <td className="num" style={{ color: 'var(--ink)', fontWeight: 700 }}>{fmtI(i.amt)}</td>
                      <td>{i.due}</td>
                      <td><Pill tone={invTone(i.state)}>{i.state}</Pill></td>
                      <td>
                        {i.days < 0
                          ? <button className="btn sm soft" onClick={() => chase(i.id)}>Chase</button>
                          : <button className="btn sm ghost" onClick={() => toast('Invoice opened', i.id + ' · ' + fmtI(i.amt), 'page_facing_up')}>View</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="panel" style={{ marginTop: 14 }}>
            <h3>Billed against banked</h3>
            <div className="p-sub">What was invoiced each month, and how much of it came in</div>
            <div className="leg">
              <span><i style={{ background: 'var(--s1)' }} />Invoiced</span>
              <span><i style={{ background: 'var(--s2)' }} />Collected</span>
            </div>
            <div style={{ minHeight: 170 }}><BilledChart /></div>
          </div>
        </div>

        <div className="panel">
          <h3><Icon3D name="sparkles" size={20} /> Copilot · chase plan</h3>
          <div className="p-sub">Drafted from the invoice ages and account health</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>
            <Ink>Green Meadows Villas</Ink> — two invoices, 36 and 5 days late, totalling ₹2,016. Access restricts in 15 days. Their adoption is also sliding, so send the payment link <i>and</i> the onboarding help in one message rather than a bare reminder.
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--ink2)', marginTop: 10 }}>
            <Ink>Mytri Apartments</Ink> — ₹9,000 part paid for 80 days on an otherwise healthy account. Almost always a missing PO reference, not a refusal. One call to Sudhakar Rao clears it.
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--ink2)', marginTop: 10 }}>
            <Ink>Silver Oak Enclave</Ink> — ₹1,152 outstanding on a suspended account. This is a win-back, not a chase; leading with the invoice will lose it.
          </div>
          <button className="btn ai sm" style={{ marginTop: 12 }} onClick={() => copAsk('Draft the Green Meadows reminder')}><Sparkles size={14} /> Draft the reminders</button>
        </div>
      </div>
    </>
  );
}
