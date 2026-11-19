import { KeyRound, Trash2, UserPlus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { DataList } from '../components/DataList';
import { Kpi, PageHead, Pill } from '../components/ui';
import { initials } from '../data/portal';
import * as live from '../lib/live';
import { usePortal } from '../store/context';
import { Alert, Busy } from './AccountActions';

/* Super admins: the people who can sign in to this portal. Any of them can add another, give a
   colleague a new password when theirs is lost, or remove one — but never themselves, and never the last. */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const since = iso => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

function PasswordFields({ value, again, onValue, onAgain, label = 'Password' }) {
  return (
    <>
      <label className="fl">{label}<input className="in" type="password" value={value} onChange={e => onValue(e.target.value)} autoComplete="new-password" maxLength={100} /></label>
      <label className="fl">Type it again<input className="in" type="password" value={again} onChange={e => onAgain(e.target.value)} autoComplete="new-password" maxLength={100} /></label>
    </>
  );
}
const passwordError = (p, again) => (p.length < 8 ? 'A password needs at least 8 characters.' : p !== again ? 'The two passwords don’t match.' : '');

function AddAdmin({ onDone }) {
  const { closeModal, toast } = usePortal();
  const [f, setF] = useState({ name: '', email: '', title: '' });
  const [pw, setPw] = useState(''), [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const submit = async e => {
    e.preventDefault();
    const name = f.name.trim(), email = f.email.trim();
    const err = name.length < 2 ? 'Enter their name.' : !EMAIL_RE.test(email) ? 'Enter their email address — they sign in with it.' : passwordError(pw, again);
    setError(err);
    if (err || busy) return;
    setBusy(true);
    try {
      await live.addOperator({ name, email, password: pw, ...(f.title.trim() ? { title: f.title.trim() } : {}) });
      await onDone();
      closeModal();
      toast(name + ' added', 'They can sign in to this portal now. Give them the password yourself — it is not emailed.', 'check_mark_button');
    } catch (e2) { setError(e2?.message ?? 'Something went wrong.'); setBusy(false); }
  };
  return (
    <form onSubmit={submit} noValidate>
      <h2>Add a super admin</h2>
      <div className="msub">A super admin can do everything in this portal: onboard and remove societies, change plans and prices, and add or remove other super admins.</div>
      <Alert>{error}</Alert>
      <div className="form-grid">
        <label className="fl">Full name<input className="in" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} maxLength={80} autoFocus /></label>
        <label className="fl">Job title <i>(optional)</i><input className="in" value={f.title} onChange={e => setF({ ...f, title: e.target.value })} maxLength={60} placeholder="Platform operator" /></label>
        <label className="fl wide">Email<input className="in" type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} maxLength={120} autoComplete="off" /></label>
        <PasswordFields value={pw} again={again} onValue={setPw} onAgain={setAgain} label="Their first password" />
      </div>
      <div className="f-note">Ask them to change this password after their first sign-in, from this page.</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <button className="btn" type="submit" disabled={busy}><Busy busy={busy}>Add super admin</Busy></button>
        <button className="btn ghost" type="button" onClick={closeModal}>Cancel</button>
      </div>
    </form>
  );
}

