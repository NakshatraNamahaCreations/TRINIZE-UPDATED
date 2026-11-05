import { ArrowRight, CircleAlert, Eye, EyeOff, Info, LoaderCircle, Lock, Mail, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { Icon3D } from '../components/Icon3D';
import { ASSOC, bandColor, DEMO_LOGIN, fmtL, health, MRR } from '../data/portal';
import { useAuth } from '../store/context';

const FEATURES = [
  ['bullseye', 'Decisions, not dashboards', 'The four things that need you today, ranked by money at risk.'],
  ['chart_increasing', 'Every account health-scored', 'Adoption, payments, usage trend and tickets in one transparent model.'],
  ['shield', 'Suggest-only copilot', 'Drafts the email and explains the numbers — never acts on its own.'],
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Small live preview of the portal on the brand panel, from the same demo records. */
function Preview() {
  const growth = Math.round((MRR[11] / MRR[0] - 1) * 100);
  const top = ASSOC.map(a => ({ a, h: health(a) })).sort((p, q) => q.h.score - p.h.score).slice(0, 4);
  return (
    <div className="auth-preview" aria-hidden="true">
      <div className="ap-card">
        <span className="ap-l">Monthly recurring revenue</span>
        <b className="ap-v num">{fmtL(MRR[11])}</b>
        <span className="ap-up"><TrendingUp size={13} /> {growth}% over 12 months</span>
      </div>
      <div className="ap-card">
        <span className="ap-l">Portfolio health</span>
        {top.map(({ a, h }) => (
          <div key={a.id} className="ap-row">
            <span>{a.n.split(' ').slice(0, 2).join(' ')}</span>
            <i><em style={{ width: h.score + '%', background: bandColor(h.band) }} /></i>
            <b className="num" style={{ color: bandColor(h.band) }}>{h.score}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Login() {
  const { session, signIn } = useAuth();
  const navigate = useNavigate();
  const from = useLocation().state?.from ?? '/';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [showPw, setShowPw] = useState(false);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  if (session) return <Navigate to={from} replace />;

  const emailErr = !email.trim() ? 'Enter your work email' : !EMAIL_RE.test(email.trim()) ? 'That doesn’t look like an email address' : '';
  const pwErr = !password ? 'Enter your password' : '';

  const submit = async e => {
    e.preventDefault();
    setTried(true);
    setError('');
    if (emailErr || pwErr || busy) return;
    setBusy(true);
    const err = await signIn(email, password, remember);
    setBusy(false);
    if (err) setError(err);
    else navigate(from, { replace: true });
  };

  const fillDemo = () => {
    setEmail(DEMO_LOGIN.email);
    setPassword(DEMO_LOGIN.password);
    setError('');
    setNote('');
  };

  return (
    <div className="auth">
      <section className="auth-brand">
        <div className="ab-glow g1" /><div className="ab-glow g2" />
        <div className="ab-top">
          <div className="logo-t">T</div>
          <div><b>TRINIZE</b><span>OWNER PORTAL 2.0</span></div>
        </div>
        <div className="ab-mid">
          <span className="ab-eyebrow">For platform operators</span>
          <h2>Run the business,<br />not the spreadsheet.</h2>
          <p>Renewals, collections, account health and support across every association you serve — in one place.</p>
          <ul className="ab-feats">
            {FEATURES.map(([icon, t, s]) => (
              <li key={t}><span className="ab-ic"><Icon3D name={icon} size={26} /></span><div><b>{t}</b><span>{s}</span></div></li>
            ))}
          </ul>
          <Preview />
        </div>
        <div className="ab-foot">Concept UI · fictional demo data · nothing is stored or sent</div>
      </section>

      <section className="auth-main">
        <form className="auth-card" onSubmit={submit} noValidate>
          <div className="ac-logo"><div className="logo-t">T</div><b>TRINIZE</b></div>
          <Icon3D name="office_building" size={52} className="ac-hero" />
          <h1>Welcome back</h1>
          <p className="ac-sub">Sign in to the Trinize owner portal</p>

          <div className="demo-box">
            <Icon3D name="key" size={28} />
            <div>
              <b>Demo account</b>
              <span className="num">{DEMO_LOGIN.email} · {DEMO_LOGIN.password}</span>
            </div>
            <button type="button" className="btn sm soft" onClick={fillDemo}>Fill in</button>
          </div>

          {error && <div className="form-alert bad" role="alert"><CircleAlert size={16} />{error}</div>}
          {note && <div className="form-alert info"><Info size={16} />{note}</div>}

          <label className="field">
            <span className="f-l">Work email</span>
            <span className={'f-in' + (tried && emailErr ? ' err' : '')}>
              <Mail size={16} />
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@trinize.com" autoComplete="username" autoFocus />
            </span>
            {tried && emailErr && <span className="f-err">{emailErr}</span>}
          </label>

          <label className="field">
            <span className="f-l">
              Password
              <button type="button" className="link" onClick={() => setNote('Password resets are handled by your Trinize administrator in this demo.')}>Forgot password?</button>
            </span>
            <span className={'f-in' + (tried && pwErr ? ' err' : '')}>
              <Lock size={16} />
              <input type={showPw ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
              <button type="button" className="f-eye" onClick={() => setShowPw(v => !v)} aria-label={showPw ? 'Hide password' : 'Show password'}>
                {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </span>
            {tried && pwErr && <span className="f-err">{pwErr}</span>}
          </label>

          <label className="check">
            <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
            <span>Keep me signed in on this device</span>
          </label>

          <button className="btn auth-submit" type="submit" disabled={busy}>
            {busy ? <><LoaderCircle size={16} className="spin" /> Signing in…</> : <>Sign in <ArrowRight size={16} /></>}
          </button>

          <p className="ac-foot">Need access? Ask your Trinize administrator to invite you.</p>
        </form>
      </section>
    </div>
  );
}
