import { Plus, Sparkles } from 'lucide-react';
import { BilledChart, HealthChart, MrrChart } from '../components/charts/Charts';
import { Ink, Kpi, Pill, Spark } from '../components/ui';
import { attention, summary } from '../data/insights';
import { ASSOC, bandTone, findAssoc, fmtI, fmtL, health, INVOICES, MRR, num, priTone, slaTone, TODAY } from '../data/portal';
import { LIVE } from '../lib/api';
import { usePortal } from '../store/context';
import { Onboard } from './Onboard';

/** What needs the operator, most urgent first. Connected, it is worked out from the records. */
function useAttention() {
  const portal = usePortal();
  const { go, doAct } = portal;
  if (LIVE) return attention(portal);
  const nandi = findAssoc('asn-5'), coastal = findAssoc('asn-6'), prestige = findAssoc('asn-2'), green = findAssoc('asn-4');
  return [
    { id: 'trial', kind: 'bad', t: 'Trial ends in 4 days', head: nandi.n + ' — 18% of owners onboarded',
      sub: '₹30,240/yr at stake. A data bug (ISS-2038) is blocking their bulk import.',
      primary: ['Unblock the import', () => doAct('trial', 'Escalated ISS-2038 to the data team', 'Bulk import fix requested · Nagesh Gowda notified')],
      secondary: ['Open account', () => go('a360', 'asn-5')] },
    { id: 'renew', kind: 'warn', t: 'Renewal in 15 days · 70% of ARR', head: prestige.n + ' — ' + fmtL(prestige.annual) + '/yr',
      sub: 'Healthy account (adoption 87%, paying on time), but most of annual revenue sits here.',
      primary: ['Prepare uplift pack', () => doAct('renew', 'Renewal + uplift pack prepared', 'Enterprise renewal with Community Engagement priced at ₹13.4L/yr')],
      secondary: ['Open account', () => go('a360', 'asn-2')] },
    { id: 'verify', kind: 'warn', t: 'Awaiting verification for 18 days', head: coastal.n + ' — nothing can start',
      sub: 'Registration certificate and bank proof are unchecked; 340 plots cannot be onboarded.',
      primary: ['Verify & activate', () => doAct('verify', 'Verification completed', 'Registration + bank proof approved · account activated')],
      secondary: ['Open account', () => go('a360', 'asn-6')] },
    { id: 'dues', kind: 'bad', t: 'Past due · access restricts in 15 days', head: green.n + ' — ' + fmtI(2016) + ' across 2 invoices',
      sub: 'Overdue since July, and logins are down 34% quarter on quarter.',
      primary: ['Send reminder', () => doAct('dues', 'Reminder sent to Bhagya Lakshmi', 'Payment link + adoption help offered in one message')],
      secondary: ['Open collections', () => go('collections')] },
  ];
}

const PanelHead = ({ title, sub, more, onMore }) => (
  <div className="panel-h">
    <div><h3>{title}</h3>{sub && <div className="p-sub" style={{ marginBottom: 0 }}>{sub}</div>}</div>
    {more && <button className="more" onClick={onMore}>{more}</button>}
  </div>
);
const link = { color: 'var(--acc-ink)', fontWeight: 700, textAlign: 'left' };

