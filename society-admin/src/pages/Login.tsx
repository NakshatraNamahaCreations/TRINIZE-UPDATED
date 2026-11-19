import { ArrowRight, CircleNotch, EnvelopeSimple, Eye, EyeSlash, Heart, Key, LockSimple, ShieldCheck, Sparkle, Ticket, WarningCircle } from '@phosphor-icons/react';
import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { DEMO_ACCOUNT, useAuth } from '../auth/auth-context';
import { useToast } from '../components/toast-context';
import { LIVE } from '../lib/api';
import { SOCIETY } from '../store/data';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FEATURES = [
  { icon: Ticket, t: 'Issues with SLAs', s: 'Every request tracked from report to resolved' },
  { icon: ShieldCheck, t: 'Moderation with reasons', s: 'Every decision explained and audited' },
  { icon: Sparkle, t: 'AI that suggests', s: 'People decide — nothing happens on its own' },
];

export function Login() {
  const { user, signIn } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const loc = useLocation();
  const from = (loc.state as { from?: string } | null)?.from ?? '/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (user) return <Navigate to={from} replace />;

  const emailErr = touched && !EMAIL_RE.test(email.trim()) ? 'Enter a valid email address.' : '';
  const pwErr = touched && password.length < 6 ? 'Password must be at least 6 characters.' : '';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setError('');
    if (!EMAIL_RE.test(email.trim()) || password.length < 6) return;
    setBusy(true);
    const res = await signIn(email, password, remember);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    toast('Welcome back', LIVE ? 'Signed in to your society’s console' : 'Signed in to ' + SOCIETY.name);
    nav(from, { replace: true });
  };

  const useDemo = () => {
    setEmail(DEMO_ACCOUNT.email);
    setPassword(DEMO_ACCOUNT.password);
    setError('');
  };

  return (
    <div className="login">
      <aside className="login-art">
        <div className="orb o1" /><div className="orb o2" />
        <div className="login-brand">
          <div className="mark"><Heart size={18} weight="fill" color="#fff" /></div>
          <div><b>Trinize</b><span>Community platform</span></div>
        </div>
        <div className="login-copy">
          <div className="eyebrow">Society admin console</div>
          <h1>Run your community from one calm console.</h1>
          <p>Issues, moderation, announcements, events and the AI assistant for {LIVE ? 'your society' : SOCIETY.name} — in one place, every action audited.</p>
          <ul>
            {FEATURES.map(f => (
              <li key={f.t}>
                <span className="fi"><f.icon size={17} /></span>
                <div><b>{f.t}</b><span>{f.s}</span></div>
              </li>
            ))}
          </ul>
        </div>
        <div className="login-foot">{LIVE ? 'Staff only · every action is recorded in the audit log' : 'Demo environment · all names and records are fictional'}</div>
      </aside>

      <main className="login-main">
        <form className="login-card" onSubmit={submit} noValidate>
          <div className="login-brand mobile">
            <div className="mark"><Heart size={16} weight="fill" color="#fff" /></div>
            <div><b>Trinize</b><span>Society admin</span></div>
          </div>
          <h2>Welcome back</h2>
          <p className="lede">{LIVE ? 'Sign in to your society’s admin console.' : `Sign in to the ${SOCIETY.name} admin console.`}</p>

          {error && <div className="alert" role="alert"><WarningCircle size={16} />{error}</div>}

          <label className="field">
            <span>Email</span>
            <div className={'ctl' + (emailErr ? ' bad' : '')}>
              <EnvelopeSimple size={16} />
              <input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="you@society.in" aria-invalid={!!emailErr} autoFocus />
            </div>
            {emailErr && <em>{emailErr}</em>}
          </label>

          <label className="field">
            <span className="row">Password<button type="button" className="link" onClick={() => toast('Password reset is sent by the platform team', 'In the real build you sign in with a one-time code to your registered phone.')}>Forgot password?</button></span>
            <div className={'ctl' + (pwErr ? ' bad' : '')}>
              <LockSimple size={16} />
              <input type={show ? 'text' : 'password'} autoComplete="current-password" value={password}
                onChange={e => setPassword(e.target.value)} placeholder="Your password" aria-invalid={!!pwErr} />
              <button type="button" className="eye" onClick={() => setShow(s => !s)} aria-label={show ? 'Hide password' : 'Show password'}>
                {show ? <EyeSlash size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {pwErr && <em>{pwErr}</em>}
          </label>

          <label className="chk"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />Keep me signed in on this device</label>

          <button className="a-btn lg" type="submit" disabled={busy}>
            {busy ? <><CircleNotch size={16} className="spin" />Signing in…</> : <>Sign in<ArrowRight size={16} /></>}
          </button>

          {/* the one-click demo sign-in belongs to the demo only; connected, people use their own accounts */}
          {!LIVE && (
            <>
              <div className="or"><span>or</span></div>
              <button type="button" className="a-btn ghost lg" onClick={useDemo}><Key size={16} />Use the demo account</button>

              <div className="demo-creds">
                <b>Demo credentials</b>
                <span>{DEMO_ACCOUNT.email}</span>
                <span>{DEMO_ACCOUNT.password}</span>
              </div>
            </>
          )}
        </form>
      </main>
    </div>
  );
}
