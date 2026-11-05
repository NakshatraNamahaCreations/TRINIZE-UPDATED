import { ExternalLink, Heart, Phone, Sparkles } from 'lucide-react';
import { useEffect } from 'react';
import { useParams } from 'react-router';
import { Icon3D } from '../components/Icon3D';
import { UsageChart } from '../components/charts/Charts';
import { CommunityPanel, Kpi, Pill, Ring } from '../components/ui';
import { bandColor, COMMUNITY_SIM_URL, findAssoc, fmtL, health, initials, INVOICES, num, payTone, priTone, slaTone, stateTone, statusTone } from '../data/portal';
import { usePortal } from '../store/context';

export function Association360() {
  const { id } = useParams();
  const { go, toast, copAsk, issues, patchView } = usePortal();
  const a = findAssoc(id);
  // the sidebar's "Association 360" reopens whichever account was viewed last
  useEffect(() => { if (a) patchView({ lastAssoc: a.id }); }, [a, patchView]);

  if (!a) {
    return (
      <div className="empty">
        No association with id “{id}”.{' '}
        <button onClick={() => go('associations')} style={{ color: 'var(--sky-ink)', fontWeight: 800 }}>See all associations →</button>
      </div>
    );
  }

  const h = health(a), col = bandColor(h.band);
  const inv = INVOICES.filter(i => i.a === a.id);
  const iss = issues.filter(i => i.a === a.id);
  const outstanding = inv.filter(i => i.state !== 'Paid').reduce((s, i) => s + i.amt, 0);

  return (
    <>
      <div className="crumb">
        <button onClick={() => go('associations')} style={{ color: 'var(--sky-ink)', fontWeight: 800 }}>‹ All associations</button> · Association 360
      </div>

      <div className="a360-head">
        <div className="logo" style={{ background: a.c, color: a.tc }}>{a.ini}</div>
        <div className="hh">
          <h1>{a.n}</h1>
          <div className="meta">{a.type} · {a.city}, Karnataka · reg. {a.reg} · onboarded {a.since}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <Pill tone={stateTone(a.state)}>{a.state}</Pill>
            <Pill tone={payTone(a.pay)}>{a.pay}</Pill>
            <Pill>{a.plan} · billed {a.bill}</Pill>
          </div>
        </div>
        <div className="healthbox">
          <div className="ring"><Ring pct={h.score} size={56} color={col} /><b className="num" style={{ color: col }}>{h.score}</b></div>
          <div className="hl"><b style={{ color: col }}>{h.band}</b><span>{h.why}</span></div>
        </div>
      </div>

      <div className={'att ' + (h.band === 'Healthy' ? 'good' : 'warn')} style={{ marginBottom: 16 }}>
        <div className="t"><Icon3D name="sparkles" size={16} /> What matters on this account</div>
        <b className="head">{a.note}</b>
        <div className="act">
          <button className="btn sm ai" onClick={() => copAsk('What should I do about ' + a.n.replace(/'/g, '') + '?')}><Sparkles size={14} /> Ask the copilot</button>
          <button className="btn sm ghost" onClick={() => toast('Call sheet opened', a.admin + ' · ' + a.ph, 'telephone_receiver')}><Phone size={13} /> Call {a.admin.split(' ')[0]}</button>
        </div>
      </div>

      <div className="kpis">
        <Kpi label="Plots" value={num(a.plots)} sub={a.blocks.length + ' blocks'} onClick={() => toast('Unit register', `${a.plots} units across ${a.blocks.length} blocks — the register lives in Property Management.`)} icon="office_building" tone="indigo" />
        <Kpi label="Owners registered" value={a.adopt + '%'} sub={`${num(a.owners)} of ${num(a.plots)} plots`} onClick={() => toast('Onboarding', `${a.plots - a.owners} plots still to claim an account.`)} icon="busts_in_silhouette" tone="good" />
        <Kpi label="Annual value" value={fmtL(a.annual)} sub={`${a.plan} · billed ${a.bill}`} onClick={() => go('renewals')} icon="chart_increasing" tone="sky" />
        <Kpi label="Outstanding" value={outstanding ? fmtL(outstanding) : '₹0'} sub={inv.length + ' invoice' + (inv.length === 1 ? '' : 's')} onClick={() => go('collections')} icon="receipt" tone={outstanding ? 'bad' : 'good'} hot={outstanding > 0 && a.pay !== 'Paid'} />
        <Kpi label="Open tickets" value={iss.filter(i => i.st !== 'Resolved').length} sub={iss.length + ' raised in total'} onClick={() => go('issues')} icon="ticket" tone="warn" />
        <Kpi label="Wallet credits" value={num(a.credits)} sub={a.credits ? '~' + Math.round(a.credits / 197) + ' days left' : 'none purchased'} onClick={() => toast('Wallet', '₹1 = 1 credit. Credits fund SMS, WhatsApp and payment-gateway charges.')} icon="coin" tone="violet" />
      </div>

      <div className="grid2">
        <div className="panel">
          <h3>Adoption over 12 months</h3>
          <div className="p-sub">Share of plots with a registered owner — the strongest renewal signal we have</div>
          <div style={{ minHeight: 170 }}><UsageChart assoc={a} /></div>
        </div>
        <div className="panel">
          <h3>Account timeline</h3>
          <div className="p-sub">What has actually happened on this account</div>
          <div className="tl">
            {a.tl.map(([title, detail, when, hot]) => (
              <div key={title} className={'tstep' + (hot ? ' hot' : '')}><b>{title}</b><div>{detail}</div><span className="when">{when}</span></div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid2e">
        <div className="panel">
          <h3>Blocks & units</h3>
          <div className="p-sub">How the society is divided</div>
          <div className="tbl-wrap">
            <table className="tbl" style={{ minWidth: 0 }}>
              <thead><tr><th>Block</th><th>Units</th><th>Floors</th><th>Share</th></tr></thead>
              <tbody>
                {a.blocks.map(([name, units, floors]) => (
                  <tr key={name}><td style={{ color: 'var(--ink)', fontWeight: 600 }}>{name}</td><td className="num">{units}</td><td className="num">{floors}</td><td className="num">{Math.round(units / a.plots * 100)}%</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="panel">
          <h3>Managing committee</h3>
          <div className="p-sub">Office bearers and their direct contacts</div>
          {a.committee.map(([name, role, ph]) => (
            <div key={name} className="person">
              <div className="av" style={{ background: a.c, color: a.tc }}>{initials(name)}</div>
              <div style={{ flex: 1 }}><b>{name}</b><span>{role} · {ph}</span></div>
              <button className="btn sm ghost" onClick={() => toast(name, ph, 'telephone_receiver')}>Call</button>
            </div>
          ))}
          <div className="kv" style={{ marginTop: 10 }}><span>Registered address</span><b style={{ maxWidth: '60%' }}>{a.addr}</b></div>
          <div className="kv"><span>Association admin</span><b>{a.admin} · {a.role}</b></div>
          <div className="kv"><span>Email</span><b>{a.em}</b></div>
        </div>
      </div>

      {iss.length > 0 && (
        <div className="panel">
          <h3>Support issues on this account</h3>
          <div className="p-sub">Raised by residents, committee members or service associates</div>
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>Issue</th><th>Raised by</th><th>Priority</th><th>SLA</th><th>Status</th></tr></thead>
              <tbody>
                {iss.map(i => (
                  <tr key={i.id}>
                    <td><b className="num" style={{ color: 'var(--ink3)', fontSize: 11 }}>{i.id}</b> · <span style={{ color: 'var(--ink)', fontWeight: 600 }}>{i.t}</span></td>
                    <td>{i.by}<div style={{ fontSize: 11, color: 'var(--ink3)' }}>{i.src}</div></td>
                    <td><Pill tone={priTone(i.pri)}>{i.pri}</Pill></td>
                    <td><Pill tone={slaTone(i.slaState)}>{i.sla}</Pill></td>
                    <td><Pill tone={statusTone(i.st)}>{i.st}</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {a.id === 'asn-2' && (
        <CommunityPanel
          title={<><Icon3D name="purple_heart" size={20} /> Community Engagement — the module this account asked for</>}
          sub="Requested at the August business review · not yet in any plan"
          actions={(
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              <a className="btn ai" href={COMMUNITY_SIM_URL} target="_blank" rel="noopener noreferrer"><Heart size={14} /> Open the Community simulation <ExternalLink size={13} /></a>
              <button className="btn ghost" onClick={() => go('modules')}>See it in the module catalog</button>
            </div>
          )}
        >
          Prestige Lakeside Habitat asked for a resident community app: announcements, discussions, events, polls and an AI assistant that files real issues, with a moderation console for the committee. A working simulation of exactly that already exists — it uses this account's own demo records.
        </CommunityPanel>
      )}
    </>
  );
}
