import { ArrowRight, Check, ChevronLeft, ChevronRight, CircleAlert, CalendarClock, Minus, PauseCircle, PlayCircle, Plus, Settings2 } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { DataList } from '../components/DataList';
import { Kpi, Pill } from '../components/ui';
import { ASSOC, findAssoc, fmtI, fmtL, MODULES, num, PLAN_INFO, stateTone } from '../data/portal';
import { LIVE } from '../lib/api';
import { usePortal } from '../store/context';
import { Onboard } from './Onboard';

/* Subscriptions: every society's plan, state, price and renewal in one place, and a guided way to
   change one — pick the plan, set the terms, read exactly what will change, then confirm. */

/** the wording of each plan is read when drawn, so an edit under Modules & plans shows here at once */
const PLANS = [['Starter', 3], ['Professional', 4], ['Enterprise', 5]].map(([key, col]) => ({ key, col, get tag() { return PLAN_INFO[key].tag; }, get about() { return PLAN_INFO[key].about; } }));
const RANK = { Starter: 1, Professional: 2, Enterprise: 3 };
const STATES = [
  { key: 'Active', about: 'Paying customer with full access to the plan.' },
  { key: 'Trial', about: 'Full access until the trial end date, not yet paying.' },
  { key: 'Pending', about: 'Onboarded but not verified. Nothing can start yet.' },
  { key: 'Suspended', about: 'Access is switched off, usually for non-payment.' },
];
const modulesOf = plan => MODULES.filter(m => m[PLANS.find(p => p.key === plan).col]).map(m => m[0]);
const ymd = iso => (iso ? new Date(new Date(iso).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10) : '');
const longDay = d => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
/** a year (or a month) on from the current renewal date, or from today if that has already passed */
const nextTerm = a => {
  const from = new Date(Math.max(Date.now(), a.renewsAt ? new Date(a.renewsAt).getTime() : 0));
  if (a.billing === 'monthly') from.setMonth(from.getMonth() + 1); else from.setFullYear(from.getFullYear() + 1);
  return ymd(from.toISOString());
};
const when = a => (a.state === 'Suspended' ? '—' : a.days < 0 ? Math.abs(a.days) + ' days ago' : 'in ' + a.days + ' days');