/** `who` is another super admin (a reset) or absent (changing your own, which asks for the current one). */
function SetPassword({ who }) {
  const { closeModal, toast } = usePortal();
  const [current, setCurrent] = useState('');
  const [pw, setPw] = useState(''), [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const submit = async e => {
    e.preventDefault();
    const err = !who && !current ? 'Enter your current password.' : passwordError(pw, again);
    setError(err);
    if (err || busy) return;
    setBusy(true);
    try {
      if (who) await live.resetOperatorPassword(who.id, pw); else await live.changePassword(current, pw);
      closeModal();
      toast(who ? 'New password set for ' + who.name : 'Your password is changed', who ? 'They have been signed out everywhere. Give them the new password yourself.' : 'Use the new one the next time you sign in.', 'check_mark_button');
    } catch (e2) { setError(e2?.message ?? 'Something went wrong.'); setBusy(false); }
  };
  return (
    <form onSubmit={submit} noValidate>
      <h2>{who ? 'Reset password for ' + who.name : 'Change my password'}</h2>
      <div className="msub">{who ? 'Use this when a colleague has lost their password. They are signed out on every device, and two-step sign-in is switched off until they set it up again.' : 'You stay signed in here. Other devices keep working until their session ends.'}</div>
      <Alert>{error}</Alert>
      <div className="form-grid">
        {!who && <label className="fl wide">Current password<input className="in" type="password" value={current} onChange={e => setCurrent(e.target.value)} autoComplete="current-password" autoFocus /></label>}
        <PasswordFields value={pw} again={again} onValue={setPw} onAgain={setAgain} label="New password" />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <button className="btn" type="submit" disabled={busy}><Busy busy={busy}>{who ? 'Set new password' : 'Change password'}</Busy></button>
        <button className="btn ghost" type="button" onClick={closeModal}>Cancel</button>
      </div>
    </form>
  );
}

function RemoveAdmin({ who, onDone }) {
  const { closeModal, toast } = usePortal();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const remove = async () => {
    setBusy(true);
    try {
      await live.removeOperator(who.id);
      await onDone();
      closeModal();
      toast(who.name + ' removed', 'They are signed out and can no longer open this portal.', 'check_mark_button');
    } catch (e2) { setError(e2?.message ?? 'Something went wrong.'); setBusy(false); }
  };
  return (
    <>
      <h2>Remove {who.name}?</h2>
      <div className="msub">They are signed out at once and can no longer open this portal. Everything they did stays in the activity record under their name.</div>
      <Alert>{error}</Alert>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn danger" onClick={remove} disabled={busy}><Busy busy={busy}>Remove super admin</Busy></button>
        <button className="btn ghost" onClick={closeModal}>Keep</button>
      </div>
    </>
  );
}

export function Team() {
  const { openModal } = usePortal();
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try { setList(await live.operators()); setError(''); } catch (e) { setError(e?.message ?? 'Couldn’t load the team.'); }
  }, []);
  // oxlint-disable-next-line react/set-state-in-effect -- reads from the server; state is set when it answers
  useEffect(() => { void load(); }, [load]);
  const rows = list ?? [], add = () => openModal(<AddAdmin onDone={load} />);

  return (
    <>
      <PageHead crumb="Administration" title="Team">
        The people who can sign in to this portal. <b>Every super admin has full control</b>, so add only people who should be able to change plans, prices and societies.
      </PageHead>

      <div className="kpis">
        <Kpi label="Super admins" value={rows.length} sub="can sign in to this portal" />
        <Kpi label="With two-step sign-in" value={rows.filter(o => o.twoStep).length} sub={rows.some(o => !o.twoStep) ? rows.filter(o => !o.twoStep).length + ' rely on a password alone' : 'everyone is protected'} hot={rows.some(o => !o.twoStep)} />
      </div>

      {error && <Alert>{error}</Alert>}
      <DataList
        rows={rows} rowKey={o => o.id} noun="super admin" minWidth={760} local
        search={o => [o.name, o.email, o.title]} searchPlaceholder="Search by name or email"
        defaultSort={{ key: 'name', dir: 'asc' }} emptyAll={list ? 'No super admins found.' : 'Loading…'}
        actions={<><button className="btn sm soft" onClick={() => openModal(<SetPassword />)}><KeyRound size={14} /> Change my password</button><button className="btn sm" onClick={add}><UserPlus size={14} /> Add super admin</button></>}
        columns={[
          { key: 'name', label: 'Name', sort: o => o.name.toLowerCase(), cell: o => <div className="a-cell"><span className="mgr-av">{initials(o.name)}</span><span><b>{o.name}{o.me && <> <Pill tone="sky">You</Pill></>}</b><i>{o.title || 'Platform operator'}</i></span></div> },
          { key: 'email', label: 'Signs in with', sort: o => o.email, cell: o => o.email },
          { key: 'two', label: 'Two-step sign-in', sort: o => (o.twoStep ? 1 : 0), cell: o => <Pill tone={o.twoStep ? 'good' : 'dim'}>{o.twoStep ? 'On' : 'Off'}</Pill> },
          { key: 'since', label: 'Added', dir: 'desc', sort: o => o.since, cell: o => since(o.since) },
          { key: 'act', label: 'Actions', right: true, cell: o => (
            <div className="row-acts">
              {o.me ? <button className="btn sm soft" onClick={() => openModal(<SetPassword />)}><KeyRound size={13} /> Change password</button>
                : <>
                  <button className="btn sm soft" onClick={() => openModal(<SetPassword who={o} />)}><KeyRound size={13} /> Reset password</button>
                  <button className="icon-act danger" onClick={() => openModal(<RemoveAdmin who={o} onDone={load} />)} aria-label={'Remove ' + o.name} title="Remove"><Trash2 size={15} /></button>
                </>}
            </div>
          ) },
        ]}
      />
    </>
  );
}
