import { Icon3D } from '../components/Icon3D';
import { Ink, Kpi, PageHead, Pill } from '../components/ui';
import { ASSOC, bandColor, bandTone, fmtL, health } from '../data/portal';
import { usePortal } from '../store/context';

export function Renewals() {
  const { go, toast } = usePortal();
  const rows = ASSOC.filter(a => a.state !== 'Suspended').map(a => ({ a, h: health(a) })).sort((p, q) => p.a.days - q.a.days);
  const atRisk = rows.filter(r => r.h.score < 52);
  const next90 = rows.filter(r => r.a.days <= 90);
  const trials = ASSOC.filter(a => a.trial);

  return (
    <>
      <PageHead crumb="Run the business" title="Renewals & risk" icon="hourglass_not_done">
        The live portal shows renewal dates. This view answers the question behind them: <b>which renewals are actually in danger, and why</b> — combining the calendar with the health model.
      </PageHead>

      <div className="kpis">
        <Kpi label="Revenue at risk" value={fmtL(atRisk.reduce((s, r) => s + r.a.annual, 0))} sub={atRisk.length + ' accounts scoring below 52'} onClick={() => toast('Revenue at risk', 'Sum of annual value for every account whose health score is below 52.')} icon="police_car_light" tone="bad" hot />
        <Kpi label="Renewing in 90 days" value={next90.length} sub={fmtL(next90.reduce((s, r) => s + r.a.annual, 0)) + ' of annual value'} onClick={() => toast('Renewal window', 'Accounts with a renewal or trial end inside 90 days.')} icon="hourglass_not_done" tone="warn" />
        <Kpi label="Trials closing" value={trials.length} sub={fmtL(trials.reduce((s, a) => s + a.annual, 0)) + ' not yet converted'} onClick={() => go('associations')} icon="seedling" tone="good" />
        <Kpi label="Concentration" value="70%" sub="of ARR sits in one account" onClick={() => go('a360', 'asn-2')} icon="bullseye" tone="violet" hot />
      </div>

      <div className="panel">
        <h3>Renewal runway</h3>
        <div className="p-sub">Ordered by days remaining · the bar shows how much of the notice period is already gone</div>
        <div className="run">
          {rows.map(({ a, h }) => {
            const overdue = a.days < 0;
            const pctGone = Math.max(4, Math.min(100, Math.round((1 - a.days / 90) * 100)));
            const ddBg = overdue ? '#FDE9E7' : a.days <= 15 ? '#FEF0DC' : '#E5F3FC';
            const ddIn = overdue ? '#B42318' : a.days <= 15 ? '#B54708' : '#0A6099';
            return (
              <div key={a.id} className="runitem">
                <div className="dd" style={{ background: ddBg, color: ddIn }}>
                  <b className="num">{Math.abs(a.days)}</b><span>{overdue ? 'DAYS LATE' : 'DAYS'}</span>
                </div>
                <div className="rr">
                  <b>{a.n} <Pill tone={bandTone(h.band)}>{h.band} {h.score}</Pill></b>
                  <span>{a.trial ? 'Trial ends ' : 'Renews '}{a.renew} · {fmtL(a.annual)}/yr · {a.plan} — {h.why}</span>
                  <div className="runbar"><i style={{ width: pctGone + '%', background: bandColor(h.band) }} /></div>
                </div>
                <button className="btn sm ghost" onClick={() => go('a360', a.id)}>Open</button>
              </div>
            );
          })}
        </div>
      </div>

      <div className="panel">
        <h3><Icon3D name="sparkles" size={20} /> Where the copilot would spend your week</h3>
        <div className="p-sub">Ranked by revenue you can still influence</div>
        <ol style={{ margin: '6px 0 0 20px', color: 'var(--ink2)', fontSize: 13, maxWidth: '78ch' }}>
          <li style={{ margin: '7px 0' }}><Ink>Prestige Lakeside Habitat (15 days, ₹11.6L)</Ink> — healthy, so this is an uplift conversation, not a rescue. They asked for the community module in August; price it into the renewal.</li>
          <li style={{ margin: '7px 0' }}><Ink>Nandi Hills (4 days, ₹30.2K)</Ink> — the import bug is the whole story. Fix ISS-2038, run the import for them, and onboarding moves before the trial closes.</li>
          <li style={{ margin: '7px 0' }}><Ink>Coastal Grove (12 days, ₹74.8K)</Ink> — verification is a 20-minute internal task blocking ₹74.8K. Do it today.</li>
          <li style={{ margin: '7px 0' }}><Ink>Green Meadows (already 15 days late)</Ink> — chase the ₹2,016, but the real problem is a 68% → 61% adoption slide. Money alone will not hold this account.</li>
        </ol>
      </div>
    </>
  );
}
