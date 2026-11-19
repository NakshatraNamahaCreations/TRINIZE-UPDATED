import { confirmBox, formBox, promptBox } from '../lib/dialog';
import { ArrowRight, Bank, CurrencyInr, Receipt, Scales, TrendDown, TrendUp, WarningCircle, ArrowUUpLeft, Check, CheckCircle, EyeSlash, Lock, LockOpen, Notebook, PencilSimple, Percent, Ruler, X, XCircle } from '@phosphor-icons/react';
import { TableCard } from '../components/TableCard';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useToast } from '../components/toast-context';
import { Empty, PageHead, Pill, Stat, IconBtn } from '../components/ui';
import { ApiError, LIVE } from '../lib/api';
import * as fin from '../lib/finance';
import { CHARGE_TYPES, inDays, PAYMENT_MODES, REPORTS, rupees, thisMonth } from '../lib/finance';

type Tab = 'overview' | 'billing' | 'payments' | 'flats' | 'expenses' | 'bank' | 'reports' | 'setup';
type P = { fail: (e: unknown) => void; done: (msg: string, sub?: string) => void; version: number; bump: () => void; /** open another tab of this page */ go: (tab: Tab) => void };
const grid = { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', alignItems: 'end' } as const;
const small = { fontSize: 12, color: 'var(--ink3)' } as const;
const BILL_TONE: Record<string, 'good' | 'warn' | 'bad' | 'acc' | 'dim'> = { Unpaid: 'acc', 'Part paid': 'warn', Overdue: 'bad', Paid: 'good', Waived: 'dim', Cancelled: 'dim' };
const EXP_TONE = { 'Pending approval': 'warn', Approved: 'acc', Paid: 'good', Rejected: 'dim' } as const;
const num = (s: string) => Number(s.replace(/[^\d]/g, '')) || 0;
const ask = async (q: string) => (await promptBox(q))?.trim() || null;

/* ------------------------------------------------------------ overview */
function Overview({ fail, version, go }: P) {
  const [d, setD] = useState<fin.Dashboard | null>(null);
  useEffect(() => { fin.dashboard().then(setD).catch(fail); }, [fail, version]);
  if (!d) return null;
  const list = (title: string, rows: { name: string; amount: number }[], none: string) => (
    <div className="card"><b>{title} · {d.month}</b>
      <table className="a-tbl compact" style={{ marginTop: 8 }}><tbody>
        {rows.map(r => <tr key={r.name}><td>{r.name}</td><td className="num" style={{ textAlign: 'right' }}>{rupees(r.amount)}</td></tr>)}
        {rows.length > 0 && <tr><td><b>Total</b></td><td className="num" style={{ textAlign: 'right' }}><b>{rupees(rows.reduce((n, r) => n + r.amount, 0))}</b></td></tr>}
        {!rows.length && <tr><td style={small}>{none}</td></tr>}
      </tbody></table>
    </div>
  );
  const top = Math.max(1, ...d.cashFlow.flatMap(m => [m.money_in, m.money_out]));
  const earned = d.income.reduce((n, r) => n + r.amount, 0), spent = d.expenses.reduce((n, r) => n + r.amount, 0), surplus = earned - spent;
  const rate = d.billedThisMonth ? Math.min(100, Math.round(d.paidOfBilled / d.billedThisMonth * 100)) : 0;
  // nothing has ever happened in the books: say what to do first instead of showing a wall of zeros
  const untouched = !d.billsThisMonth && !d.recentPayments.length && !d.pendingDues && !d.bank && !d.cash && !d.cashFlow.length;
  const more = (label: string, tab: Tab) => <button className="a-btn ghost sm" style={{ marginTop: 10 }} onClick={() => go(tab)}>{label}<ArrowRight size={13} /></button>;
  const steps: [string, string, string, Tab][] = [
    ['Check each flat’s area and type', 'Bills are worked out from them. Enter any dues carried over from before as an opening balance.', 'Flats & ledgers', 'flats'],
    ['Set the rules', 'Late fee, part payments, and the UPI ID or bank details residents pay to.', 'Setup', 'setup'],
    ['Generate this month’s bills', 'By area, by flat type, or the same amount for every flat. Residents are told in the app.', 'Billing', 'billing'],
    ['Record payments as they come in', 'Each one gives a receipt and settles the oldest bill first.', 'Payments', 'payments'],
  ];
  return (
    <>
      <div className="stats">
        <Stat icon={TrendUp} label={`Collected in ${d.month}`} value={rupees(d.collected)} tone="good" />
        <Stat icon={CurrencyInr} label={`Pending dues · ${d.flatsWithDues} flats`} value={rupees(d.pendingDues)} tone={d.pendingDues ? 'warn' : undefined} />
        <Stat icon={WarningCircle} label={`Overdue · ${d.overdueBills} bills`} value={rupees(d.overdue)} tone={d.overdue ? 'bad' : undefined} />
        <Stat icon={Bank} label="Bank balance (books)" value={rupees(d.bank)} />
        <Stat icon={CurrencyInr} label="Cash in hand" value={rupees(d.cash)} />
        <Stat icon={surplus < 0 ? TrendDown : TrendUp} label={`${surplus < 0 ? 'Deficit' : 'Surplus'} in ${d.month}`} value={rupees(Math.abs(surplus))} tone={surplus < 0 ? 'bad' : surplus > 0 ? 'good' : undefined} />
        <Stat icon={Scales} label="Bank lines unmatched" value={d.reconciliation.unmatched} tone={d.reconciliation.unmatched ? 'warn' : undefined} />
      </div>
      {untouched && (
        <div className="card" style={{ marginBottom: 14 }}>
          <b>Start the society’s books</b><div style={small}>Four steps, in this order. Each opens the part of this page that does it.</div>
          <div className="setup-steps" style={{ marginTop: 12 }}>
            {steps.map(([title, body, , tab], i) => (
              <button key={tab} className="setup-step" onClick={() => go(tab)}>
                <span className="n">{i + 1}</span><span className="t"><b>{title}</b><span>{body}</span></span><ArrowRight size={15} />
              </button>
            ))}
          </div>
        </div>
      )}
      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', marginBottom: 14 }}>
        <div className="card"><b>Collection · {d.month}</b>
          {d.billsThisMonth ? (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 10 }}><span style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-.03em' }} className="num">{rate}%</span><span style={small}>of this month’s bills collected</span></div>
              <div className="prog" style={{ marginTop: 8 }}><i style={{ width: rate + '%', background: rate >= 80 ? 'var(--good)' : rate >= 40 ? 'var(--s2)' : 'var(--bad)' }} /></div>
              <table className="a-tbl compact" style={{ marginTop: 10 }}><tbody>
                <tr><td>Billed · {d.billsThisMonth} bills</td><td className="num" style={{ textAlign: 'right' }}>{rupees(d.billedThisMonth)}</td></tr>
                <tr><td>Collected against them</td><td className="num" style={{ textAlign: 'right' }}>{rupees(d.paidOfBilled)}</td></tr>
                <tr><td><b>Still to come</b></td><td className="num" style={{ textAlign: 'right' }}><b>{rupees(Math.max(0, d.billedThisMonth - d.paidOfBilled))}</b></td></tr>
              </tbody></table>
            </>
          ) : <div style={{ ...small, marginTop: 8 }}>No bills have been generated for {d.month} yet{d.flats ? ` · ${d.flats} flats to bill` : ''}.</div>}
          {more(d.billsThisMonth ? 'Open billing' : 'Generate this month’s bills', 'billing')}
        </div>
        <div className="card"><b>Flats that owe the most</b>
          <table className="a-tbl compact" style={{ marginTop: 8 }}><tbody>
            {d.topDues.map(t => <tr key={t.unitId}><td className="num">{t.unit}</td><td className="num" style={{ textAlign: 'right' }}><b style={{ color: 'var(--bad)' }}>{rupees(t.amount)}</b></td></tr>)}
            {!d.topDues.length && <tr><td style={small}>No flat owes anything.</td></tr>}
          </tbody></table>
          {d.flatsWithDues > d.topDues.length && <div style={{ ...small, marginTop: 6 }}>and {d.flatsWithDues - d.topDues.length} more</div>}
          {more('Open ledgers', 'flats')}
        </div>
        <div className="card"><b>Latest payments</b>
          <table className="a-tbl compact" style={{ marginTop: 8 }}><tbody>
            {d.recentPayments.map(p => <tr key={p.id}><td><span className="num">{p.unit}</span><div style={small}>{p.number} · {p.mode} · {p.receivedOn}</div></td><td className="num" style={{ textAlign: 'right' }}><b>{rupees(p.amount)}</b></td></tr>)}
            {!d.recentPayments.length && <tr><td style={small}>No payment has been recorded yet.</td></tr>}
          </tbody></table>
          {more('Record a payment', 'payments')}
        </div>
      </div>
      <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        {list('Income', d.income, 'Nothing billed yet this month.')}
        {list('Expenses', d.expenses, 'No expenses booked this month.')}
        <div className="card"><b>Money in and out</b><div style={small}>Bank and cash, last six months</div>
          <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
            {d.cashFlow.map(m => (
              <div key={m.month} style={{ fontSize: 12.5 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>{m.month}</span><span className="num">{rupees(m.money_in)} in · {rupees(m.money_out)} out</span></div>
                <div style={{ height: 6, background: 'var(--good)', width: `${m.money_in / top * 100}%`, borderRadius: 3, marginTop: 3, minWidth: m.money_in ? 2 : 0 }} />
                <div style={{ height: 6, background: 'var(--bad)', width: `${m.money_out / top * 100}%`, borderRadius: 3, marginTop: 2, minWidth: m.money_out ? 2 : 0 }} />
              </div>
            ))}
            {!d.cashFlow.length && <div style={small}>No money has moved yet.</div>}
          </div>
        </div>
        <div className="card"><b>Waiting for you</b>
          <table className="a-tbl compact" style={{ marginTop: 8 }}><tbody>
            <tr className={d.toApprove.n ? 'rowbtn' : undefined} onClick={() => d.toApprove.n && go('expenses')}><td>Expenses to approve</td><td className="num" style={{ textAlign: 'right' }}>{d.toApprove.n} · {rupees(d.toApprove.amount)}</td></tr>
            <tr className={d.toPay.n ? 'rowbtn' : undefined} onClick={() => d.toPay.n && go('expenses')}><td>Approved bills to pay</td><td className="num" style={{ textAlign: 'right' }}>{d.toPay.n} · {rupees(d.toPay.amount)}</td></tr>
            <tr className={d.reconciliation.unmatched ? 'rowbtn' : undefined} onClick={() => d.reconciliation.unmatched && go('bank')}><td>Bank lines to match</td><td className="num" style={{ textAlign: 'right' }}>{d.reconciliation.unmatched}</td></tr>
            <tr><td>Advances held for flats</td><td className="num" style={{ textAlign: 'right' }}>{rupees(d.advances)}</td></tr>
            <tr><td>Bank lines matched</td><td className="num" style={{ textAlign: 'right' }}>{d.reconciliation.matched}</td></tr>
          </tbody></table>
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------ billing */
function Billing({ fail, done, version, bump }: P) {
  const [run, setRun] = useState<fin.Run>({ period: thisMonth(), chargeType: 'Monthly maintenance', method: 'sqft', dueDate: inDays(10), rate: 3 });
  const [types, setTypes] = useState<Record<string, string>>({});
  const [flatTypes, setFlatTypes] = useState<string[]>([]);
  const [pre, setPre] = useState<fin.Preview | null>(null);
  const [tell, setTell] = useState(true);
  const [list, setList] = useState<fin.Bill[]>([]);
  const [status, setStatus] = useState('Open');
  const [flats, setFlats] = useState<fin.Flat[]>([]);
  const [one, setOne] = useState({ unitId: '', chargeType: 'Penalty', amount: '', dueDate: inDays(10), description: '' });
  useEffect(() => { fin.flats().then(f => { setFlats(f); setFlatTypes([...new Set(f.map(x => x.flatType).filter(Boolean))].sort()); }).catch(fail); }, [fail]);
  useEffect(() => { fin.bills({ status }).then(setList).catch(fail); }, [fail, status, version]);

  const body = (): fin.Run => ({ ...run, byType: run.method === 'type' ? Object.fromEntries(Object.entries(types).map(([k, v]) => [k, num(v)]).filter(([, v]) => v)) : undefined,
    amount: run.method === 'flat' ? run.amount : undefined, rate: run.method === 'sqft' ? run.rate : undefined });
  const look = () => fin.preview(body()).then(setPre).catch(fail);
  const generate = async () => {
    if (!pre?.bills || !(await confirmBox(`Generate ${pre.bills} bills totalling ${rupees(pre.total)} for ${run.period}?`))) return;
    fin.runBills({ ...body(), tell }).then(r => { done(`${r.bills} bills generated · ${rupees(r.total)}`, tell ? `${r.residentsTold} residents told${r.skipped.length ? ` · ${r.skipped.length} flats skipped` : ''}` : undefined); setPre(null); bump(); }).catch(fail);
  };
  const act = (p: Promise<unknown>, msg: string) => p.then(() => { done(msg); bump(); }).catch(fail);
  const billFlat = (e: FormEvent) => {
    e.preventDefault();
    const amount = num(one.amount), flat = flats.find(f => f.id === one.unitId);
    if (!flat || !amount) { fail(new ApiError(400, 'x', 'Choose the flat and enter the amount.')); return; }
    fin.billOne({ unitId: one.unitId, chargeType: one.chargeType, amount, dueDate: one.dueDate, description: one.description.trim() || undefined })
      .then(() => { done(`${flat.code} billed ${rupees(amount)}`, one.chargeType); setOne({ ...one, unitId: '', amount: '', description: '' }); bump(); }).catch(fail);
  };

  return (
    <>
      <div className="card">
        <b>Generate bills</b>
        <div style={{ ...grid, marginTop: 8 }}>
          <label>Billing month<input className="a-in" type="month" value={run.period} onChange={e => { setRun({ ...run, period: e.target.value }); setPre(null); }} /></label>
          <label>Charge<select className="a-in" value={run.chargeType} onChange={e => { setRun({ ...run, chargeType: e.target.value }); setPre(null); }}>{CHARGE_TYPES.map(c => <option key={c}>{c}</option>)}</select></label>
          <label>How it is worked out<select className="a-in" value={run.method} onChange={e => { setRun({ ...run, method: e.target.value as fin.Run['method'] }); setPre(null); }}>
            <option value="sqft">By area (₹ per sq ft)</option><option value="type">By flat type</option><option value="flat">Same amount for every flat</option>
          </select></label>
          {run.method === 'sqft' && <label>Rate per sq ft (₹)<input className="a-in" inputMode="decimal" value={run.rate ?? ''} onChange={e => { setRun({ ...run, rate: Number(e.target.value) || 0 }); setPre(null); }} /></label>}
          {run.method === 'flat' && <label>Amount per flat (₹)<input className="a-in" inputMode="numeric" value={run.amount ?? ''} onChange={e => { setRun({ ...run, amount: num(e.target.value) }); setPre(null); }} /></label>}
          {run.method === 'type' && flatTypes.map(t => <label key={t}>{t} (₹)<input className="a-in" inputMode="numeric" value={types[t] ?? ''} onChange={e => { setTypes({ ...types, [t]: e.target.value }); setPre(null); }} /></label>)}
          <label>Due date<input className="a-in" type="date" value={run.dueDate} onChange={e => setRun({ ...run, dueDate: e.target.value })} /></label>
          <button className="a-btn ghost" type="button" onClick={look}>Preview</button>
        </div>
        {run.method === 'type' && !flatTypes.length && <div style={{ ...small, marginTop: 8 }}>No flat has a type on record yet. Set them under Flats & ledgers.</div>}
        {pre && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 13.5 }}><b>{pre.bills}</b> bills · <b>{rupees(pre.total)}</b>{pre.rows.some(r => r.skip) && <span style={small}> · {pre.rows.filter(r => r.skip).length} flats left out</span>}</div>
            <div className="a-tbl-wrap" style={{ maxHeight: 240, overflowY: 'auto', marginTop: 8 }}>
              <table className="a-tbl compact"><tbody>
                <tr><th>Flat</th><th>Area</th><th>Type</th><th>Amount</th></tr>
                {pre.rows.map(r => <tr key={r.unitId} style={r.skip ? { opacity: 0.6 } : undefined}><td>{r.unit}</td><td className="num">{r.area || '—'}</td><td>{r.flatType || '—'}</td><td className="num">{r.skip ? <span style={small}>{r.skip}</span> : rupees(r.amount)}</td></tr>)}
              </tbody></table>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
              <button className="a-btn" type="button" onClick={generate} disabled={!pre.bills}>Generate {pre.bills} bills</button>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={tell} onChange={e => setTell(e.target.checked)} /> Tell the residents</label>
            </div>
          </div>
        )}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <b>Bill one flat</b><div style={small}>A one-off charge on a single flat — a penalty, a repair contribution, a move-in fee. It joins that flat’s dues like any other bill.</div>
        <form onSubmit={billFlat} style={{ ...grid, marginTop: 8 }}>
          <label>Flat<select className="a-in" value={one.unitId} onChange={e => setOne({ ...one, unitId: e.target.value })}><option value="">Choose…</option>{flats.map(f => <option key={f.id} value={f.id}>{f.code}{f.owner ? ' · ' + f.owner : ''}</option>)}</select></label>
          <label>Charge<select className="a-in" value={one.chargeType} onChange={e => setOne({ ...one, chargeType: e.target.value })}>{CHARGE_TYPES.map(c => <option key={c}>{c}</option>)}</select></label>
          <label>Amount (₹)<input className="a-in" inputMode="numeric" value={one.amount} onChange={e => setOne({ ...one, amount: e.target.value })} /></label>
          <label>Due date<input className="a-in" type="date" value={one.dueDate} onChange={e => setOne({ ...one, dueDate: e.target.value })} /></label>
          <label style={{ gridColumn: '1 / -1' }}>What it is for <span style={small}>(shown on the bill)</span><input className="a-in" maxLength={120} value={one.description} onChange={e => setOne({ ...one, description: e.target.value })} placeholder="e.g. Parking in a visitor slot, 14 Nov" /></label>
          <button className="a-btn ghost" type="submit">Bill this flat</button>
        </form>
      </div>

      <div className="toolbar" style={{ marginTop: 14, gap: 6 }}>
        {['Open', 'Overdue', 'Paid', 'Cancelled'].map(s => <button key={s} className={'a-btn' + (status === s ? '' : ' ghost')} onClick={() => setStatus(s)}>{s === 'Open' ? 'Unpaid bills' : s}</button>)}
        <span style={{ flex: 1 }} />
        <button className="a-btn ghost" onClick={() => fin.lateFees().then(r => { done(r.charged ? `Late fee charged on ${r.charged} bills` : 'No bill is past its grace period', r.charged ? rupees(r.total) : undefined); bump(); }).catch(fail)}>Charge late fees</button>
        <button className="a-btn ghost" onClick={() => fin.remind().then(r => done(r.flats ? `Reminder sent to ${r.flats} flats` : 'Nothing is overdue', r.flats ? `${r.residents} residents` : undefined)).catch(fail)}>Remind overdue flats</button>
      </div>
      {list.length ? (
        <TableCard rows={list} noun="bill" search={b => [b.number, b.unit, b.chargeType, b.description, b.period]} placeholder="Search by bill number, flat or charge"
          filters={[{ key: 'status', label: 'Status', get: b => b.status }, { key: 'charge', label: 'Charge', get: b => b.chargeType }, { key: 'period', label: 'Month', get: b => b.period }]}
          sorts={[{ label: 'Largest due', by: b => b.due, dir: 'desc' }, { label: 'Earliest due date', by: b => b.dueDate }, { label: 'Flat', by: b => b.unit ?? '' }]}
          csv={{ name: 'bills', head: ['Bill', 'Flat', 'Charge', 'Month', 'Amount', 'Paid', 'Waived', 'Due', 'Due date', 'Status'], row: b => [b.number, b.unit ?? '', b.chargeType, b.period, b.amount, b.paid, b.waived, b.due, b.dueDate, b.status] }}>{(page, sl) => (<div className="a-tbl-wrap"><table className="a-tbl"><tbody>
          <tr><th className="sl">Sl. no.</th><th>Bill</th><th>Flat</th><th>Charge</th><th>Amount</th><th>Due</th><th>Due date</th><th>Status</th><th /></tr>
          {page.map((b, rowNo) => (
            <tr key={b.id}><td className="sl num">{sl(rowNo)}</td>
              <td><span className="cell-t num">{b.number}</span>{b.description && <div style={small}>{b.description}</div>}</td>
              <td data-l="Flat">{b.unit}</td><td data-l="Charge">{b.chargeType}<div style={small}>{b.period}</div></td>
              <td data-l="Amount" className="num">{rupees(b.amount)}{b.waived > 0 && <div style={small}>{rupees(b.waived)} waived</div>}</td>
              <td data-l="Due" className="num"><b>{rupees(b.due)}</b></td><td data-l="Due date" className="num">{b.dueDate}</td>
              <td data-l="Status"><Pill tone={BILL_TONE[b.status] ?? 'dim'}>{b.status}</Pill></td>
              <td>{b.due > 0 && <div style={{ display: 'flex', gap: 6 }}>
                <IconBtn icon={Percent} label="Waive" onClick={async () => { const v = await formBox({ title: `Waive part of ${b.number}`, body: `${rupees(b.due)} is still due on this bill.`, confirm: 'Record waiver', fields: [{ key: 'amount', label: 'Amount to waive (₹)', type: 'number', value: String(b.due), required: true }, { key: 'reason', label: 'Why', hint: 'Kept on record.', type: 'textarea', required: true }] }); const a = num(v?.amount ?? ''); if (v && a) void act(fin.waive(b.id, a, v.reason!.trim()), 'Waiver recorded'); }} />
                {b.paid === 0 && <IconBtn icon={XCircle} label="Cancel" tone="danger" onClick={async () => { const r = (await ask(`Cancel ${b.number}? Give the reason.`)); if (r) void act(fin.cancelBill(b.id, r), 'Bill cancelled'); }} />}
              </div>}</td>
            </tr>
          ))}
        </tbody></table></div>)}</TableCard>
      ) : <Empty icon={Receipt} title="No bills here" body="Generate the month’s bills above, or change the filter." />}
    </>
  );
}

