import { Check, ExternalLink, Heart, Minus } from 'lucide-react';
import { Icon3D } from '../components/Icon3D';
import { CommunityPanel, Ink, Kpi, PageHead, Pill } from '../components/ui';
import { COMMUNITY_SIM_URL, fmtL, MODULES } from '../data/portal';
import { usePortal } from '../store/context';

const CATS = ['All', 'Core', 'Finance', 'Community', 'Services', 'Operations', 'Security', 'Rental', 'Automation', 'Platform'];
const PLANS = ['Starter', 'Professional', 'Enterprise'];
/** column of each plan in a MODULES row */
const PLAN_COL = { Starter: 3, Professional: 4, Enterprise: 5 };

export function Modules() {
  const { view, patchView, toast } = usePortal();
  const plan = view.plan, idx = PLAN_COL[plan];
  const list = MODULES.filter(m => view.modCat === 'All' || m[2] === view.modCat);
  const inPlan = MODULES.filter(m => m[idx]).length;

  return (
    <>
      <PageHead crumb="Delivery" title="Modules & plans" icon="puzzle_piece">
        The capability registry every plan is assembled from. The live portal lists what exists; this view adds the question you actually ask it — <b>what would this account get if I moved them up a plan, and what is that worth?</b>
      </PageHead>

      <div className="kpis">
        <Kpi label="Modules in catalog" value={MODULES.length} sub="9 categories · 1 proposed" onClick={() => toast('Catalog', '19 modules exist today. Community Engagement is the 20th, proposed by the CFM brief.')} icon="package" tone="sky" />
        <Kpi label="In every plan" value={MODULES.filter(m => m[3]).length} sub="available from Starter up" onClick={() => patchView({ plan: 'Starter' })} icon="check_mark_button" tone="good" />
        <Kpi label="Enterprise only" value={MODULES.filter(m => !m[4] && m[5]).length} sub="your upsell surface" onClick={() => patchView({ plan: 'Enterprise' })} icon="gem_stone" tone="violet" />
        <Kpi label="Upsell headroom" value={fmtL(1290000)} sub="if every account moved up one plan" onClick={() => toast('Upsell headroom', 'Modelled: each active account priced at the next plan up, minus what they pay today.')} icon="rocket" tone="warn" />
      </div>

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

      <div className="filters">
        {CATS.map(c => <button key={c} className={c === view.modCat ? 'on' : ''} onClick={() => patchView({ modCat: c })}>{c}</button>)}
      </div>

      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Module</th><th>Category</th><th>Starter</th><th>Professional</th><th>Enterprise</th><th>Adoption</th></tr></thead>
          <tbody>
            {list.map(m => (
              <tr key={m[0]} style={m[7] === 'new' ? { background: '#FBFAFF' } : undefined}>
                <td>
                  <b style={{ color: 'var(--ink)' }}>{m[0]}</b>{m[7] === 'new' && <> <Pill tone="ai">Proposed</Pill></>}
                  <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 2 }}>{m[1]}</div>
                </td>
                <td>{m[2]}</td>
                {[3, 4, 5].map(k => (
                  <td key={k} className={m[k] ? 'tick-in' : 'tick-out'} style={{ background: k === idx ? '#F6FAFE' : undefined }} aria-label={m[k] ? 'Included' : 'Not included'}>{m[k] ? <Check size={16} strokeWidth={2.6} /> : <Minus size={15} />}</td>
                ))}
                <td>
                  <div className="modrow-adopt">
                    <div className="bar"><i style={{ width: m[6] + '%' }} /></div>
                    <b className="num" style={{ fontSize: 11.5, color: 'var(--ink2)' }}>{m[6]}%</b>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 14 }}>
        <CommunityPanel
          title={<><Icon3D name="purple_heart" size={20} /> Community Engagement — proposed new module</>}
          sub="Resident app · discussions · events & polls · AI assistant · moderation console"
          actions={<a className="btn ai" href={COMMUNITY_SIM_URL} target="_blank" rel="noopener noreferrer" style={{ marginTop: 12, display: 'inline-flex' }}><Heart size={14} /> Open the working simulation <ExternalLink size={13} /></a>}
        >
          The CFM brief describes a resident-facing community app with a society moderation console. It fits the registry as one new Enterprise-tier module with the same adoption tracking as the other 19 — and it is the module your largest account asked for at its August review.
        </CommunityPanel>
      </div>
    </>
  );
}
