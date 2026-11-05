import { Sparkles } from 'lucide-react';
import { Icon3D } from '../components/Icon3D';
import { HealthChart, MrrChart } from '../components/charts/Charts';
import { Ink, Kpi, Pill, Spark } from '../components/ui';
import { ASSOC, findAssoc, fmtI, fmtL, health, INVOICES, MRR, num, OPERATOR, TODAY } from '../data/portal';
import { usePortal } from '../store/context';

/** The four flagged decisions, ranked by money at risk. Each primary action clears its card. */
function useAttention() {
  const { go, doAct } = usePortal();
  const nandi = findAssoc('asn-5'), coastal = findAssoc('asn-6'), prestige = findAssoc('asn-2'), green = findAssoc('asn-4');
  return [
    { id: 'trial', kind: 'bad', ic: 'hourglass_not_done', t: 'Trial ends in 4 days', head: nandi.n + ' — 18% of owners onboarded',
      sub: '₹30,240/yr at stake. Low onboarding is the single best predictor of a trial that will not convert — and a data bug (ISS-2038) is blocking their bulk import.',
      primary: ['Unblock the import', () => doAct('trial', 'Escalated ISS-2038 to the data team', 'Bulk import fix requested · Nagesh Gowda notified')],
      secondary: ['Open account', () => go('a360', 'asn-5')] },
    { id: 'renew', kind: 'warn', ic: 'money_bag', t: 'Renewal in 15 days · 70% of ARR', head: prestige.n + ' — ' + fmtL(prestige.annual) + '/yr',
      sub: 'Healthy account (adoption 87%, paying on time) but concentration risk. They asked for a resident community app at the August review — that is the uplift conversation.',
      primary: ['Prepare uplift pack', () => doAct('renew', 'Renewal + uplift pack prepared', 'Enterprise renewal with Community Engagement priced at ₹13.4L/yr')],
      secondary: ['Open account', () => go('a360', 'asn-2')] },
    { id: 'verify', kind: 'warn', ic: 'identification_card', t: 'Awaiting verification for 18 days', head: coastal.n + ' — nothing can start',
      sub: 'Registration certificate and bank proof are still unchecked, so 340 plots cannot be onboarded and its trial ends in 12 days.',
      primary: ['Verify & activate', () => doAct('verify', 'Verification completed', 'Registration + bank proof approved · account activated')],
      secondary: ['Open account', () => go('a360', 'asn-6')] },
    { id: 'dues', kind: 'bad', ic: 'money_with_wings', t: 'Past due · access restricts in 15 days', head: green.n + ' — ' + fmtI(2016) + ' across 2 invoices',
      sub: 'Overdue since July and logins are down 34% quarter on quarter. Chasing the money without fixing the adoption slide only buys a month.',
      primary: ['Send reminder', () => doAct('dues', 'Reminder sent to Bhagya Lakshmi', 'Payment link + adoption help offered in one message')],
      secondary: ['Open collections', () => go('collections')] },
  ];
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function CommandCentre() {
  const { go, done, feed, openCop, copAsk } = usePortal();
  const cards = useAttention();
  const open = cards.filter(c => !done[c.id]);

  const active = ASSOC.filter(a => a.state === 'Active');
  const plots = ASSOC.reduce((s, a) => s + a.plots, 0);
  const owners = ASSOC.reduce((s, a) => s + a.owners, 0);
  const mrr = MRR[11];
  const arr = active.filter(a => !a.trial).reduce((s, a) => s + a.annual, 0);
  const overdue = INVOICES.filter(i => i.days < 0);
  const dues = overdue.reduce((s, i) => s + i.amt, 0);
  const atRisk = ASSOC.filter(a => health(a).score < 52).length;
  const growth = Math.round((MRR[11] / MRR[0] - 1) * 100);

  return (
    <>
      <div className="crumb">{greeting()}, {OPERATOR.first} · {TODAY}</div>
      <h1 className="pgt"><Icon3D name="compass" size={36} />Command centre</h1>
      <div className="pgs">Not a wall of numbers — <b>the four things that actually need you today</b>, ranked by money at risk. Everything below is computed from the same account records, so every figure opens the list behind it.</div>

      {open.length ? (
        <div className="att-row">
          {open.map(c => (
            <div key={c.id} className={'att ' + c.kind}>
              <Icon3D name={c.ic} size={40} className="att-3d" />
              <div className="t"><span className={'dot ' + c.kind} /> {c.t}</div>
              <b className="head">{c.head}</b>
              <span className="sub">{c.sub}</span>
              <div className="act">
                <button className="btn sm" onClick={c.primary[1]}>{c.primary[0]}</button>
                <button className="btn sm ghost" onClick={c.secondary[1]}>{c.secondary[0]}</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="att done-card" style={{ marginBottom: 20 }}>
          <div className="t"><Icon3D name="check_mark_button" size={16} /> Cleared</div>
          <b className="head">Nothing needs you right now</b>
          <span className="sub">All four flagged decisions have been actioned in this demo. Reload the page to replay them.</span>
        </div>
      )}
      {open.length < cards.length && (
        <div style={{ fontSize: 12, color: 'var(--ink3)', margin: '-8px 0 18px' }}>
          {cards.length - open.length} of {cards.length} decisions cleared in this session · logged to the activity feed below.
        </div>
      )}

      <div className="kpis">
        <Kpi label="Monthly recurring revenue" value={fmtL(mrr)} sub={<><span className="up">▲ {growth}%</span> over 12 months</>} onClick={() => go('renewals')} icon="chart_increasing" tone="sky" extra={<Spark data={MRR} color="#0B87D4" w={64} h={26} />} />
        <Kpi label="Annual recurring revenue" value={fmtL(arr)} sub="excludes trials & suspended" onClick={() => go('renewals')} icon="bar_chart" tone="good" />
        <Kpi label="Accounts at risk" value={atRisk} sub={`of ${ASSOC.length} · health below 52`} onClick={() => go('renewals')} icon="warning" tone="bad" hot={atRisk > 0} />
        <Kpi label="Outstanding dues" value={fmtL(dues)} sub={`${overdue.length} invoices overdue`} onClick={() => go('collections')} icon="receipt" tone="warn" hot />
        <Kpi label="Plots under management" value={num(plots)} sub={`${num(owners)} owners registered`} onClick={() => go('associations')} icon="houses" tone="indigo" />
        <Kpi label="Owner onboarding" value={Math.round(owners / plots * 100) + '%'} sub={`${num(plots - owners)} plots still to claim`} onClick={() => go('associations')} icon="busts_in_silhouette" tone="violet" />
      </div>

      <div className="grid2">
        <div className="panel">
          <h3>Recurring revenue</h3>
          <div className="p-sub">Monthly recurring revenue over the last 12 months · hover any point</div>
          <div style={{ minHeight: 190 }}><MrrChart /></div>
        </div>
        <div className="panel">
          <h3>Portfolio health</h3>
          <div className="p-sub">Every account scored on adoption, payment, usage trend and open tickets</div>
          <HealthChart />
          <div style={{ fontSize: 11.5, color: 'var(--ink3)', marginTop: 10, borderTop: '1px solid var(--line)', paddingTop: 9 }}>
            Health is a model, not an opinion: adoption × 0.35, payment state, 90-day usage slope, ticket load. Click a bar to open the account.
          </div>
        </div>
      </div>

      <div className="grid2">
        <div className="panel">
          <h3><Icon3D name="sparkles" size={20} /> Portfolio copilot <Pill tone="ai">AI · suggest only</Pill></h3>
          <div className="p-sub">Written from your own account records, refreshed as they change</div>
          <p style={{ color: 'var(--ink2)', fontSize: 13, maxWidth: '80ch' }}>
            You are running <Ink>{fmtI(mrr)}</Ink> of monthly recurring revenue across {active.length} active associations and {num(plots)} plots — up {growth}% over the year. <Ink>Prestige Lakeside Habitat is 70% of annual revenue and renews in 15 days</Ink>, so it outweighs everything else on this page.
          </p>
          <p style={{ color: 'var(--ink2)', fontSize: 13, maxWidth: '80ch', marginTop: 8 }}>
            Two trials (<Ink>₹1.05L</Ink> combined) close within a fortnight and neither is ready: Nandi Hills sits at 18% onboarding behind a data bug, Coastal Grove has not been verified at all. Those are the two conversions you can still influence this week.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <button className="btn ai sm" onClick={openCop}><Sparkles size={14} /> Ask a follow-up</button>
            <button className="btn ghost sm" onClick={() => copAsk('Draft the renewal email for Prestige')}>Draft the renewal email</button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink3)', marginTop: 10 }}>Generated from your own figures. Check anything financial against the account before acting on it.</div>
        </div>
        <div className="panel">
          <h3>Activity</h3>
          <div className="p-sub">Across every account · newest first</div>
          <div className="feed">
            {feed.slice(0, 7).map((f, i) => (
              <div key={i} className="fi"><span className="who">{f.who}</span><span>{f.what}</span><span className="when">{f.when}</span></div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