export function CommandCentre() {
  const { go, done, feed, issues, openCop, openModal, toast } = usePortal();
  const cards = useAttention();
  const open = LIVE ? cards : cards.filter(c => !done[c.id]);

  const active = ASSOC.filter(a => a.state === 'Active');
  const trials = ASSOC.filter(a => a.state === 'Trial');
  const plots = ASSOC.reduce((s, a) => s + a.plots, 0);
  const owners = ASSOC.reduce((s, a) => s + a.owners, 0);
  const mrr = MRR[MRR.length - 1] ?? 0;
  const arr = active.filter(a => !a.trial).reduce((s, a) => s + a.annual, 0);
  const overdue = INVOICES.filter(i => i.days < 0).sort((a, b) => a.days - b.days);
  const dues = overdue.reduce((s, i) => s + i.amt, 0);
  const atRisk = ASSOC.filter(a => health(a).score < 52).length;
  // measured from the first month with revenue — a series that starts at zero would otherwise read "no change"
  const firstMrr = MRR.find(v => v > 0) ?? 0;
  const growth = firstMrr && mrr ? Math.round((mrr / firstMrr - 1) * 100) : 0;
  const renewing = ASSOC.filter(a => a.state !== 'Suspended' && a.days <= 90).sort((a, b) => a.days - b.days).slice(0, 6);
  const openIssues = issues.filter(i => i.st !== 'Resolved').slice(0, 6);

  return (
    <>
      <div className="dash-head">
        <div>
          <h1 className="pgt">Command centre</h1>
          <div className="dash-sub">{TODAY} · {num(ASSOC.length)} association{ASSOC.length === 1 ? '' : 's'} · {active.length} active, {trials.length} on trial · {num(plots)} plots</div>
        </div>
        <div className="dash-act">
          <button className="btn ghost sm" onClick={() => go('associations')}>All associations</button>
          <button className="btn sm" onClick={() => (LIVE ? openModal(<Onboard />) : toast('Onboarding wizard', 'The real flow captures registration, bank proof, blocks and the first invoice.'))}><Plus size={14} /> Onboard association</button>
        </div>
      </div>

      <div className="kpis">
        <Kpi label="Monthly recurring revenue" value={fmtL(mrr)} sub={growth ? <><span className={growth > 0 ? 'up' : 'down'}>{growth > 0 ? '▲' : '▼'} {Math.abs(growth)}%</span> over 12 months</> : firstMrr ? 'Flat over 12 months' : 'Not enough history yet'} onClick={() => go('renewals')} extra={<Spark data={MRR.length > 1 ? MRR : [0, 0]} color="#5B3FE0" w={64} h={26} />} />
        <Kpi label="Annual recurring revenue" value={fmtL(arr)} sub="Active accounts, excluding trials" onClick={() => go('renewals')} />
        <Kpi label="Outstanding dues" value={fmtL(dues)} sub={overdue.length ? `${overdue.length} invoice${overdue.length === 1 ? '' : 's'} overdue` : 'Nothing overdue'} onClick={() => go('collections')} hot={overdue.length > 0} />
        <Kpi label="Accounts at risk" value={atRisk} sub={`of ${ASSOC.length} · health below 52`} onClick={() => go('renewals')} hot={atRisk > 0} />
        <Kpi label="Plots under management" value={num(plots)} sub={`${num(owners)} owners registered`} onClick={() => go('associations')} />
        <Kpi label="Owner onboarding" value={(plots ? Math.round(owners / plots * 100) : 0) + '%'} sub={`${num(Math.max(0, plots - owners))} plots still to claim`} onClick={() => go('associations')} />
      </div>

      <div className="grid2">
        <div className="panel">
          <PanelHead title="Needs attention" sub={open.length ? 'Most urgent first' : undefined} />
          {open.length ? open.map(c => (
            <div key={c.id} className="attn">
              <span className={'mark ' + c.kind} aria-hidden="true" />
              <div className="body">
                <span className="tag">{c.t}</span>
                <b>{c.head}</b>
                <span className="why">{c.sub}</span>
              </div>
              <div className="btns">
                <button className="btn sm" onClick={c.primary[1]}>{c.primary[0]}</button>
                <button className="btn sm ghost" onClick={c.secondary[1]}>{c.secondary[0]}</button>
              </div>
            </div>
          )) : (
            <div className="empty" style={{ padding: '22px 0' }}>
              {LIVE ? 'Nothing needs you right now: no trial is closing, no renewal falls inside 30 days, nothing is waiting for verification and no invoice is overdue.' : 'All flagged items have been actioned in this session.'}
            </div>
          )}
        </div>
        <div>
          <div className="panel">
            <PanelHead title="Portfolio health" sub="Scored on adoption, payment, usage trend and open tickets" more="Renewals & risk" onMore={() => go('renewals')} />
            <HealthChart />
          </div>
          <div className="panel">
            <PanelHead title="Recent activity" sub="Across every account, newest first" />
            {feed.length ? (
              <div className="feed">
                {feed.slice(0, 7).map((f, i) => (
                  <div key={i} className="fi"><span className="who">{f.who}</span><span>{f.what}</span><span className="when">{f.when}</span></div>
                ))}
              </div>
            ) : <div className="empty" style={{ padding: '22px 0' }}>Nothing has happened yet.</div>}
          </div>
        </div>
      </div>

      <div className="grid2">
        <div className="panel">
          <PanelHead title="Recurring revenue" sub="Monthly recurring revenue, last 12 months" />
          <div className="chart-box"><MrrChart /></div>
        </div>
        <div className="panel">
          <PanelHead title="Billed and collected" sub="What was invoiced each month, and how much of it came in" more="Collections" onMore={() => go('collections')} />
          <div className="leg">
            <span><i style={{ background: 'var(--s1)' }} />Invoiced</span>
            <span><i style={{ background: 'var(--s2)' }} />Collected</span>
          </div>
          <div className="chart-box"><BilledChart /></div>
        </div>
      </div>

      <div className="grid2e">
        <div className="panel">
          <PanelHead title="Renewals in the next 90 days" more="See all" onMore={() => go('renewals')} />
          {renewing.length ? (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Association</th><th>Plan</th><th>{'Renews'}</th><th>Annual value</th><th>Health</th></tr></thead>
                <tbody>
                  {renewing.map(a => {
                    const h = health(a);
                    return (
                      <tr key={a.id}>
                        <td><button style={link} onClick={() => go('a360', a.id)}>{a.n}</button></td>
                        <td>{a.plan}{a.trial ? ' · trial' : ''}</td>
                        <td>{a.renew}<div style={{ fontSize: 11, color: a.days < 0 ? 'var(--bad)' : 'var(--ink3)' }}>{a.days < 0 ? Math.abs(a.days) + ' days late' : 'in ' + a.days + ' days'}</div></td>
                        <td className="num" style={{ color: 'var(--ink)', fontWeight: 700 }}>{fmtL(a.annual)}</td>
                        <td><Pill tone={bandTone(h.band)}>{h.band} {h.score}</Pill></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <div className="empty" style={{ padding: '22px 0' }}>No renewal or trial end falls inside 90 days.</div>}
        </div>
        <div className="panel">
          <PanelHead title="Overdue invoices" more="Collections" onMore={() => go('collections')} />
          {overdue.length ? (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Invoice</th><th>Association</th><th>Amount</th><th>Due</th></tr></thead>
                <tbody>
                  {overdue.slice(0, 6).map(i => {
                    const a = findAssoc(i.a);
                    return (
                      <tr key={i.id}>
                        <td><b className="num" style={{ color: 'var(--ink)' }}>{i.id}</b></td>
                        <td>{a ? <button style={link} onClick={() => go('a360', a.id)}>{a.n}</button> : '—'}</td>
                        <td className="num" style={{ color: 'var(--ink)', fontWeight: 700 }}>{fmtI(i.amt)}</td>
                        <td style={{ color: 'var(--bad)', fontWeight: 600, whiteSpace: 'nowrap' }}>{LIVE ? i.due : `${i.due} · ${Math.abs(i.days)} days late`}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <div className="empty" style={{ padding: '22px 0' }}>No invoice is overdue.</div>}
        </div>
      </div>

      <div className="grid2e">
        <div className="panel">
          <PanelHead title="Open support issues" more="See all" onMore={() => go('issues')} />
          {openIssues.length ? (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Issue</th><th>Association</th><th>Priority</th><th>SLA</th></tr></thead>
                <tbody>
                  {openIssues.map(i => (
                    <tr key={i.id} className="rowbtn" onClick={() => go('issues')}>
                      <td><b className="num" style={{ color: 'var(--ink3)', fontSize: 11 }}>{i.id}</b><div style={{ color: 'var(--ink)', fontWeight: 600 }}>{i.t}</div></td>
                      <td>{findAssoc(i.a)?.n ?? '—'}</td>
                      <td><Pill tone={priTone(i.pri)}>{i.pri}</Pill></td>
                      <td><Pill tone={slaTone(i.slaState)}>{i.sla}</Pill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div className="empty" style={{ padding: '22px 0' }}>No support issue is open.</div>}
        </div>
        <div className="panel">
          <PanelHead title="Summary" sub="Written from the figures on this page" />
          {LIVE && summary().map((para, i) => <p key={i} style={{ color: 'var(--ink2)', fontSize: 13, maxWidth: '90ch', marginTop: i ? 8 : 0 }}>{para}</p>)}
          {!LIVE && <p style={{ color: 'var(--ink2)', fontSize: 13, maxWidth: '90ch' }}>
            You are running <Ink>{fmtI(mrr)}</Ink> of monthly recurring revenue across {active.length} active associations and {num(plots)} plots — up {growth}% over the year. <Ink>Prestige Lakeside Habitat is 70% of annual revenue and renews in 15 days.</Ink> Two trials close within a fortnight and neither is ready.
          </p>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <button className="btn ghost sm" onClick={openCop}><Sparkles size={14} /> Ask a question about these figures</button>
          </div>
        </div>
      </div>
    </>
  );
}
