import { CircleAlert, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { ASSOC, findAssoc, fmtI } from '../data/portal';
import * as live from '../lib/live';
import { usePortal } from '../store/context';

/* What the super admin does to one account outside its subscription: bill it, correct its details, remove it. */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const KINDS = ['Apartment', 'Villa', 'Plotted', 'Mixed'];
const ymd = d => new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
const longDay = d => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

export function Busy({ busy, children }) {
  return busy ? <><LoaderCircle size={15} className="spin" /> Saving…</> : children;
}
export function Alert({ children }) {
  return children ? <div className="form-alert bad" role="alert"><CircleAlert size={16} />{children}</div> : null;
}

/** Bill a society. `id` fixes the society (from its own page); without it the operator picks one. */
export function RaiseInvoice({ id }) {
  const { closeModal, reload, toast } = usePortal();
  const billable = ASSOC.slice().sort((a, b) => a.n.localeCompare(b.n));
  const [aid, setAid] = useState(id ?? '');
  const a = findAssoc(aid);
  const [amount, setAmount] = useState('');
  const [touched, setTouched] = useState(false);
  const [due, setDue] = useState(() => ymd(new Date(Date.now() + 15 * 864e5)));
  const [today] = useState(() => ymd(new Date()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // until the operator types an amount, offer the society's own price for one billing period
  const period = a ? (a.billing === 'monthly' ? Math.round(a.annual / 12) : a.annual) : 0;
  const shown = touched ? amount : period ? String(period) : '';
  const n = Number(shown);

  const submit = async e => {
    e.preventDefault();
    const err = !a ? 'Choose the society to bill.' : !n ? 'Enter the amount to bill.' : !due ? 'Choose the date payment is due.' : '';
    setError(err);
    if (err || busy) return;
    setBusy(true);
    try {
      const inv = await live.issueInvoice(a.id, n, new Date(due + 'T23:59:00+05:30').toISOString());
      await reload();
      closeModal();
      toast('Invoice ' + inv.number + ' raised', `${fmtI(n)} · ${a.n} · due ${longDay(due)}. It is now in Collections.`, 'check_mark_button');
    } catch (e2) { setError(e2?.message ?? 'Something went wrong.'); setBusy(false); }
  };

  return (
    <form onSubmit={submit} noValidate>
      <h2>Raise an invoice</h2>
      <div className="msub">Bills a society for its subscription. The invoice appears in Collections and on the society’s page, where you record the payment when it arrives.</div>
      <Alert>{error}</Alert>
      <div className="form-grid">
        <label className="fl wide">Society
          {id ? <input className="in" value={a?.n ?? ''} disabled />
            : <select className="in" value={aid} onChange={e => { setAid(e.target.value); setTouched(false); }} autoFocus>
              <option value="">Choose a society…</option>
              {billable.map(x => <option key={x.id} value={x.id}>{x.n} · {x.plan} · {x.state}</option>)}
            </select>}
        </label>
        <label className="fl">Amount (₹)
          <input className="in num" inputMode="numeric" value={shown} onChange={e => { setTouched(true); setAmount(e.target.value.replace(/\D/g, '').slice(0, 9)); }} placeholder="0" />
        </label>
        <label className="fl">Payment due on
          <input className="in" type="date" value={due} min={today} onChange={e => setDue(e.target.value)} />
        </label>
      </div>
      {a && <div className="f-note">{a.n} is on {a.plan}, billed {a.billing}: {fmtI(a.annual)} a year{a.billing === 'monthly' ? `, ${fmtI(Math.round(a.annual / 12))} a month` : ''}.{a.state === 'Trial' ? ' It is still on trial.' : a.state === 'Suspended' ? ' It is suspended.' : ''}</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <button className="btn" type="submit" disabled={busy}><Busy busy={busy}>{n ? 'Raise invoice for ' + fmtI(n) : 'Raise invoice'}</Busy></button>
        <button className="btn ghost" type="button" onClick={closeModal}>Cancel</button>
      </div>
    </form>
  );
}

/** Correct a society's name, place, size or contact after it was onboarded. */
export function EditSociety({ id }) {
  const { closeModal, reload, toast } = usePortal();
  const a = findAssoc(id);
  const blank = v => (v === '—' ? '' : v ?? '');
  const [was] = useState(() => (a ? { name: a.n, city: a.city, kind: a.type, plots: String(a.plots), registration: blank(a.reg), address: blank(a.addr), adminName: blank(a.admin), adminRole: blank(a.role), adminPhone: blank(a.ph), adminEmail: blank(a.em) } : {}));
  const [f, setF] = useState(was);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!a) return null;
  const set = k => e => setF({ ...f, [k]: e.target.value });

  const submit = async e => {
    e.preventDefault();
    const changed = Object.fromEntries(Object.keys(f).filter(k => String(f[k]).trim() !== String(was[k]).trim()).map(k => [k, k === 'plots' ? Number(f[k]) : String(f[k]).trim()]));
    const err = f.name.trim().length < 3 ? 'Enter the society’s name.'
      : f.city.trim().length < 2 ? 'Enter the city.'
      : !Number(f.plots) ? 'Enter how many plots or flats the society has.'
      : f.adminName.trim().length < 2 ? 'Enter the contact person’s name.'
      : !EMAIL_RE.test(f.adminEmail.trim()) ? 'Enter the contact’s email address — payment reminders go there.'
      : !Object.keys(changed).length ? 'Nothing has been changed yet.' : '';
    setError(err);
    if (err || busy) return;
    setBusy(true);
    try {
      await live.updateAssociation(id, changed);
      await reload();
      closeModal();
      toast('Details saved', f.name.trim(), 'check_mark_button');
    } catch (e2) { setError(e2?.message ?? 'Something went wrong.'); setBusy(false); }
  };

  return (
    <form onSubmit={submit} noValidate>
      <h2>Edit society details</h2>
      <div className="msub">Corrects what was entered at onboarding. The plan, price and renewal date are changed under Manage subscription.</div>
      <Alert>{error}</Alert>
      <div className="form-grid">
        <label className="fl wide">Society name<input className="in" value={f.name} onChange={set('name')} maxLength={80} autoFocus /></label>
        <label className="fl">City<input className="in" value={f.city} onChange={set('city')} maxLength={60} /></label>
        <label className="fl">Type<select className="in" value={f.kind} onChange={set('kind')}>{KINDS.map(k => <option key={k}>{k}</option>)}</select></label>
        <label className="fl">Plots or flats<input className="in num" inputMode="numeric" value={f.plots} onChange={e => setF({ ...f, plots: e.target.value.replace(/\D/g, '').slice(0, 6) })} /></label>
        <label className="fl">Registration number <i>(optional)</i><input className="in" value={f.registration} onChange={set('registration')} maxLength={60} /></label>
        <label className="fl wide">Registered address <i>(optional)</i><input className="in" value={f.address} onChange={set('address')} maxLength={200} /></label>
        <label className="fl">Contact person<input className="in" value={f.adminName} onChange={set('adminName')} maxLength={80} /></label>
        <label className="fl">Their role<input className="in" value={f.adminRole} onChange={set('adminRole')} maxLength={40} placeholder="Secretary" /></label>
        <label className="fl">Contact phone<input className="in num" value={f.adminPhone} onChange={set('adminPhone')} maxLength={20} /></label>
        <label className="fl">Contact email<input className="in" type="email" value={f.adminEmail} onChange={set('adminEmail')} maxLength={120} /></label>
      </div>
      <div className="f-note">Changing the contact here changes who receives reminders. It does not change anyone’s console login.</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <button className="btn" type="submit" disabled={busy}><Busy busy={busy}>Save details</Busy></button>
        <button className="btn ghost" type="button" onClick={closeModal}>Cancel</button>
      </div>
    </form>
  );
}

/** Remove a society and everything under it. The name must be typed, because there is no undo. */
export function RemoveSociety({ id }) {
  const { closeModal, reload, toast } = usePortal();
  const navigate = useNavigate();
  const a = findAssoc(id);
  const [name] = useState(a?.n ?? '');
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!name) return null;

  const remove = async e => {
    e.preventDefault();
    if (typed.trim() !== name || busy) return;
    setBusy(true);
    try {
      await live.removeAssociation(id, typed.trim());
      closeModal();
      navigate('/associations');
      await reload();
      toast(name + ' removed', 'The society and all of its records are gone.', 'check_mark_button');
    } catch (e2) { setError(e2?.message ?? 'Something went wrong.'); setBusy(false); }
  };

  return (
    <form onSubmit={remove} noValidate>
      <h2>Remove {name}?</h2>
      <div className="msub">
        This deletes the society and <b>everything recorded under it</b>: its plots, residents’ memberships, bills and payments, complaints, visitors, notices, invoices and support issues. Its office staff lose their console login. <b>It cannot be undone.</b>
      </div>
      <div className="f-note" style={{ marginTop: 0, marginBottom: 12 }}>If the society has only stopped paying, suspend its subscription instead — that keeps the records.</div>
      <Alert>{error}</Alert>
      <label className="fl">Type the society’s name to confirm
        <input className="in" value={typed} onChange={e => setTyped(e.target.value)} placeholder={name} autoFocus autoComplete="off" />
      </label>
      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <button className="btn danger" type="submit" disabled={typed.trim() !== name || busy}><Busy busy={busy}>Remove society for good</Busy></button>
        <button className="btn ghost" type="button" onClick={closeModal}>Keep it</button>
      </div>
    </form>
  );
}