/* ------------------------------------------------------------ payments */
function ReceiptView({ r, onClose }: { r: fin.Receipt; onClose: () => void }) {
  return (
    <div className="card receipt" style={{ marginTop: 14, maxWidth: 520 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><div><b style={{ fontSize: 16 }}>{r.society}</b><div style={small}>Payment receipt</div></div><div style={{ textAlign: 'right' }}><b className="num">{r.number}</b><div style={small}>{r.receivedOn}</div></div></div>
      {r.reversed && <div style={{ color: 'var(--bad)', fontWeight: 700, marginTop: 8 }}>REVERSED — {r.reverseReason}</div>}
      <table className="a-tbl compact" style={{ marginTop: 10 }}><tbody>
        <tr><td>Received from</td><td style={{ textAlign: 'right' }}>{r.payerName || '—'} · {r.unit}</td></tr>
        <tr><td>Amount</td><td className="num" style={{ textAlign: 'right' }}><b>{rupees(r.amount)}</b></td></tr>
        <tr><td>Mode</td><td style={{ textAlign: 'right' }}>{r.mode}{r.reference ? ' · ' + r.reference : ''}{r.chequeNo ? ` · cheque ${r.chequeNo} (${r.chequeStatus})` : ''}</td></tr>
        {r.settled.map(s => <tr key={s.number}><td>{s.chargeType} · {s.period} <span style={small}>{s.number}</span></td><td className="num" style={{ textAlign: 'right' }}>{rupees(s.amount)}</td></tr>)}
        {r.advance > 0 && <tr><td>Kept as advance</td><td className="num" style={{ textAlign: 'right' }}>{rupees(r.advance)}</td></tr>}
      </tbody></table>
      <div style={{ ...small, marginTop: 8 }}>Recorded by {r.byName || 'the resident, in the app'} · deposited to {r.depositedTo}</div>
      <div className="no-print" style={{ display: 'flex', gap: 6, marginTop: 10 }}><button className="a-btn ghost" onClick={() => window.print()}>Print</button><button className="a-btn ghost" onClick={onClose}>Close</button></div>
    </div>
  );
}

function Payments({ fail, done, version, bump }: P) {
  const [flats, setFlats] = useState<fin.Flat[]>([]);
  const [list, setList] = useState<fin.Payment[]>([]);
  const [open, setOpen] = useState<fin.Receipt | null>(null);
  const [f, setF] = useState({ unitId: '', amount: '', mode: 'UPI', reference: '', chequeNo: '', receivedOn: inDays(0), payerName: '' });
  useEffect(() => { fin.flats().then(setFlats).catch(fail); fin.payments().then(setList).catch(fail); }, [fail, version]);
  const flat = flats.find(x => x.id === f.unitId);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!f.unitId || !num(f.amount)) { fail(new ApiError(400, 'x', 'Choose the flat and enter the amount.')); return; }
    fin.pay({ unitId: f.unitId, amount: num(f.amount), mode: f.mode, reference: f.reference || undefined, chequeNo: f.chequeNo || undefined, chequeDate: f.mode === 'Cheque' ? f.receivedOn : undefined, receivedOn: f.receivedOn, payerName: f.payerName || flat?.owner || undefined })
      .then(r => { done(`${r.number} · ${rupees(r.amount)} from ${r.unit}`, r.advance ? `${rupees(r.advance)} kept as advance` : 'Receipt ready'); setOpen(r); setF({ ...f, amount: '', reference: '', chequeNo: '', payerName: '' }); bump(); }).catch(fail);
  };
  const show = (id: string) => fin.receipt(id).then(setOpen).catch(fail);
  const after = (p: Promise<fin.Receipt>, msg: string) => p.then(r => { done(msg, r.number); setOpen(r); bump(); }).catch(fail);
  return (
    <>
      <form onSubmit={submit} className="card" style={grid}>
        <label>Flat<select className="a-in" value={f.unitId} onChange={e => setF({ ...f, unitId: e.target.value, amount: String(Math.max(0, flats.find(x => x.id === e.target.value)?.balance ?? 0) || '') })}>
          <option value="">Choose…</option>{flats.map(x => <option key={x.id} value={x.id}>{x.code}{x.owner ? ' · ' + x.owner : ''}{x.balance > 0 ? ' · owes ' + rupees(x.balance) : ''}</option>)}
        </select></label>
        <label>Amount (₹)<input className="a-in" inputMode="numeric" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} /></label>
        <label>Mode<select className="a-in" value={f.mode} onChange={e => setF({ ...f, mode: e.target.value })}>{PAYMENT_MODES.map(m => <option key={m}>{m}</option>)}</select></label>
        {f.mode === 'Cheque' ? <label>Cheque number<input className="a-in" value={f.chequeNo} onChange={e => setF({ ...f, chequeNo: e.target.value })} /></label>
          : f.mode !== 'Cash' && <label>Reference / UTR<input className="a-in" value={f.reference} onChange={e => setF({ ...f, reference: e.target.value })} /></label>}
        <label>Received on<input className="a-in" type="date" value={f.receivedOn} onChange={e => setF({ ...f, receivedOn: e.target.value })} /></label>
        <label>Paid by<input className="a-in" value={f.payerName} onChange={e => setF({ ...f, payerName: e.target.value })} placeholder={flat?.owner ?? ''} /></label>
        <button className="a-btn" type="submit">Record payment</button>
      </form>
      {flat && <div style={{ ...small, marginTop: 6 }}>{flat.code} {flat.balance > 0 ? `owes ${rupees(flat.balance)}` : flat.balance < 0 ? `has ${rupees(-flat.balance)} in advance` : 'owes nothing'}. The oldest bills are settled first; anything extra is kept as an advance.</div>}
      {open && <ReceiptView r={open} onClose={() => setOpen(null)} />}
      <TableCard rows={list} noun="receipt" search={p => [p.number, p.unit, p.reference, p.payerName, p.byName, p.chequeNo]} placeholder="Search by receipt, flat, reference or payer"
        filters={[{ key: 'mode', label: 'Mode', get: p => p.mode }, { key: 'state', label: 'State', get: p => (p.reversed ? 'Reversed' : 'Valid'), options: ['Valid', 'Reversed'] }, { key: 'src', label: 'Entered by', get: p => (p.source === 'resident' ? 'Resident, in the app' : 'The office'), options: ['The office', 'Resident, in the app'] }]}
        sorts={[{ label: 'Largest amount', by: p => p.amount, dir: 'desc' }, { label: 'Newest', by: p => p.receivedOn, dir: 'desc' }, { label: 'Flat', by: p => p.unit }]}
        csv={{ name: 'receipts', head: ['Receipt', 'Flat', 'Amount', 'Mode', 'Reference', 'Date', 'Payer', 'Entered by', 'Reversed'], row: p => [p.number, p.unit, p.amount, p.mode, p.reference, p.receivedOn, p.payerName, p.byName, p.reversed ? 'Yes' : 'No'] }} style={{ marginTop: 14 }}>{(page, sl) => (<div className="a-tbl-wrap"><table className="a-tbl"><tbody>
        <tr><th className="sl">Sl. no.</th><th>Receipt</th><th>Flat</th><th>Amount</th><th>Mode</th><th>Date</th><th>By</th><th /></tr>
        {page.map((p, rowNo) => (
          <tr key={p.id} style={p.reversed ? { opacity: 0.55 } : undefined}><td className="sl num">{sl(rowNo)}</td>
            <td><button className="cell-t num" onClick={() => show(p.id)} style={{ color: 'var(--acc)' }}>{p.number}</button>{p.reversed && <div style={{ fontSize: 12, color: 'var(--bad)' }}>Reversed · {p.reverseReason}</div>}</td>
            <td data-l="Flat">{p.unit}</td><td data-l="Amount" className="num"><b>{rupees(p.amount)}</b></td>
            <td data-l="Mode">{p.mode}<div style={small}>{p.chequeNo ? `Cheque ${p.chequeNo} · ${p.chequeStatus}` : p.reference}</div></td>
            <td data-l="Date" className="num">{p.receivedOn}</td><td data-l="By">{p.source === 'resident' ? 'Resident, in the app' : p.byName}</td>
            <td>{!p.reversed && <div style={{ display: 'flex', gap: 6 }}>
              {p.chequeStatus === 'Pending' && <><IconBtn icon={CheckCircle} label="Cleared" tone="good" onClick={() => after(fin.cheque(p.id, 'Cleared'), 'Cheque cleared')} /><IconBtn icon={XCircle} label="Bounced" tone="danger" onClick={() => after(fin.cheque(p.id, 'Bounced'), 'Cheque bounced — receipt reversed')} /></>}
              {p.chequeStatus !== 'Pending' && <IconBtn icon={ArrowUUpLeft} label="Reverse" tone="danger" onClick={async () => { const r = (await ask(`Reverse ${p.number}? Give the reason.`)); if (r) void after(fin.reversePayment(p.id, r), 'Payment reversed'); }} />}
            </div>}</td>
          </tr>
        ))}
        {!list.length && <tr><td colSpan={7} style={small}>No payments recorded yet.</td></tr>}
      </tbody></table></div>)}</TableCard>
    </>
  );
}

