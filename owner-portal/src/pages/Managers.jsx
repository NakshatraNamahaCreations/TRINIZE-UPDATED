import { CircleAlert, LoaderCircle, Pencil, Star, Trash2, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { DataList } from '../components/DataList';
import { Kpi, PageHead, Pill } from '../components/ui';
import { ASSOC, initials } from '../data/portal';
import { usePortal } from '../store/context';

const PHONE_RE = /^[6-9]\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The societies a manager looks after, as tick boxes. */
function SocietyPicker({ value, onChange }) {
  const toggle = id => onChange(value.includes(id) ? value.filter(x => x !== id) : [...value, id]);
  return (
    <div className="soc-pick" role="group" aria-label="Societies">
      {ASSOC.map(a => (
        <label key={a.id} className={'soc-opt' + (value.includes(a.id) ? ' on' : '')}>
          <input type="checkbox" checked={value.includes(a.id)} onChange={() => toggle(a.id)} />
          <span className="logo" style={{ background: a.c, color: a.tc }}>{a.ini}</span>
          <span style={{ minWidth: 0 }}><b>{a.n}</b><i>{a.city} · {a.plots.toLocaleString('en-IN')} plots{a.state !== 'Active' ? ' · ' + a.state : ''}</i></span>
        </label>
      ))}
    </div>
  );
}

function Busy({ busy, children }) {
  return busy ? <><LoaderCircle size={15} className="spin" /> Saving…</> : children;
}

function AddManager() {
  const { createManager, closeModal } = usePortal();
  const [f, setF] = useState({ name: '', phone: '', email: '' });
  const [soc, setSoc] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async e => {
    e.preventDefault();
    const name = f.name.trim(), email = f.email.trim();
    const err = name.length < 2 ? 'Enter the manager’s name.'
      : !PHONE_RE.test(f.phone) ? 'Mobile numbers have 10 digits and start with 6, 7, 8 or 9.'
      : email && !EMAIL_RE.test(email) ? 'That doesn’t look like an email address.'
      : !soc.length ? 'Assign at least one society.' : '';
    setError(err);
    if (err || busy) return;
    setBusy(true);
    const failed = await createManager({ name, phone: f.phone, email, associationIds: soc });
    if (failed) { setError(failed); setBusy(false); }
  };

  return (
    <form onSubmit={submit} noValidate>
      <h2>Add a property manager</h2>
      <div className="msub">They sign in to the Trinize mobile app with this mobile number and a one-time code — there is no password to set — and see only the societies you assign here.</div>
      {error && <div className="form-alert bad" role="alert"><CircleAlert size={16} />{error}</div>}
      <div className="form-grid">
        <label className="fl">Full name<input className="in" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} maxLength={80} autoFocus /></label>
        <label className="fl">Mobile number<input className="in num" inputMode="numeric" value={f.phone} onChange={e => setF({ ...f, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} placeholder="10 digits" /></label>
        <label className="fl wide">Email <i>(optional)</i><input className="in" type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} maxLength={120} /></label>
      </div>
      <div className="fl" style={{ marginTop: 12 }}>Societies they manage</div>
      <SocietyPicker value={soc} onChange={setSoc} />
      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <button className="btn" type="submit" disabled={busy}><Busy busy={busy}>Add manager</Busy></button>
        <button className="btn ghost" type="button" onClick={closeModal}>Cancel</button>
      </div>
    </form>
  );
}

function EditSocieties({ id }) {
  const { vpms, assignManager, closeModal } = usePortal();
  const m = vpms.find(x => x.id === id);
  const [soc, setSoc] = useState(m ? m.societies.map(s => s.id) : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!m) return null;

  const save = async () => {
    if (!soc.length) { setError('A manager needs at least one society. To take away all access, remove them instead.'); return; }
    setBusy(true);
    const failed = await assignManager(id, soc);
    if (failed) { setError(failed); setBusy(false); }
  };

  return (
    <>
      <h2>Societies for {m.name}</h2>
      <div className="msub">Tick the societies {m.name.split(' ')[0]} should manage. Unticking one ends their access to it straight away.</div>
      {error && <div className="form-alert bad" role="alert"><CircleAlert size={16} />{error}</div>}
      <SocietyPicker value={soc} onChange={setSoc} />
      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <button className="btn" onClick={save} disabled={busy}><Busy busy={busy}>Save</Busy></button>
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
      </div>
    </>
  );
}

function RemoveManager({ id }) {
  const { vpms, removeManager, closeModal } = usePortal();
  const m = vpms.find(x => x.id === id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!m) return null;

  const remove = async () => {
    setBusy(true);
    const failed = await removeManager(id);
    if (failed) { setError(failed); setBusy(false); }
  };

  return (
    <>
      <h2>Remove {m.name}?</h2>
      <div className="msub">
        They will be signed out of the app at once and lose access to {m.societies.length === 1 ? m.societies[0].name : `all ${m.societies.length} societies`}.
        {m.openIssues > 0 && <> The {m.openIssues} open request{m.openIssues === 1 ? '' : 's'} in those societies stay where they are — assign another manager so they are not left waiting.</>}
      </div>
      {error && <div className="form-alert bad" role="alert"><CircleAlert size={16} />{error}</div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn danger" onClick={remove} disabled={busy}><Busy busy={busy}>Remove manager</Busy></button>
        <button className="btn ghost" onClick={closeModal}>Keep</button>
      </div>
    </>
  );
}

export function Managers() {
  const { vpms, openModal, go, makePrimary } = usePortal();
  // how many managers share each society, and who residents see there: the one marked primary,
  // or else the first listed (the server's rule — demo data carries no flag)
  const sharing = id => vpms.filter(x => x.societies.some(s => s.id === id));
  const isPrimary = (v, s) => s.primary ?? sharing(s.id)[0]?.id === v.id;
  const covered = new Set(vpms.flatMap(v => v.societies.map(s => s.id)));
  const uncovered = ASSOC.filter(a => a.state !== 'Suspended' && !covered.has(a.id));
  const add = () => openModal(<AddManager />);

  return (
    <>
      <PageHead crumb="Delivery" title="Property managers" icon="busts_in_silhouette">
        Virtual property managers run the day-to-day for the societies you assign them: resident requests, vendors, bills and notices. <b>You create them here; they work only in the mobile app</b>, signing in with their mobile number.
        When a society has more than one manager, the <Star size={12} fill="currentColor" style={{ verticalAlign: -1 }} /> marks the one residents see and call — click the outline star on another manager to switch.
      </PageHead>

      <div className="kpis">
        <Kpi label="Property managers" value={vpms.length} sub="with access to the app" onClick={add} icon="busts_in_silhouette" tone="sky" />
        <Kpi label="Societies covered" value={covered.size} sub={`of ${ASSOC.length} associations`} onClick={() => go('associations')} icon="cityscape" tone="good" />
        <Kpi label="Without a manager" value={uncovered.length} sub={uncovered.length ? uncovered.slice(0, 2).map(a => a.n.split(' ').slice(0, 2).join(' ')).join(', ') + (uncovered.length > 2 ? '…' : '') : 'every society is covered'} onClick={add} icon="warning" tone={uncovered.length ? 'warn' : 'good'} hot={uncovered.length > 0} />
        <Kpi label="Open requests" value={vpms.reduce((s, v) => s + v.openIssues, 0)} sub="across their societies" onClick={() => go('issues')} icon="ticket" tone="violet" />
      </div>

      <DataList
        rows={vpms} rowKey={v => v.id} noun="manager" minWidth={820}
        search={v => [v.name, v.phone, v.email, ...v.societies.map(s => s.name)]} searchPlaceholder="Search by name, mobile number, email or society"
        defaultSort={{ key: 'name', dir: 'asc' }} emptyAll="No property managers yet. Add one and assign the societies they will run."
        filters={[
          { key: 'load', label: 'Workload', get: v => (v.openIssues === 0 ? 'No open requests' : v.openIssues <= 5 ? '1–5 open' : 'More than 5 open'), options: ['No open requests', '1–5 open', 'More than 5 open'] },
          { key: 'cover', label: 'Societies', get: v => (v.societies.length === 0 ? 'None assigned' : v.societies.length === 1 ? 'One' : 'More than one'), options: ['None assigned', 'One', 'More than one'] },
        ]}
        csv={{ name: 'property-managers', head: ['Manager', 'Mobile', 'Email', 'Societies', 'Open requests'], row: v => [v.name, v.phone, v.email ?? '', v.societies.map(s => s.name).join('; '), v.openIssues] }}
        actions={<button className="btn sm" onClick={add}><UserPlus size={14} /> Add property manager</button>}
        columns={[
          { key: 'name', label: 'Manager', sort: v => v.name.toLowerCase(), cell: v => (
            <div className="a-cell"><span className="mgr-av">{initials(v.name)}</span><span><b>{v.name}</b>{v.email && <i>{v.email}</i>}</span></div>
          ) },
          { key: 'phone', label: 'Signs in with', cell: v => <span className="num">+91 {v.phone.slice(0, 5)} {v.phone.slice(5)}<i className="a-sub">one-time code on the mobile app</i></span> },
          { key: 'soc', label: 'Societies', dir: 'desc', sort: v => v.societies.length, cell: v => (v.societies.length ? <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>{v.societies.map(s => {
            // a society with one manager needs no choice; with several, the star marks who residents see
            if (sharing(s.id).length < 2) return <Pill key={s.id} tone="sky">{s.name}</Pill>;
            const on = isPrimary(v, s);
            return (
              <button key={s.id} type="button" className={'soc-chip' + (on ? ' on' : '')} disabled={on} onClick={() => makePrimary(v.id, s.id)}
                title={on ? `Residents of ${s.name} see ${v.name}` : `Show ${v.name} to residents of ${s.name} instead`}
                aria-label={on ? `${s.name}: ${v.name} is shown to residents` : `Make ${v.name} the manager residents of ${s.name} see`}>
                <Star size={11} fill={on ? 'currentColor' : 'none'} />{s.name}
              </button>
            );
          })}</div> : <Pill tone="warn">None assigned</Pill>) },
          { key: 'open', label: 'Open requests', right: true, dir: 'desc', sort: v => v.openIssues, cell: v => <b className="num" style={{ color: 'var(--ink)' }}>{v.openIssues}</b> },
          { key: 'act', label: 'Actions', right: true, cell: v => (
            <div className="row-acts">
              <button className="btn sm soft" onClick={() => openModal(<EditSocieties id={v.id} />)}><Pencil size={13} /> Societies</button>
              <button className="icon-act danger" onClick={() => openModal(<RemoveManager id={v.id} />)} aria-label={'Remove ' + v.name} title="Remove"><Trash2 size={15} /></button>
            </div>
          ) },
        ]}
      />

      {uncovered.length > 0 && (
        <div className="panel" style={{ marginTop: 14 }}>
          <h3>Societies without a manager</h3>
          <div className="p-sub">Requests raised here are handled by the society’s own admin until you assign someone</div>
          {uncovered.map(a => (
            <div key={a.id} className="person">
              <div className="av" style={{ background: a.c, color: a.tc }}>{a.ini}</div>
              <div style={{ flex: 1 }}><b>{a.n}</b><span>{a.city} · {a.plan} · {a.state}</span></div>
              <button className="btn sm ghost" onClick={() => go('a360', a.id)}>Open</button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
