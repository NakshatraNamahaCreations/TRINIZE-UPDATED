import { ChevronDown, CircleAlert, LoaderCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { factFields } from '../lib/live';
import { usePortal } from '../store/context';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const inDays = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

/** Connected mode: create a society, its subscription and (optionally) the first login for its console. */
export function Onboard() {
  const { onboardAssociation, closeModal } = usePortal();
  const [f, setF] = useState({
    name: '', city: '', kind: 'Apartment', plan: 'Professional', state: 'Trial', plots: '', annualAmount: '', renewsAt: inDays(30),
    adminName: '', adminRole: 'Secretary', adminPhone: '', adminEmail: '', adminPassword: '',
  });
  /* timings and rules: optional, and whatever is filled in becomes the first documents the society's assistant answers from */
  const [fields, setFields] = useState([]);
  const [facts, setFacts] = useState({});
  const [showFacts, setShowFacts] = useState(false);
  useEffect(() => { factFields().then(setFields).catch(() => {}); }, []);
  const filled = Object.values(facts).filter(v => v.trim()).length;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = k => e => setF(v => ({ ...v, [k]: e.target.value }));
  const digits = k => e => setF(v => ({ ...v, [k]: e.target.value.replace(/\D/g, '') }));

  const submit = async e => {
    e.preventDefault();
    const err = f.name.trim().length < 3 ? 'Enter the association’s name.'
      : f.city.trim().length < 2 ? 'Enter the city.'
      : !Number(f.plots) ? 'Enter how many plots or flats it has.'
      : f.annualAmount === '' ? 'Enter the annual contract value (0 is allowed for a free trial).'
      : !f.renewsAt ? 'Pick the date the trial ends or the subscription renews.'
      : f.adminName.trim().length < 2 ? 'Enter the name of the society’s admin.'
      : !EMAIL_RE.test(f.adminEmail.trim()) ? 'Enter the admin’s email address.'
      : f.adminPassword && f.adminPassword.length < 8 ? 'The console password needs at least 8 characters.' : '';
    setError(err);
    if (err || busy) return;
    setBusy(true);
    const failed = await onboardAssociation({
      name: f.name.trim(), city: f.city.trim(), kind: f.kind, plan: f.plan, state: f.state, plots: Number(f.plots), annualAmount: Number(f.annualAmount),
      renewsAt: new Date(f.renewsAt + 'T00:00:00').toISOString(),
      admin: { name: f.adminName.trim(), role: f.adminRole.trim() || 'Secretary', phone: f.adminPhone.trim(), email: f.adminEmail.trim() },
      ...(f.adminPassword ? { adminPassword: f.adminPassword } : {}),
      facts: Object.fromEntries(Object.entries(facts).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v)),
    });
    if (failed) { setError(failed); setBusy(false); }
  };

  return (
    <form onSubmit={submit} noValidate>
      <h2>Onboard an association</h2>
      <div className="msub">Creates the account and its subscription. Homes and residents are then added by the society’s admin in the society console.</div>
      {error && <div className="form-alert bad" role="alert"><CircleAlert size={16} />{error}</div>}

      <div className="form-grid">
        <label className="fl wide">Association name<input className="in" value={f.name} onChange={set('name')} maxLength={80} autoFocus /></label>
        <label className="fl">City<input className="in" value={f.city} onChange={set('city')} maxLength={60} /></label>
        <label className="fl">Type<select className="in" value={f.kind} onChange={set('kind')}>{['Apartment', 'Villa', 'Plotted', 'Mixed'].map(k => <option key={k}>{k}</option>)}</select></label>
        <label className="fl">Plots / flats<input className="in num" inputMode="numeric" value={f.plots} onChange={digits('plots')} /></label>
        <label className="fl">Plan<select className="in" value={f.plan} onChange={set('plan')}>{['Starter', 'Professional', 'Enterprise'].map(k => <option key={k}>{k}</option>)}</select></label>
        <label className="fl">Starts as<select className="in" value={f.state} onChange={set('state')}><option value="Trial">Trial</option><option value="Active">Active (paying)</option><option value="Pending">Pending verification</option></select></label>
        <label className="fl">Annual value (₹)<input className="in num" inputMode="numeric" value={f.annualAmount} onChange={digits('annualAmount')} /></label>
        <label className="fl wide">{f.state === 'Trial' ? 'Trial ends on' : 'Renews on'}<input className="in" type="date" value={f.renewsAt} onChange={set('renewsAt')} /></label>
      </div>

      <div className="fl" style={{ margin: '16px 0 8px' }}>The society’s admin</div>
      <div className="form-grid">
        <label className="fl">Name<input className="in" value={f.adminName} onChange={set('adminName')} maxLength={80} /></label>
        <label className="fl">Role<input className="in" value={f.adminRole} onChange={set('adminRole')} maxLength={40} /></label>
        <label className="fl">Email<input className="in" type="email" value={f.adminEmail} onChange={set('adminEmail')} maxLength={120} /></label>
        <label className="fl">Phone <i>(optional)</i><input className="in" value={f.adminPhone} onChange={set('adminPhone')} maxLength={20} /></label>
        <label className="fl wide">Console password <i>(optional — leave empty to create no login yet)</i>
          <input className="in" type="text" value={f.adminPassword} onChange={set('adminPassword')} maxLength={100} autoComplete="off" placeholder="At least 8 characters — share it with them yourself" />
        </label>
      </div>

      {fields.length > 0 && (
        <>
          <button type="button" className="btn ghost" style={{ marginTop: 16, width: '100%', justifyContent: 'space-between' }} onClick={() => setShowFacts(v => !v)} aria-expanded={showFacts}>
            <span>Timings and rules for the resident assistant <i style={{ fontWeight: 400 }}>(optional{filled ? ` · ${filled} filled in` : ''})</i></span>
            <ChevronDown size={16} style={{ transform: showFacts ? 'rotate(180deg)' : 'none' }} />
          </button>
          {showFacts && (
            <>
              <div className="msub" style={{ margin: '8px 0' }}>What residents ask most. Anything filled in here is what the assistant answers from on day one; the society’s admin can change it later under AI controls. Leave a line empty if you don’t know it.</div>
              <div className="form-grid">
                {fields.map(x => (
                  <label key={x.key} className={'fl' + (x.key === 'other' ? ' wide' : '')}>{x.label}
                    {x.key === 'other'
                      ? <textarea className="in" rows={3} maxLength={2000} value={facts[x.key] ?? ''} onChange={e => setFacts(v => ({ ...v, [x.key]: e.target.value }))} placeholder={x.hint} />
                      : <input className="in" maxLength={300} value={facts[x.key] ?? ''} onChange={e => setFacts(v => ({ ...v, [x.key]: e.target.value }))} placeholder={'e.g. ' + x.hint} />}
                  </label>
                ))}
              </div>
            </>
          )}
        </>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
        <button className="btn" type="submit" disabled={busy}>{busy ? <><LoaderCircle size={15} className="spin" /> Creating…</> : 'Onboard association'}</button>
        <button className="btn ghost" type="button" onClick={closeModal}>Cancel</button>
      </div>
    </form>
  );
}