/** The guided change, opened in the modal. */
export function ManageSubscription({ id, start = {} }) {
  const { updateSubscription, closeModal, toast } = usePortal();
  const a = findAssoc(id);
  const [step, setStep] = useState(start.step ?? 0);
  const [plan, setPlan] = useState(a.plan);
  const [state, setState] = useState(start.state ?? a.state);
  const [amount, setAmount] = useState(String(a.annual));
  const [renew, setRenew] = useState(start.renew ?? (ymd(a.renewsAt) || ''));
  const [billing, setBilling] = useState(a.billing ?? 'yearly');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const was = { renew: ymd(a.renewsAt), billing: a.billing ?? 'yearly' };
  const annual = Number(amount || 0);
  const changes = [
    plan !== a.plan && ['Plan', a.plan, plan],
    state !== a.state && ['State', a.state, state],
    annual !== a.annual && ['Annual value', fmtI(a.annual), fmtI(annual)],
    renew && renew !== was.renew && [state === 'Trial' ? 'Trial ends' : 'Renewal date', was.renew ? longDay(was.renew) : '—', longDay(renew)],
    billing !== was.billing && ['Billing', was.billing === 'yearly' ? 'Yearly' : 'Monthly', billing === 'yearly' ? 'Yearly' : 'Monthly'],
  ].filter(Boolean);
  const before = modulesOf(a.plan), after = modulesOf(plan);
  const gained = after.filter(m => !before.includes(m)), lost = before.filter(m => !after.includes(m));
  const termsOk = amount !== '' && !Number.isNaN(annual) && annual >= 0 && !!renew;

  const save = async () => {
    if (!LIVE) { toast('Subscription updated', a.n); closeModal(); return; }
    setBusy(true);
    const ok = await updateSubscription(a.id, {
      ...(plan !== a.plan ? { plan } : {}), ...(state !== a.state ? { state } : {}), ...(annual !== a.annual ? { annualAmount: annual } : {}),
      ...(renew !== was.renew ? { renewsAt: new Date(renew + 'T00:00:00+05:30').toISOString() } : {}), ...(billing !== was.billing ? { billing } : {}), ...(note.trim() ? { note: note.trim() } : {}),
    }, state === 'Suspended' && a.state !== 'Suspended' ? 'Subscription suspended' : plan !== a.plan ? `Moved to ${plan}` : 'Subscription updated');
    setBusy(false);
    if (ok) closeModal();
  };

  return (
    <div className="sub-flow">
      <h2>{start.title ?? 'Manage subscription'}</h2>
      <div className="msub">{a.n} · currently {a.plan}, {a.state.toLowerCase()}, {fmtL(a.annual)} a year</div>
      <ol className="steps" aria-label="Steps">
        {['Plan', 'Terms', 'Review'].map((s, i) => (
          <li key={s} className={i === step ? 'on' : i < step ? 'done' : ''}>
            <button onClick={() => i < step && setStep(i)} disabled={i > step} aria-current={i === step ? 'step' : undefined}><span>{i < step ? <Check size={13} /> : i + 1}</span>{s}</button>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <div className="plan-pick" role="radiogroup" aria-label="Plan">
          {PLANS.map(p => {
            const on = plan === p.key, n = modulesOf(p.key).length;
            const move = RANK[p.key] > RANK[a.plan] ? 'Upgrade' : RANK[p.key] < RANK[a.plan] ? 'Downgrade' : 'Current plan';
            return (
              <button key={p.key} role="radio" aria-checked={on} className={'plan-opt' + (on ? ' on' : '')} onClick={() => setPlan(p.key)}>
                <span className="po-top"><b>{p.key}</b><i className={move === 'Current plan' ? 'cur' : ''}>{move}</i></span>
                <span className="po-tag">{p.tag}</span>
                <span className="po-about">{p.about}</span>
                <span className="po-n">{n} of {MODULES.length} modules</span>
                <span className="po-tick" aria-hidden="true">{on && <Check size={14} />}</span>
              </button>
            );
          })}
        </div>
      )}

      {step === 1 && (
        <>
          <div className="state-pick" role="radiogroup" aria-label="State">
            {STATES.map(s => (
              <button key={s.key} role="radio" aria-checked={state === s.key} className={'state-opt' + (state === s.key ? ' on' : '') + (s.key === 'Suspended' ? ' danger' : '')} onClick={() => setState(s.key)}>
                <b>{s.key}</b><span>{s.about}</span>
              </button>
            ))}
          </div>
          <div className="form-grid" style={{ marginTop: 14 }}>
            <label className="fl">Annual value (₹)<input className="in" inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value.replace(/\D/g, ''))} /><span className="f-hint">{annual ? fmtI(Math.round(annual / 12)) + ' a month' : 'Free'}</span></label>
            <label className="fl">{state === 'Trial' ? 'Trial ends on' : 'Renews on'}<input className="in" type="date" value={renew} onChange={e => setRenew(e.target.value)} /><span className="f-hint">{renew ? longDay(renew) : 'Pick a date'}</span></label>
            <label className="fl wide">Billed
              <span className="seg wide" role="group" aria-label="Billing cycle">
                <button type="button" className={billing === 'yearly' ? 'on' : ''} onClick={() => setBilling('yearly')}>Yearly</button>
                <button type="button" className={billing === 'monthly' ? 'on' : ''} onClick={() => setBilling('monthly')}>Monthly</button>
              </span>
            </label>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          {changes.length ? (
            <div className="diff">
              {changes.map(([label, from, to]) => (
                <div key={label} className="diff-row"><span>{label}</span><i>{from}</i><ArrowRight size={14} /><b>{to}</b></div>
              ))}
            </div>
          ) : <div className="empty" style={{ padding: '18px 0' }}>Nothing has been changed yet. Go back and pick a different plan or terms.</div>}

          {state === 'Suspended' && a.state !== 'Suspended' && (
            <div className="callout bad"><CircleAlert size={16} /><div><b>This switches off the society’s access.</b> Its office and residents keep their data, but nobody can use the plan’s modules until it is made active again.</div></div>
          )}
          {a.state === 'Suspended' && state !== 'Suspended' && <div className="callout good"><Check size={16} /><div><b>Access is restored</b> as soon as you confirm.</div></div>}
          {gained.length > 0 && <div className="mods"><b><Plus size={13} /> {gained.length} module{gained.length === 1 ? '' : 's'} added</b><div>{gained.map(m => <span key={m} className="pill good">{m}</span>)}</div></div>}
          {lost.length > 0 && <div className="mods"><b><Minus size={13} /> {lost.length} module{lost.length === 1 ? '' : 's'} removed</b><div>{lost.map(m => <span key={m} className="pill bad">{m}</span>)}</div></div>}
          {changes.length > 0 && (
            <label className="fl" style={{ marginTop: 12 }}>Reason <i>(optional, kept in the activity log)</i>
              <input className="in" value={note} onChange={e => setNote(e.target.value)} maxLength={300} placeholder="e.g. Agreed at the renewal call on 14 Nov" />
            </label>
          )}
        </>
      )}

      <div className="flow-foot">
        {step > 0 ? <button className="btn ghost sm" onClick={() => setStep(step - 1)}><ChevronLeft size={14} /> Back</button> : <button className="btn ghost sm" onClick={closeModal}>Cancel</button>}
        <span className="spacer" />
        {step < 2 && <button className="btn sm" onClick={() => setStep(step + 1)} disabled={step === 1 && !termsOk}>{step === 0 ? 'Set the terms' : 'Review changes'} <ChevronRight size={14} /></button>}
        {step === 2 && <button className={'btn sm' + (state === 'Suspended' && a.state !== 'Suspended' ? ' danger' : '')} onClick={save} disabled={!changes.length || busy}>{busy ? 'Saving…' : state === 'Suspended' && a.state !== 'Suspended' ? 'Suspend the subscription' : 'Confirm changes'}</button>}
      </div>
    </div>
  );
}

