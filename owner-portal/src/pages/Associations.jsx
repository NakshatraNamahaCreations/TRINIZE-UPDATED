import { Icon3D } from '../components/Icon3D';
import { PageHead, Pill, Ring } from '../components/ui';
import { ASSOC, bandColor, fmtL, health, num, payTone, stateTone } from '../data/portal';
import { usePortal } from '../store/context';

const TABS = ['All', 'Healthy', 'Watch', 'At risk', 'Trials', 'Past due'];

const FILTERS = {
  All: () => true,
  Healthy: a => health(a).band === 'Healthy',
  Watch: a => health(a).band === 'Watch',
  'At risk': a => ['At risk', 'Critical'].includes(health(a).band),
  Trials: a => a.trial,
  'Past due': a => a.pay === 'Past due' || a.pay === 'Suspended',
};

export function Associations() {
  const { view, patchView, go, toast } = usePortal();
  const F = view.assocFilter;
  // worst health first — the account needing you should not be alphabetically fourth
  const list = ASSOC.filter(FILTERS[F]).sort((a, b) => health(a).score - health(b).score);

  return (
    <>
      <PageHead crumb="Accounts" title="Associations" icon="cityscape">
        The residential associations subscribing to Trinize. <b>Sorted by who needs attention first</b>, not alphabetically — each card leads with its health score and the one number that explains it.
      </PageHead>
      <div className="filters">
        {TABS.map(t => <button key={t} className={t === F ? 'on' : ''} onClick={() => patchView({ assocFilter: t })}>{t}</button>)}
        <span className="spacer" />
        <button className="btn sm" onClick={() => toast('Onboarding wizard', 'Concept demo — the real flow captures registration, bank proof, blocks and the first invoice.')}>+ Onboard association</button>
      </div>
      {list.length ? (
        <div className="assoc-grid">
          {list.map(a => {
            const h = health(a), col = bandColor(h.band);
            return (
              <button key={a.id} className="acard" onClick={() => go('a360', a.id)}>
                <div className="top">
                  <div className="logo" style={{ background: a.c, color: a.tc }}>{a.ini}</div>
                  <div style={{ minWidth: 0 }}><b className="nm">{a.n}</b><span className="loc">{a.city} · {a.type}</span></div>
                  <div className="ring"><Ring pct={h.score} size={46} color={col} /><b style={{ color: col }} className="num">{h.score}</b></div>
                </div>
                <div className="mid">
                  <Pill tone={stateTone(a.state)}>{a.state}</Pill>
                  <Pill tone={payTone(a.pay)}>{a.pay}</Pill>
                  <Pill>{a.plan}</Pill>
                </div>
                <div style={{ fontSize: 11.5, color: col, fontWeight: 700 }}>{h.band} · {h.why}</div>
                <div className="stats">
                  <div><b className="num">{num(a.plots)}</b><span>PLOTS</span></div>
                  <div><b className="num">{a.adopt}%</b><span>ONBOARDED</span></div>
                  <div><b className="num">{fmtL(a.annual)}</b><span>ANNUAL</span></div>
                </div>
                <div className="foot"><span>{a.trial ? 'Trial ends ' : 'Renews '}{a.renew}</span><span className="go">Open →</span></div>
              </button>
            );
          })}
        </div>
      ) : <div className="empty"><Icon3D name="magnifying_glass_tilted_left" size={44} className="empty-3d" />No associations match this filter</div>}
    </>
  );
}
