import { Check, ExternalLink, Heart, Minus, Pencil } from 'lucide-react';
import { useState } from 'react';
import { DataList } from '../components/DataList';
import { CommunityPanel, Ink, Kpi, PageHead, Pill } from '../components/ui';
import { ASSOC, COMMUNITY_SIM_URL, fmtI, fmtL, MODULES, PLAN_INFO } from '../data/portal';
import { LIVE } from '../lib/api';
import * as live from '../lib/live';
import { usePortal } from '../store/context';
import { Alert, Busy } from './AccountActions';

const PLANS = ['Starter', 'Professional', 'Enterprise'];
/** column of each plan in a MODULES row */
const PLAN_COL = { Starter: 3, Professional: 4, Enterprise: 5 };
const lowest = m => (m[3] ? 'Starter' : m[4] ? 'Professional' : 'Enterprise');

/** Connected: what a plan is called for, its description and its list price. */
function EditPlan({ plan }) {
  const { closeModal, reload, toast } = usePortal();
  const [f, setF] = useState({ tag: PLAN_INFO[plan].tag, about: PLAN_INFO[plan].about, price: PLAN_INFO[plan].price ? String(PLAN_INFO[plan].price) : '' });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const submit = async e => {
    e.preventDefault();
    const err = f.tag.trim().length < 2 ? 'Give the plan a short tagline.' : f.about.trim().length < 5 ? 'Describe what the plan includes.' : '';
    setError(err);
    if (err || busy) return;
    setBusy(true);
    try {
      await live.savePlans({ plans: { [plan]: { tag: f.tag.trim(), about: f.about.trim(), price: Number(f.price) || 0 } } });
      await reload();
      closeModal();
      toast(plan + ' plan saved', 'Societies see the new wording in their console straight away.', 'check_mark_button');
    } catch (e2) { setError(e2?.message ?? 'Something went wrong.'); setBusy(false); }
  };
  return (
    <form onSubmit={submit} noValidate>
      <h2>Edit the {plan} plan</h2>
      <div className="msub">This is how the plan is described to you and to societies. Which modules it includes is set in the table, under “Included from”.</div>
      <Alert>{error}</Alert>
      <label className="fl">Tagline<input className="in" value={f.tag} onChange={e => setF({ ...f, tag: e.target.value })} maxLength={60} autoFocus /></label>
      <label className="fl" style={{ marginTop: 12 }}>What it includes<textarea className="in" rows={3} value={f.about} onChange={e => setF({ ...f, about: e.target.value })} maxLength={300} /></label>
      <label className="fl" style={{ marginTop: 12 }}>List price per year (₹) <i>(leave empty if priced per society)</i>
        <input className="in num" inputMode="numeric" value={f.price} onChange={e => setF({ ...f, price: e.target.value.replace(/\D/g, '').slice(0, 9) })} placeholder="Priced per society" />
      </label>
      <div className="f-note">The list price is a guide. What a society actually pays is the annual value on its own subscription, and changing this does not change any society’s bill.</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <button className="btn" type="submit" disabled={busy}><Busy busy={busy}>Save plan</Busy></button>
        <button className="btn ghost" type="button" onClick={closeModal}>Cancel</button>
      </div>
    </form>
  );
}

/** Connected: moving a module to another plan changes what every society can open, so it is confirmed first. */
function MoveModule({ name, to }) {
  const { closeModal, reload, toast } = usePortal();
  const m = MODULES.find(x => x[0] === name), from = lowest(m);
  const up = PLANS.indexOf(to) > PLANS.indexOf(from);
  // societies on a plan between the old and new starting point are the ones that gain or lose it
  const hit = ASSOC.filter(a => { const r = PLANS.indexOf(a.plan); return up ? r >= PLANS.indexOf(from) && r < PLANS.indexOf(to) : r >= PLANS.indexOf(to) && r < PLANS.indexOf(from); });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const save = async () => {
    setBusy(true);
    try {
      await live.savePlans({ moduleFrom: { [name]: to } });
      await reload();
      closeModal();
      toast(name + ' now starts at ' + to, hit.length ? `${hit.length} ${hit.length === 1 ? 'society has' : 'societies have'} ${up ? 'lost' : 'gained'} it.` : 'No society’s access changed.', 'check_mark_button');
    } catch (e2) { setError(e2?.message ?? 'Something went wrong.'); setBusy(false); }
  };
  return (
    <>
      <h2>Move {name} to {to}?</h2>
      <div className="msub">It is included from <b>{from}</b> today. After this it is included from <b>{to}</b> upwards, for every society at once.</div>
      <Alert>{error}</Alert>
      <div className={'form-alert ' + (up && hit.length ? 'bad' : 'info')} style={{ display: 'block' }}>
        {hit.length ? <><b>{hit.length} {hit.length === 1 ? 'society' : 'societies'} will {up ? 'lose' : 'gain'} this module:</b> {hit.map(a => a.n + ' (' + a.plan + ')').join(', ')}.{up && ' Their records are kept; the section is locked in their console until they upgrade.'}</>
          : 'No society is on a plan affected by this, so nobody’s access changes today.'}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className={'btn' + (up && hit.length ? ' danger' : '')} onClick={save} disabled={busy}><Busy busy={busy}>Move to {to}</Busy></button>
        <button className="btn ghost" onClick={closeModal}>Cancel</button>
      </div>
    </>
  );
}