export function Subscriptions() {
  const { go, openModal, feed, toast } = usePortal();
  const create = () => (LIVE ? openModal(<Onboard />) : toast('New subscription', 'Connect the portal to the API to onboard a society.'));
  const manage = (a, start) => openModal(<ManageSubscription key={a.id + JSON.stringify(start ?? {})} id={a.id} start={start} />);
  // the plan cards and the table's Plan filter are the same setting, kept in the address bar
  const [params, setParams] = useSearchParams();
  const planFilter = params.get('plan') || 'All';
  const setPlanFilter = v => setParams(prev => { const o = new URLSearchParams(prev); if (v === 'All') o.delete('plan'); else o.set('plan', v); o.delete('page'); return o; }, { replace: true });
  const paying = ASSOC.filter(a => a.state === 'Active');
  const arr = paying.reduce((s, a) => s + a.annual, 0);
  const count = st => ASSOC.filter(a => a.state === st).length;
  const soon = ASSOC.filter(a => a.state !== 'Suspended' && a.days <= 30);
  const history = feed.filter(f => /subscription|onboarded|activated/i.test(f.what)).slice(0, 8);

  return (
    <>
      <div className="dash-head">
        <div>
          <h1 className="pgt">Subscriptions</h1>
          <div className="dash-sub">{num(ASSOC.length)} subscription{ASSOC.length === 1 ? '' : 's'} · {fmtL(arr)} a year from {paying.length} paying account{paying.length === 1 ? '' : 's'}</div>
        </div>
        <div className="dash-act">
          <button className="btn ghost sm" onClick={() => go('modules')}>What each plan includes</button>
          <button className="btn sm" onClick={create}><Plus size={14} /> New subscription</button>
        </div>
      </div>

      <div className="kpis">
        <Kpi label="Annual recurring revenue" value={fmtL(arr)} sub="Active accounts only" onClick={() => go('renewals')} />
        <Kpi label="Monthly recurring revenue" value={fmtL(Math.round(arr / 12))} sub="Annual value ÷ 12" onClick={() => go('renewals')} />
        <Kpi label="Active" value={count('Active')} sub={`of ${ASSOC.length} subscriptions`} onClick={() => setPlanFilter('All')} />
        <Kpi label="On trial" value={count('Trial')} sub={count('Trial') ? fmtL(ASSOC.filter(a => a.state === 'Trial').reduce((s, a) => s + a.annual, 0)) + ' a year if they convert' : 'No trial running'} onClick={() => setPlanFilter('All')} />
        <Kpi label="Suspended or pending" value={count('Suspended') + count('Pending')} sub="Not using the product" onClick={() => setPlanFilter('All')} hot={count('Suspended') + count('Pending') > 0} />
        <Kpi label="Renewing in 30 days" value={soon.length} sub={soon.length ? fmtL(soon.reduce((s, a) => s + a.annual, 0)) + ' of annual value' : 'Nothing due'} onClick={() => go('renewals')} hot={soon.length > 0} />
      </div>

      <div className="plan-row">
        {PLANS.map(p => {
          const on = ASSOC.filter(a => a.plan === p.key), value = on.filter(a => a.state === 'Active').reduce((s, a) => s + a.annual, 0);
          const share = ASSOC.length ? Math.round((on.length / ASSOC.length) * 100) : 0;
          return (
            <button key={p.key} className={'plan-card ' + p.key.toLowerCase() + (planFilter === p.key ? ' on' : '')} onClick={() => setPlanFilter(planFilter === p.key ? 'All' : p.key)} aria-pressed={planFilter === p.key}>
              <span className="pc-top"><b>{p.key}</b><i>{modulesOf(p.key).length} modules</i></span>
              <span className="pc-tag">{p.tag}</span>
              <span className="pc-nums"><span><b className="num">{on.length}</b>account{on.length === 1 ? '' : 's'}</span><span><b className="num">{fmtL(value)}</b>a year</span></span>
              <span className="pc-bar"><i style={{ width: share + '%' }} /></span>
              <span className="pc-foot">{share}% of subscriptions · {planFilter === p.key ? 'showing these — click to show all' : 'click to see them'}</span>
            </button>
          );
        })}
      </div>

      <div className="sub-stack">
        <DataList
          rows={ASSOC} rowKey={a => a.id} noun="subscription" minWidth={900}
          search={a => [a.n, a.city, a.plan, a.state, a.admin]} searchPlaceholder="Search by association, city, plan or contact"
          defaultSort={{ key: 'renewal', dir: 'asc' }} emptyAll={<>No subscriptions yet.<br /><button className="btn sm" style={{ marginTop: 10 }} onClick={create}><Plus size={14} /> New subscription</button></>}
          filters={[
            { key: 'plan', label: 'Plan', get: a => a.plan, options: ['Starter', 'Professional', 'Enterprise'] },
            { key: 'state', label: 'State', get: a => a.state, options: ['Active', 'Trial', 'Pending', 'Suspended'] },
            { key: 'billing', label: 'Billing', get: a => (a.billing === 'monthly' ? 'Monthly' : 'Yearly'), options: ['Yearly', 'Monthly'] },
            { key: 'due', label: 'Renewal', get: a => (a.state === 'Suspended' ? 'Suspended' : a.days < 0 ? 'Overdue' : a.days <= 30 ? 'Within 30 days' : a.days <= 90 ? 'Within 90 days' : 'Later'), options: ['Overdue', 'Within 30 days', 'Within 90 days', 'Later', 'Suspended'] },
          ]}
          csv={{ name: 'subscriptions', head: ['Association', 'City', 'Plan', 'State', 'Billing', 'Annual value', 'Renewal'], row: a => [a.n, a.city, a.plan, a.state, a.billing === 'monthly' ? 'Monthly' : 'Yearly', a.annual, a.renew] }}
          columns={[
            { key: 'name', label: 'Association', sort: a => a.n.toLowerCase(), stop: true, cell: a => <button className="a-cell" onClick={() => go('a360', a.id)}><span className="a-logo" style={{ background: a.c, color: a.tc }}>{a.ini}</span><span><b>{a.n}</b><i>{a.billing === 'monthly' ? 'Billed monthly' : 'Billed yearly'}</i></span></button> },
            { key: 'plan', label: 'Plan', dir: 'desc', sort: a => RANK[a.plan], cell: a => <span className={'plan-chip ' + a.plan.toLowerCase()}>{a.plan}</span> },
            { key: 'state', label: 'State', sort: a => a.state, cell: a => <Pill tone={stateTone(a.state)}>{a.state}</Pill> },
            { key: 'annual', label: 'Annual value', right: true, dir: 'desc', sort: a => a.annual, cell: a => <b className="num" style={{ color: 'var(--ink)' }}>{fmtL(a.annual)}</b> },
            { key: 'renewal', label: 'Renewal', sort: a => (a.state === 'Suspended' ? Infinity : a.days), cell: a => <span style={{ whiteSpace: 'nowrap' }}>{a.renew}<i className={'a-sub' + (a.days <= 30 && a.state !== 'Suspended' ? ' warn' : '')}>{a.trial ? 'trial ends ' : ''}{when(a)}</i></span> },
            { key: 'act', label: 'Actions', right: true, stop: true, cell: a => (
              <div className="row-acts">
                {a.state === 'Suspended'
                  ? <button className="btn sm good" onClick={() => manage(a, { step: 2, state: 'Active', title: 'Reactivate subscription' })}><PlayCircle size={14} /> Reactivate</button>
                  : <button className="btn sm soft" onClick={() => manage(a, { step: 1, renew: nextTerm(a), state: a.state === 'Trial' ? 'Active' : a.state, title: a.state === 'Trial' ? 'Convert trial to paid' : 'Renew subscription' })}><CalendarClock size={14} /> {a.state === 'Trial' ? 'Convert' : 'Renew'}</button>}
                <button className="btn sm" onClick={() => manage(a)}><Settings2 size={14} /> Manage</button>
                {a.state !== 'Suspended' && <button className="icon-act danger" title="Suspend" aria-label={`Suspend ${a.n}`} onClick={() => manage(a, { step: 2, state: 'Suspended', title: 'Suspend subscription' })}><PauseCircle size={16} /></button>}
              </div>
            ) },
          ]}
        />
        <div className="panel" style={{ marginTop: 14 }}>
          <div className="panel-h"><div><h3>Recent changes</h3><div className="p-sub" style={{ marginBottom: 0 }}>Plan moves, activations and suspensions</div></div></div>
          {history.length ? (
            <div className="feed">{history.map((f, i) => <div key={i} className="fi"><span className="who">{f.who}</span><span>{f.what}</span><span className="when">{f.when}</span></div>)}</div>
          ) : <div className="empty" style={{ padding: '22px 0' }}>No subscription has been changed yet. Changes you make here are recorded with who made them and why.</div>}
        </div>
      </div>
    </>
  );
}