/* ------------------------------------------------------------ flats and ledgers */
function Flats({ fail, done, version, bump }: P) {
  const [flats, setFlats] = useState<fin.Flat[]>([]);
  const [led, setLed] = useState<fin.Ledger | null>(null);
  const [ledId, setLedId] = useState('');
  useEffect(() => { fin.flats().then(setFlats).catch(fail); }, [fail, version]);
  const edit = async (x: fin.Flat) => {
    const v = await formBox({ title: `Flat ${x.code}`, body: 'Bills are worked out from the area and the flat type.', fields: [
      { key: 'area', label: 'Area in sq ft', value: x.area ? String(x.area) : '', type: 'number', placeholder: 'e.g. 1450' },
      { key: 'type', label: 'Flat type', value: x.flatType, placeholder: 'e.g. 2BHK' },
    ] });
    if (v) void fin.saveFlat(x.id, { area: num(v.area ?? ''), ...(v.type?.trim() ? { flatType: v.type.trim() } : {}) }).then(() => { done('Saved', x.code); bump(); }).catch(fail);
  };
  const opening = async (x: fin.Flat) => {
    const v = await promptBox(`Opening balance for ${x.code}`, '', { body: 'What this flat owed before this system, in rupees. Put a minus sign for an advance it had paid.', placeholder: 'e.g. 4350 or -1000', confirm: 'Set balance', required: true });
    const n = v ? Number(v.replace(/[^\d-]/g, '')) : 0;
    if (n) void fin.setOpening(x.id, n).then(() => { done('Opening balance set', x.code); bump(); }).catch(fail);
  };
  const show = (x: fin.Flat) => fin.ledger(x.id).then(l => { setLed(l); setLedId(x.id); }).catch(fail);
  return (
    <>
      <TableCard rows={flats} noun="flat" search={x => [x.code, x.owner, x.tower, x.flatType]} placeholder="Search by flat, owner or tower"
        filters={[{ key: 'tower', label: 'Tower', get: x => x.tower }, { key: 'type', label: 'Type', get: x => x.flatType }, { key: 'bal', label: 'Balance', get: x => (x.balance > 0 ? 'Owes money' : x.balance < 0 ? 'Paid in advance' : 'Settled'), options: ['Owes money', 'Paid in advance', 'Settled'] }]}
        sorts={[{ label: 'Owes the most', by: x => x.balance, dir: 'desc' }, { label: 'Largest area', by: x => x.area, dir: 'desc' }, { label: 'Flat', by: x => x.code }]}
        csv={{ name: 'flat-balances', head: ['Flat', 'Tower', 'Owner', 'Area', 'Type', 'Balance'], row: x => [x.code, x.tower, x.owner ?? '', x.area, x.flatType, x.balance] }}>{(page, sl) => (<div className="a-tbl-wrap"><table className="a-tbl"><tbody>
        <tr><th className="sl">Sl. no.</th><th>Flat</th><th>Owner</th><th>Area</th><th>Type</th><th>Balance</th><th /></tr>
        {page.map((x, rowNo) => (
          <tr key={x.id}><td className="sl num">{sl(rowNo)}</td>
            <td><span className="cell-t">{x.code}</span><div style={small}>{x.tower}</div></td><td data-l="Owner">{x.owner ?? '—'}</td>
            <td data-l="Area" className="num">{x.area ? x.area + ' sq ft' : '—'}</td><td data-l="Type">{x.flatType || '—'}</td>
            <td data-l="Balance" className="num">{x.balance > 0 ? <b style={{ color: 'var(--bad)' }}>{rupees(x.balance)} due</b> : x.balance < 0 ? <span style={{ color: 'var(--good)' }}>{rupees(-x.balance)} advance</span> : 'Settled'}</td>
            <td><div style={{ display: 'flex', gap: 6 }}><IconBtn icon={Notebook} label="Ledger" onClick={() => show(x)} /><IconBtn icon={Ruler} label="Area & type" onClick={() => edit(x)} /><IconBtn icon={Scales} label="Opening balance" onClick={() => opening(x)} /></div></td>
          </tr>
        ))}
      </tbody></table></div>)}</TableCard>
      {led && (
        <div className="card" style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}><b>Ledger · {led.label}</b>
            <div className="no-print" style={{ display: 'flex', gap: 6 }}><button className="a-btn ghost" onClick={() => fin.download(`/ledger/${ledId}?format=csv`, `ledger-${led.unit}.csv`).catch(fail)}>Download</button><button className="a-btn ghost" onClick={() => setLed(null)}>Close</button></div></div>
          <table className="a-tbl compact" style={{ marginTop: 8 }}><tbody>
            <tr><th>Date</th><th>Particulars</th><th>Charge</th><th>Payment</th><th>Balance</th></tr>
            {led.lines.map((l, i) => <tr key={i}><td className="num">{l.date}</td><td>{l.what}<div style={small}>{l.ref}</div></td><td className="num">{l.charge ? rupees(l.charge) : ''}</td><td className="num">{l.payment ? rupees(l.payment) : ''}</td><td className="num"><b>{rupees(l.balance)}</b></td></tr>)}
            {!led.lines.length && <tr><td colSpan={5} style={small}>Nothing has been billed to or received from this flat.</td></tr>}
          </tbody></table>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------ expenses */
function Expenses({ fail, done, version, bump }: P) {
  const [heads, setHeads] = useState<fin.Account[]>([]);
  const [list, setList] = useState<fin.Expense[]>([]);
  const [f, setF] = useState({ payee: '', accountId: '', amount: '', date: inDays(0), description: '', billNo: '', paidNow: '' });
  const [file, setFile] = useState<{ url: string; name: string } | null>(null);
  useEffect(() => { fin.accounts().then(a => setHeads(a.filter(x => x.kind === 'expense'))).catch(fail); fin.expenses().then(setList).catch(fail); }, [fail, version]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (f.payee.trim().length < 2 || !f.accountId || !num(f.amount)) { fail(new ApiError(400, 'x', 'Enter who was paid, the expense head and the amount.')); return; }
    fin.addExpense({ payee: f.payee.trim(), accountId: f.accountId, amount: num(f.amount), date: f.date, description: f.description.trim(), billNo: f.billNo.trim(), receiptUrl: file?.url, ...(f.paidNow ? { paid: { mode: f.paidNow } } : {}) })
      .then(x => { done(`${x.number} · ${x.status}`, `${x.payee} · ${rupees(x.amount)}`); setF({ ...f, payee: '', amount: '', description: '', billNo: '' }); setFile(null); bump(); }).catch(fail);
  };
  const act = (p: Promise<fin.Expense>, msg: string) => p.then(x => { done(msg, `${x.number} · ${rupees(x.amount)}`); bump(); }).catch(fail);
  return (
    <>
      <form onSubmit={submit} className="card" style={grid}>
        <label>Paid to<input className="a-in" value={f.payee} onChange={e => setF({ ...f, payee: e.target.value })} placeholder="Vendor, staff or shop" /></label>
        <label>Expense head<select className="a-in" value={f.accountId} onChange={e => setF({ ...f, accountId: e.target.value })}><option value="">Choose…</option>{heads.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}</select></label>
        <label>Amount (₹)<input className="a-in" inputMode="numeric" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} /></label>
        <label>Bill date<input className="a-in" type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} /></label>
        <label>Their bill number<input className="a-in" value={f.billNo} onChange={e => setF({ ...f, billNo: e.target.value })} /></label>
        <label>What for<input className="a-in" value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></label>
        <label>Already paid?<select className="a-in" value={f.paidNow} onChange={e => setF({ ...f, paidNow: e.target.value })}><option value="">No — to be paid later</option>{PAYMENT_MODES.filter(m => m !== 'Payment gateway').map(m => <option key={m} value={m}>Yes, by {m.toLowerCase()}</option>)}</select></label>
        <label className="a-btn ghost" style={{ cursor: 'pointer', display: 'inline-flex' }}>{file ? file.name : 'Attach the bill'}<input type="file" accept="application/pdf,image/*" hidden onChange={e => { const x = e.target.files?.[0]; if (x) fin.attach(x).then(url => setFile({ url, name: x.name })).catch(fail); }} /></label>
        <button className="a-btn" type="submit">Book expense</button>
      </form>
      <TableCard rows={list} noun="expense" search={x => [x.number, x.payee, x.head, x.description, x.billNo]} placeholder="Search by expense number, payee, head or bill number"
        filters={[{ key: 'status', label: 'Status', get: x => x.status, options: ['Pending approval', 'Approved', 'Paid', 'Rejected'] }, { key: 'head', label: 'Head', get: x => x.head }, { key: 'payee', label: 'Paid to', get: x => x.payee }]}
        sorts={[{ label: 'Largest amount', by: x => x.amount, dir: 'desc' }, { label: 'Newest', by: x => x.date, dir: 'desc' }]}
        csv={{ name: 'expenses', head: ['Expense', 'Paid to', 'Head', 'Amount', 'Date', 'Bill no.', 'Description', 'Status'], row: x => [x.number, x.payee, x.head, x.amount, x.date, x.billNo, x.description, x.status] }} style={{ marginTop: 14 }}>{(page, sl) => (<div className="a-tbl-wrap"><table className="a-tbl"><tbody>
        <tr><th className="sl">Sl. no.</th><th>Expense</th><th>Paid to</th><th>Head</th><th>Amount</th><th>Date</th><th>Status</th><th /></tr>
        {page.map((x, rowNo) => (
          <tr key={x.id}><td className="sl num">{sl(rowNo)}</td>
            <td><span className="cell-t num">{x.number}</span><div style={small}>{[x.description, x.billNo && 'Bill ' + x.billNo, x.fromMaintenance && 'from Maintenance'].filter(Boolean).join(' · ')}</div>{x.receiptUrl && <a href={x.receiptUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>View bill</a>}</td>
            <td data-l="Paid to">{x.payee}</td><td data-l="Head">{x.head}</td><td data-l="Amount" className="num"><b>{rupees(x.amount)}</b></td><td data-l="Date" className="num">{x.date}</td>
            <td data-l="Status"><Pill tone={EXP_TONE[x.status]}>{x.status}</Pill>{x.paidOn && <div style={small}>{x.paidOn} · {x.paymentMode}</div>}</td>
            <td><div style={{ display: 'flex', gap: 6 }}>
              {x.status === 'Pending approval' && <><IconBtn icon={Check} label="Approve" tone="good" primary onClick={() => act(fin.decideExpense(x.id, 'approve'), 'Approved')} /><IconBtn icon={X} label="Reject" tone="danger" onClick={() => act(fin.decideExpense(x.id, 'reject'), 'Rejected')} /></>}
              {x.status === 'Approved' && <IconBtn icon={CheckCircle} label="Mark paid" tone="good" primary onClick={async () => { const v = await formBox({ title: `Mark ${x.number} as paid`, body: `${rupees(x.amount)} to ${x.payee}.`, confirm: 'Mark paid', fields: [{ key: 'mode', label: 'Paid by', options: ['Bank transfer', 'UPI', 'Cash', 'Cheque'] }, { key: 'reference', label: 'Reference or cheque number', hint: 'Optional.' }] }); const mode = PAYMENT_MODES.find(p => p === v?.mode); if (v && mode) void act(fin.payExpense(x.id, mode, v.reference?.trim() || undefined), 'Marked paid'); }} />}
            </div></td>
          </tr>
        ))}
        {!list.length && <tr><td colSpan={7} style={small}>No expenses booked yet.</td></tr>}
      </tbody></table></div>)}</TableCard>
    </>
  );
}

/* ------------------------------------------------------------ bank */
function BankTab({ fail, done, version, bump }: P) {
  const [lines, setLines] = useState<fin.BankLine[]>([]);
  const [heads, setHeads] = useState<fin.Account[]>([]);
  const [months, setMonths] = useState<fin.Month[]>([]);
  const [show, setShow] = useState('Unmatched');
  useEffect(() => { fin.bank(show === 'All' ? undefined : show).then(setLines).catch(fail); fin.months().then(setMonths).catch(fail); fin.accounts().then(a => setHeads(a.filter(x => x.kind === 'income' || x.kind === 'expense'))).catch(fail); }, [fail, version, show]);
  const read = (file?: File) => { if (file) void file.text().then(fin.importBank).then(r => { done(`${r.imported} lines imported`, `${r.matched} matched automatically · ${r.unmatched} to look at${r.duplicates ? ` · ${r.duplicates} already imported` : ''}`); bump(); }).catch(fail); };
  const act = (p: Promise<unknown>, msg: string) => p.then(() => { done(msg); bump(); }).catch(fail);
  return (
    <>
      <div className="card" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <label className="a-btn" style={{ cursor: 'pointer' }}>Upload bank statement (CSV)<input type="file" accept=".csv,text/csv" hidden onChange={e => read(e.target.files?.[0])} /></label>
        <span style={small}>Export the statement from net banking as CSV. Any column order works, as long as there is a date and money in / money out. Uploading the same file twice changes nothing.</span>
      </div>
      <div className="toolbar" style={{ marginTop: 14, gap: 6 }}>{['Unmatched', 'Matched', 'Ignored', 'All'].map(s => <button key={s} className={'a-btn' + (show === s ? '' : ' ghost')} onClick={() => setShow(s)}>{s}</button>)}</div>
      {lines.length ? (
        <TableCard rows={lines} noun="line" search={l => [l.description, l.reference, l.matchedTo]} placeholder="Search the statement by description or reference"
          filters={[{ key: 'dir', label: 'Direction', get: l => (l.moneyIn > 0 ? 'Money in' : 'Money out'), options: ['Money in', 'Money out'] }]}
          sorts={[{ label: 'Largest amount', by: l => Math.max(l.moneyIn, l.moneyOut), dir: 'desc' }, { label: 'Newest', by: l => l.date, dir: 'desc' }]}>{(page, sl) => (<div className="a-tbl-wrap"><table className="a-tbl"><tbody>
          <tr><th className="sl">Sl. no.</th><th>Date</th><th>Bank says</th><th>Money out</th><th>Money in</th><th>In the books</th></tr>
          {page.map((l, rowNo) => (
            <tr key={l.id}><td className="sl num">{sl(rowNo)}</td>
              <td className="num">{l.date}</td><td>{l.description}<div style={small}>{l.reference}</div></td>
              <td data-l="Money out" className="num">{l.moneyOut ? rupees(l.moneyOut) : ''}</td><td data-l="Money in" className="num">{l.moneyIn ? rupees(l.moneyIn) : ''}</td>
              <td data-l="In the books">
                {l.status === 'Matched' && <><Pill tone="good">Matched</Pill> <span style={{ fontSize: 13 }}>{l.matchedTo}</span><div style={small}>{l.matchedHow === 'auto' ? 'matched automatically' : 'matched by hand'}{l.matchedTo !== 'Journal entry' && <> · <button onClick={() => act(fin.unmatchLine(l.id), 'Unmatched')} style={{ color: 'var(--acc)' }}>undo</button></>}</div></>}
                {l.status === 'Ignored' && <><Pill tone="dim">Ignored</Pill> <button onClick={() => act(fin.ignoreLine(l.id), 'Back in the list')} style={{ color: 'var(--acc)', fontSize: 12 }}>undo</button></>}
                {l.status === 'Unmatched' && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    {l.suggestions.map(s => <button key={s.id} className="a-btn ghost" onClick={() => act(fin.matchLine(l.id, s.type, s.id), 'Matched')}>Match {s.label}</button>)}
                    <select className="a-in" style={{ width: 190 }} value="" onChange={e => { if (e.target.value) void act(fin.categorize(l.id, e.target.value), 'Posted to the books'); }} aria-label="Post to a head">
                      <option value="">Not in the books — post to…</option>{heads.filter(h => (l.moneyIn ? h.kind === 'income' : h.kind === 'expense')).map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                    </select>
                    <IconBtn icon={EyeSlash} label="Ignore" onClick={() => act(fin.ignoreLine(l.id), 'Ignored')} />
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody></table></div>)}</TableCard>
      ) : <Empty icon={Bank} title={show === 'Unmatched' ? 'Nothing left to match' : 'No bank lines here'} body="Upload a statement to compare the bank with the books." />}
      <div className="card" style={{ marginTop: 14 }}><b>Closing a month</b><div style={small}>A closed month can’t be changed. Every bank line in it must be matched, posted or ignored first.</div>
        <table className="a-tbl compact" style={{ marginTop: 8 }}><tbody>
          <tr><th>Month</th><th>Entries</th><th>Unmatched bank lines</th><th /></tr>
          {months.map(m => (
            <tr key={m.period}><td>{m.name}</td><td className="num">{m.entries}</td><td className="num">{m.unmatched}</td>
              <td>{m.locked ? <><Pill tone="dim">Closed by {m.lockedBy}</Pill> <IconBtn icon={LockOpen} label="Reopen" onClick={async () => { if ((await confirmBox(`Reopen ${m.name}? Entries in it can be changed again.`))) void act(fin.unlockMonth(m.period), `${m.name} reopened`); }} /></>
                : m.period < thisMonth() ? <IconBtn icon={Lock} label="Close month" onClick={() => act(fin.lockMonth(m.period), `${m.name} closed`)} /> : <span style={small}>In progress</span>}</td></tr>
          ))}
          {!months.length && <tr><td colSpan={4} style={small}>No entries yet.</td></tr>}
        </tbody></table>
      </div>
    </>
  );
}

/* ------------------------------------------------------------ reports */
function Reports({ fail }: P) {
  const [name, setName] = useState<string>('pnl');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [r, setR] = useState<fin.Report | null>(null);
  useEffect(() => { fin.report(name, from || undefined, to || undefined).then(setR).catch(fail); }, [name, from, to, fail]);
  const money = (h: string) => !/^(Date|Month|Mode|Code|Head|Flat|Section|Account|Payee|Description|Reference|Status|How|When|Who|What|Voucher|Ledger|Narration|From|Days|Open|Bills|Receipts)/.test(h);
  return (
    <>
      <div className="card no-print" style={grid}>
        <label>Report<select className="a-in" value={name} onChange={e => setName(e.target.value)}>{REPORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label>From<input className="a-in" type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label>To<input className="a-in" type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
        <button className="a-btn ghost" onClick={() => fin.download(`/reports/${name}?format=csv${from ? '&from=' + from : ''}${to ? '&to=' + to : ''}`, `${name}.csv`).catch(fail)}>Download for Excel</button>
        <button className="a-btn ghost" onClick={() => window.print()}>Print / save as PDF</button>
      </div>
      {r && (
        <div className="card" style={{ marginTop: 14 }}>
          <b style={{ fontSize: 15 }}>{r.title}</b><div style={small}>{['balance-sheet', 'trial-balance', 'defaulters'].includes(r.name) ? `As at ${r.to}` : `${r.from} to ${r.to}${from ? '' : ' · this financial year (from April)'}`}</div>
          {r.name === 'balance-sheet' && <div style={{ marginTop: 6 }}><Pill tone={r.balanced ? 'good' : 'bad'}>{r.balanced ? 'Books balance' : 'Books do not balance'}</Pill></div>}
          <div className="a-tbl-wrap" style={{ marginTop: 10 }}><table className="a-tbl compact"><tbody>
            <tr>{r.head.map(h => <th key={h} style={money(h) ? { textAlign: 'right' } : undefined}>{h}</th>)}</tr>
            {r.rows.map((row, i) => {
              const total = typeof row[1] === 'string' && /^(Total|Surplus|Deficit|Liabilities \+)/.test(row[1]);
              return <tr key={i} style={total ? { fontWeight: 700, background: 'var(--panel2)' } : undefined}>{row.map((c, j) => <td key={j} className={typeof c === 'number' ? 'num' : undefined} style={typeof c === 'number' && money(r.head[j]!) ? { textAlign: 'right' } : undefined}>{c === null ? '' : typeof c === 'number' && money(r.head[j]!) ? rupees(c) : c}</td>)}</tr>;
            })}
            {!r.rows.length && <tr><td colSpan={r.head.length} style={small}>Nothing in this period.</td></tr>}
          </tbody></table></div>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------ setup */
function Setup({ fail, done, version, bump }: P) {
  const [chart, setChart] = useState<fin.Account[]>([]);
  const [s, setS] = useState<fin.Settings | null>(null);
  const [aud, setAud] = useState<{ id: string; name: string; email: string }[]>([]);
  const [entries, setEntries] = useState<fin.Entry[]>([]);
  const [a, setA] = useState({ code: '', name: '', kind: 'expense' as fin.Account['kind'] });
  const [u, setU] = useState({ name: '', email: '', password: '' });
  const [j, setJ] = useState({ date: inDays(0), memo: '', debit: '', credit: '', amount: '' });
  useEffect(() => { fin.accounts().then(setChart).catch(fail); fin.settings().then(setS).catch(fail); fin.auditors().then(setAud).catch(() => {}); fin.journal().then(setEntries).catch(fail); }, [fail, version]);
  const act = (p: Promise<unknown>, msg: string) => p.then(() => { done(msg); bump(); }).catch(fail);
  const save = (patch: Partial<fin.Settings>) => fin.saveSettings(patch).then(n => { setS(n); done('Settings saved'); }).catch(fail);
  const postJ = (e: FormEvent) => {
    e.preventDefault();
    const n = num(j.amount);
    if (!j.debit || !j.credit || !n || j.memo.trim().length < 3) { fail(new ApiError(400, 'x', 'Choose both accounts, the amount, and say what the entry is for.')); return; }
    void act(fin.postJournal({ date: j.date, memo: j.memo.trim(), lines: [{ accountId: j.debit, debit: n, credit: 0 }, { accountId: j.credit, debit: 0, credit: n }] }), 'Journal entry posted');
  };
  return (
    <div style={{ display: 'grid', gap: 14 }}>
      {s && (
        <div className="card"><b>Rules for dues</b>
          <div style={{ ...grid, marginTop: 8 }}>
            <label>Part payments<select className="a-in" value={s.allowPartial ? 'y' : 'n'} onChange={e => save({ allowPartial: e.target.value === 'y' })}><option value="y">Accepted</option><option value="n">Full amount only</option></select></label>
            <label>Late fee<select className="a-in" value={s.lateFee.kind} onChange={e => save({ lateFee: { ...s.lateFee, kind: e.target.value as fin.Settings['lateFee']['kind'] } })}><option value="none">None</option><option value="flat">Fixed amount</option><option value="percent">Percent of what is due</option></select></label>
            {s.lateFee.kind !== 'none' && <label>{s.lateFee.kind === 'flat' ? 'Fee (₹)' : 'Fee (%)'}<input className="a-in" defaultValue={s.lateFee.value} onBlur={e => save({ lateFee: { ...s.lateFee, value: Number(e.target.value) || 0 } })} /></label>}
            {s.lateFee.kind !== 'none' && <label>Grace period (days)<input className="a-in" defaultValue={s.lateFee.graceDays} onBlur={e => save({ lateFee: { ...s.lateFee, graceDays: num(e.target.value) } })} /></label>}
            <label>Expenses need approval above (₹)<input className="a-in" defaultValue={s.approvalAbove} onBlur={e => save({ approvalAbove: num(e.target.value) })} /><span style={small}>0 = every expense</span></label>
            <label>UPI ID shown to residents<input className="a-in" defaultValue={s.upiId} onBlur={e => save({ upiId: e.target.value.trim() })} placeholder="society@bank" /></label>
            <label style={{ gridColumn: '1 / -1' }}>Bank details shown to residents<input className="a-in" defaultValue={s.bankDetails} onBlur={e => save({ bankDetails: e.target.value.trim() })} placeholder="Account name, number, IFSC" /></label>
          </div>
        </div>
      )}
      <div className="card"><b>Chart of accounts</b>
        <div className="a-tbl-wrap" style={{ maxHeight: 300, overflowY: 'auto', marginTop: 8 }}><table className="a-tbl compact"><tbody>
          <tr><th>Code</th><th>Account</th><th>Kind</th><th style={{ textAlign: 'right' }}>Balance</th><th /></tr>
          {chart.map(x => <tr key={x.id}><td className="num">{x.code}</td><td>{x.name}</td><td>{x.kind}</td><td className="num" style={{ textAlign: 'right' }}>{x.balance ? rupees(x.balance) : ''}</td>
            <td style={{ textAlign: 'right' }}><IconBtn icon={PencilSimple} label="Rename" onClick={async () => { const n = (await promptBox(`Rename account ${x.code}`, x.name))?.trim(); if (n && n !== x.name) void act(fin.renameAccount(x.id, n), 'Account renamed'); }} /></td></tr>)}
        </tbody></table></div>
        <form onSubmit={e => { e.preventDefault(); void act(fin.addAccount(a), 'Account added'); }} style={{ ...grid, marginTop: 10 }}>
          <label>Code<input className="a-in" value={a.code} onChange={e => setA({ ...a, code: e.target.value.replace(/\D/g, '').slice(0, 4) })} placeholder="4 digits" /></label>
          <label>Name<input className="a-in" value={a.name} onChange={e => setA({ ...a, name: e.target.value })} /></label>
          <label>Kind<select className="a-in" value={a.kind} onChange={e => setA({ ...a, kind: e.target.value as fin.Account['kind'] })}>{['income', 'expense', 'asset', 'liability', 'equity'].map(k => <option key={k}>{k}</option>)}</select></label>
          <button className="a-btn ghost" type="submit">Add account</button>
        </form>
      </div>
      <div className="card"><b>Journal entry</b><div style={small}>For adjustments nothing else covers. The two sides are always equal.</div>
        <form onSubmit={postJ} style={{ ...grid, marginTop: 8 }}>
          <label>Date<input className="a-in" type="date" value={j.date} onChange={e => setJ({ ...j, date: e.target.value })} /></label>
          <label>Debit<select className="a-in" value={j.debit} onChange={e => setJ({ ...j, debit: e.target.value })}><option value="">Choose…</option>{chart.filter(c => c.role !== 'receivable').map(c => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</select></label>
          <label>Credit<select className="a-in" value={j.credit} onChange={e => setJ({ ...j, credit: e.target.value })}><option value="">Choose…</option>{chart.filter(c => c.role !== 'receivable').map(c => <option key={c.id} value={c.id}>{c.code} {c.name}</option>)}</select></label>
          <label>Amount (₹)<input className="a-in" inputMode="numeric" value={j.amount} onChange={e => setJ({ ...j, amount: e.target.value })} /></label>
          <label style={{ gridColumn: '1 / -1' }}>What it is for<input className="a-in" value={j.memo} onChange={e => setJ({ ...j, memo: e.target.value })} /></label>
          <button className="a-btn ghost" type="submit">Post entry</button>
        </form>
        <div className="a-tbl-wrap" style={{ maxHeight: 280, overflowY: 'auto', marginTop: 10 }}><table className="a-tbl compact"><tbody>
          <tr><th>Entry</th><th>Date</th><th>What</th><th>Lines</th><th /></tr>
          {entries.slice(0, 60).map(e => (
            <tr key={e.id} style={e.reversed ? { opacity: 0.55 } : undefined}><td className="num">{e.ref}</td><td className="num">{e.date}</td><td>{e.memo}<div style={small}>{e.source} · {e.byName}{e.reversed ? ' · reversed' : ''}</div></td>
              <td style={{ fontSize: 12 }}>{e.lines.map((l, i) => <div key={i}>{l.debit ? 'Dr' : 'Cr'} {l.account}{l.unit ? ' · ' + l.unit : ''} {rupees(l.debit || l.credit)}</div>)}</td>
              <td>{!e.reversed && !e.isReversal && ['journal', 'opening', 'bank'].includes(e.source) && <IconBtn icon={ArrowUUpLeft} label="Reverse" tone="danger" onClick={async () => { const r = (await ask(`Reverse ${e.ref}? Give the reason.`)); if (r) void act(fin.reverseEntry(e.id, r), 'Entry reversed'); }} />}</td></tr>
          ))}
        </tbody></table></div>
      </div>
      <div className="card"><b>Auditor access</b><div style={small}>A read-only login to the books. An auditor sees accounting and nothing else.</div>
        {aud.map(x => <div key={x.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 0', fontSize: 13 }}><span>{x.name} · {x.email}</span><button className="a-btn ghost" onClick={() => act(fin.removeAuditor(x.id), 'Access removed')}>Remove</button></div>)}
        <form onSubmit={e => { e.preventDefault(); void act(fin.addAuditor(u).then(() => setU({ name: '', email: '', password: '' })), 'Auditor login created'); }} style={{ ...grid, marginTop: 8 }}>
          <label>Name<input className="a-in" value={u.name} onChange={e => setU({ ...u, name: e.target.value })} /></label>
          <label>Email<input className="a-in" type="email" value={u.email} onChange={e => setU({ ...u, email: e.target.value })} /></label>
          <label>Password<input className="a-in" value={u.password} onChange={e => setU({ ...u, password: e.target.value })} placeholder="At least 8 characters" autoComplete="off" /></label>
          <button className="a-btn ghost" type="submit">Give access</button>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ page */
const TABS: [Tab, string][] = [['overview', 'Overview'], ['billing', 'Billing'], ['payments', 'Payments'], ['flats', 'Flats & ledgers'], ['expenses', 'Expenses'], ['bank', 'Bank'], ['reports', 'Reports'], ['setup', 'Setup']];

/** The society's books: bill, collect, spend, reconcile and report — every action posts to one ledger. Connected mode only. */
export function Accounts() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('overview');
  const [version, setVersion] = useState(0);
  const fail = useCallback((e: unknown) => toast(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'That didn’t go through.', undefined, 'warn'), [toast]);
  const done = useCallback((msg: string, sub?: string) => toast(msg, sub), [toast]);
  const bump = useCallback(() => setVersion(v => v + 1), []);
  if (!LIVE) {
    return (
      <>
        <PageHead title="Accounts" sub="Billing, payments, expenses and reports." />
        <Empty icon={TrendDown} title="Connect the console to the API" body="The books are kept on the server. Set VITE_API_URL to use them." />
      </>
    );
  }
  const p: P = { fail, done, version, bump, go: setTab };
  return (
    <>
      <PageHead title="Accounts" sub="Bill the flats, record what comes in and what goes out, match the bank, and print the reports. Nothing is entered twice." />
      <div className="toolbar no-print" style={{ gap: 6 }}>{TABS.map(([k, l]) => <button key={k} className={'a-btn' + (tab === k ? '' : ' ghost')} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'overview' && <Overview {...p} />}
      {tab === 'billing' && <Billing {...p} />}
      {tab === 'payments' && <Payments {...p} />}
      {tab === 'flats' && <Flats {...p} />}
      {tab === 'expenses' && <Expenses {...p} />}
      {tab === 'bank' && <BankTab {...p} />}
      {tab === 'reports' && <Reports {...p} />}
      {tab === 'setup' && <Setup {...p} />}
    </>
  );
}