export function Modules() {
  const { view, patchView, toast, openModal } = usePortal();
  const plan = view.plan, idx = PLAN_COL[plan];
  const tick = (m, k) => <span className={(m[k] ? 'tick-in' : 'tick-out') + (k === idx ? ' picked' : '')} aria-label={m[k] ? 'Included' : 'Not included'}>{m[k] ? <Check size={16} strokeWidth={2.6} /> : <Minus size={15} />}</span>;
  const inPlan = MODULES.filter(m => m[idx]).length;
  const cats = new Set(MODULES.map(m => m[2])).size;
  const below = ASSOC.filter(a => a.state === 'Active' && a.plan !== 'Enterprise');

  return (
    <>
      <PageHead crumb="Delivery" title="Modules & plans" icon="puzzle_piece">
        {LIVE ? <>What each plan includes. <b>Change “Included from” on a module to move it between plans</b> — the society consoles lock or unlock that section at once.</>
          : <>The capability registry every plan is assembled from. The live portal lists what exists; this view adds the question you actually ask it — <b>what would this account get if I moved them up a plan, and what is that worth?</b></>}
      </PageHead>

      <div className="kpis">
        <Kpi label="Modules in catalog" value={MODULES.length} sub={LIVE ? cats + ' categories' : '9 categories · 1 proposed'} hint={LIVE ? `${MODULES.length} modules across ${cats} categories.` : '19 modules exist today. Community Engagement is the 20th, proposed by the CFM brief.'} icon="package" tone="sky" />
        <Kpi label="In every plan" value={MODULES.filter(m => m[3]).length} sub="available from Starter up" onClick={() => patchView({ plan: 'Starter' })} icon="check_mark_button" tone="good" />
        <Kpi label="Enterprise only" value={MODULES.filter(m => !m[4] && m[5]).length} sub="your upsell surface" onClick={() => patchView({ plan: 'Enterprise' })} icon="gem_stone" tone="violet" />
        {LIVE ? <Kpi label="Below Enterprise" value={below.length} sub={below.length ? 'active accounts you could move up' : 'every active account is on Enterprise'} onClick={() => toast('Upsell surface', below.length ? below.map(a => a.n + ' · ' + a.plan).join(' · ') : 'Nothing to move up.')} icon="rocket" tone="warn" />
          : <Kpi label="Upsell headroom" value={fmtL(1290000)} sub="if every account moved up one plan" hint={'Modelled: each active account priced at the next plan up, minus what they pay today.'} icon="rocket" tone="warn" />}
      </div>

      {LIVE ? (
        <div className="plan-row">
          {PLANS.map(p => {
            const info = PLAN_INFO[p], n = MODULES.filter(m => m[PLAN_COL[p]]).length, on = ASSOC.filter(a => a.plan === p).length;
            return (
              <div key={p} className={'plan-card static ' + p.toLowerCase() + (plan === p ? ' on' : '')}>
                <span className="pc-top"><b>{p}</b><button className="pc-edit" onClick={() => openModal(<EditPlan plan={p} />)}><Pencil size={12} /> Edit</button></span>
                <span className="pc-tag">{info.tag}</span>
                <span className="pc-about">{info.about}</span>
                <span className="pc-nums"><span><b className="num">{n}</b>of {MODULES.length} modules</span><span><b className="num">{info.price ? fmtI(info.price) : '—'}</b>{info.price ? 'list price a year' : 'priced per society'}</span></span>
                <span className="pc-foot">{on} {on === 1 ? 'society' : 'societies'} on this plan · <button className="pc-link" onClick={() => patchView({ plan: p })}>{plan === p ? 'highlighted in the table' : 'highlight in the table'}</button></span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="panel">
          <h3>Plan simulator</h3>
          <div className="p-sub">Pick a plan to see what an association on it can actually use</div>
          <div className="filters" style={{ marginBottom: 6 }}>
            {PLANS.map(p => <button key={p} className={p === plan ? 'on' : ''} onClick={() => patchView({ plan: p })}>{p}</button>)}
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink2)' }}>
            On <Ink>{plan}</Ink>, an association gets <b style={{ color: 'var(--ink)' }} className="num">{inPlan} of {MODULES.length}</b> modules
            {plan !== 'Enterprise' ? ` — the ${MODULES.length - inPlan} they cannot reach are your upgrade conversation.` : ' — everything in the catalog.'}
          </div>
        </div>
      )}

      <DataList
        rows={MODULES} rowKey={m => m[0]} noun="module" pageSize={10} minWidth={860} rowStyle={m => (m[7] === 'new' ? { background: '#FAF9FF' } : undefined)}
        search={m => [m[0], m[1], m[2]]} searchPlaceholder="Search modules by name, what they do or category"
        defaultSort={{ key: 'from', dir: 'asc' }}
        filters={[
          { key: 'cat', label: 'Category', get: m => m[2] },
          { key: 'from', label: 'Included from', get: lowest, options: PLANS },
          { key: 'in', label: 'On ' + plan, get: m => (m[idx] ? 'Included' : 'Not included'), options: ['Included', 'Not included'] },
        ]}
        csv={{ name: 'modules', head: ['Module', 'What it does', 'Category', 'Included from', 'Adoption %'], row: m => [m[0], m[1], m[2], lowest(m), m[6]] }}
        columns={[
          { key: 'name', label: 'Module', sort: m => m[0].toLowerCase(), cell: m => <><b style={{ color: 'var(--ink)' }}>{m[0]}</b>{m[7] === 'new' && <> <Pill tone="ai">Proposed</Pill></>}<i className="a-sub">{m[1]}</i></> },
          { key: 'cat', label: 'Category', sort: m => m[2], cell: m => m[2] },
          { key: 'from', label: 'Included from', sort: m => PLANS.indexOf(lowest(m)), stop: true, cell: m => (LIVE
            ? <select className={'plan-sel ' + lowest(m).toLowerCase()} value={lowest(m)} aria-label={'Plan that ' + m[0] + ' is included from'} onChange={e => openModal(<MoveModule name={m[0]} to={e.target.value} />)}>{PLANS.map(p => <option key={p}>{p}</option>)}</select>
            : <span className={'plan-chip ' + lowest(m).toLowerCase()}>{lowest(m)}</span>) },
          { key: 's', label: 'Starter', cell: m => tick(m, 3) },
          { key: 'p', label: 'Professional', cell: m => tick(m, 4) },
          { key: 'e', label: 'Enterprise', cell: m => tick(m, 5) },
          { key: 'adopt', label: 'Adoption', dir: 'desc', sort: m => m[6], cell: m => <div className="modrow-adopt"><div className="bar"><i style={{ width: m[6] + '%' }} /></div><b className="num" style={{ fontSize: 11.5, color: 'var(--ink2)' }}>{m[6]}%</b></div> },
        ]}
      />

      {!LIVE && <div style={{ marginTop: 14 }}>
        <CommunityPanel
          title="Community Engagement — proposed new module"
          sub="Resident app · discussions · events & polls · AI assistant · moderation console"
          actions={<a className="btn ai" href={COMMUNITY_SIM_URL} target="_blank" rel="noopener noreferrer" style={{ marginTop: 12, display: 'inline-flex' }}><Heart size={14} /> Open the working simulation <ExternalLink size={13} /></a>}
        >
          The CFM brief describes a resident-facing community app with a society moderation console. It fits the registry as one new Enterprise-tier module with the same adoption tracking as the other 19 — and it is the module your largest account asked for at its August review.
        </CommunityPanel>
      </div>}
    </>
  );
}
