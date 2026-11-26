import { ArrowRight, CalendarCheck, ChartDonut, Clock, Handshake, HourglassMedium, Star, Truck, Wrench } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Empty, PanelHead, Pill } from './ui';
import { clock, dayLabel, duration, opsStats, siteBoard, type OpsStats, type SiteBoard } from '../lib/visits';

const OVERVIEW = [
  { key: 'open', label: 'Open', color: '#5B3FE0' },
  { key: 'inProgress', label: 'In progress', color: '#3B6EF0' },
  { key: 'pendingVendor', label: 'Pending vendor', color: '#C77B0B' },
  { key: 'resolved', label: 'Resolved · 30 days', color: '#12A36B' },
] as const;

/** Share of requests in each state, as a ring. */
function Donut({ parts }: { parts: { label: string; value: number; color: string }[] }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  const R = 52, C = 2 * Math.PI * R;
  // each slice starts where the ones before it end
  const arcs = parts.map((p, i) => ({ ...p, len: total ? (p.value / total) * C : 0, at: parts.slice(0, i).reduce((a, q) => a + (total ? (q.value / total) * C : 0), 0) }));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
      <svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-label={parts.map(p => `${p.label}: ${p.value}`).join(', ')}>
        <circle cx="70" cy="70" r={R} fill="none" stroke="var(--panel2)" strokeWidth="18" />
        {total > 0 && arcs.map(p => (
          <circle key={p.label} cx="70" cy="70" r={R} fill="none" stroke={p.color} strokeWidth="18" strokeDasharray={`${p.len} ${C - p.len}`} strokeDashoffset={-p.at} transform="rotate(-90 70 70)" />
        ))}
        <text x="70" y="68" textAnchor="middle" style={{ fontSize: 22, fontWeight: 800, fill: 'var(--ink)' }}>{total}</text>
        <text x="70" y="86" textAnchor="middle" style={{ fontSize: 11, fill: 'var(--ink3)' }}>requests</text>
      </svg>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8, flex: '1 1 160px' }}>
        {parts.map(p => (
          <li key={p.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <i style={{ width: 10, height: 10, borderRadius: 3, background: p.color, display: 'inline-block' }} />
            <span style={{ flex: 1, color: 'var(--ink2)' }}>{p.label}</span>
            <b className="num">{p.value}</b>
            <span className="num" style={{ color: 'var(--ink3)', width: 42, textAlign: 'right' }}>{total ? Math.round((p.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The Virtual Property Manager's side of the dashboard: how fast requests are resolved, how residents rate the work,
 * where the requests stand, the next on-site visit's plan and each vendor's workload.
 */
export function OpsPanels() {
  const nav = useNavigate();
  const [ops, setOps] = useState<OpsStats | null>(null);
  const [board, setBoard] = useState<SiteBoard | null>(null);
  useEffect(() => {
    opsStats().then(setOps).catch(() => {});
    // a team member without Issues or Inspections can't see the visits; the panel is left out for them
    siteBoard(21).then(setBoard).catch(() => {});
  }, []);
  if (!ops) return null;

  const r = ops.resolution, sat = ops.satisfaction;
  const faster = r.hours != null && r.prevHours != null ? r.prevHours - r.hours : null;
  const next = board?.days.find(d => d.status === 'Planned' && d.date >= board.today);
  const maxStar = Math.max(1, ...sat.dist.map(d => d.n));

  return (
    <>
      <div className="kpis">
        <button className="kpi" onClick={() => nav('/issues?filter=Resolved')}>
          <div className="k-ic" style={{ background: '#E3F3FC', color: '#0369A1' }}><Clock size={22} /></div>
          <div className="k-l">Avg. resolution time</div>
          <div className="k-v num">{r.hours != null ? duration(r.hours) : '—'}</div>
          <div className="k-s"><span>{faster == null ? `${r.resolved} resolved · 30 days` : `${duration(Math.abs(faster))} ${faster >= 0 ? 'faster' : 'slower'} than the 30 days before`}</span><ArrowRight size={13} /></div>
        </button>
        <button className="kpi" onClick={() => nav('/issues?filter=Resolved')}>
          <div className="k-ic" style={{ background: '#FEF0DC', color: '#B54708' }}><Star size={22} weight="fill" /></div>
          <div className="k-l">Resident satisfaction</div>
          <div className="k-v num">{sat.avg != null ? <>{sat.avg}<span style={{ fontSize: 16, color: 'var(--ink3)' }}> / 5</span></> : '—'}</div>
          <div className="k-s"><span>{sat.count ? `from ${sat.count} rating${sat.count === 1 ? '' : 's'} on resolved requests` : 'no ratings yet'}</span><ArrowRight size={13} /></div>
        </button>
        <button className="kpi" onClick={() => nav('/maintenance')}>
          <div className="k-ic" style={{ background: '#FDF2E4', color: '#C77B0B' }}><HourglassMedium size={22} /></div>
          <div className="k-l">Pending vendor</div>
          <div className="k-v num">{ops.buckets.pendingVendor}</div>
          <div className="k-s"><span>assigned, work not started</span><ArrowRight size={13} /></div>
        </button>
        <button className="kpi" onClick={() => nav('/visits')}>
          <div className="k-ic" style={{ background: '#EFEAFE', color: '#6D28D9' }}><CalendarCheck size={22} /></div>
          <div className="k-l">Next on-site visit</div>
          <div className="k-v num" style={{ fontSize: next ? 22 : 30 }}>{next ? dayLabel(next.date) : '—'}</div>
          <div className="k-s"><span>{next ? `${clock(next.start)} – ${clock(next.end)} · ${next.items.length} planned` : board?.plan ? 'no visit in the next 3 weeks' : 'no regular visit set'}</span><ArrowRight size={13} /></div>
        </button>
      </div>

      <div className="grid2">
        <div className="panel">
          <PanelHead icon={CalendarCheck} title="Weekly on-site plan" sub={next ? `${dayLabel(next.date)} · ${clock(next.start)} – ${clock(next.end)}${board?.manager ? ' · ' + board.manager.name : ''}` : 'The property manager’s next visit'}
            right={<button className="a-btn ghost xs" onClick={() => nav('/visits')}>Full schedule</button>} />
          {next && next.items.length ? (
            <div className="a-tbl-wrap" style={{ boxShadow: 'none' }}>
              <table className="a-tbl compact">
                <thead><tr><th>Time</th><th>Task · location</th><th>Type</th><th>Status</th></tr></thead>
                <tbody>
                  {next.items.map(i => (
                    <tr key={i.id}>
                      <td className="num">{i.time ? clock(i.time) : '—'}</td>
                      <td style={{ whiteSpace: 'normal' }}><b style={{ color: 'var(--ink)', fontWeight: 600 }}>{i.title}</b>{(i.location || i.resident) && <div style={{ fontSize: 11.5, color: 'var(--ink3)' }}>{[i.resident && `${i.resident.name}${i.resident.unit ? ' · ' + i.resident.unit : ''}`, i.location].filter(Boolean).join(' · ')}</div>}</td>
                      <td>{i.kind === 'Request' ? 'Resident request' : i.kind}</td>
                      <td><Pill tone={i.status === 'Done' ? 'good' : 'acc'}>{i.status}</Pill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty icon={CalendarCheck} title={next ? 'Nothing planned yet' : 'No visit planned'} body={next ? 'Add inspections, meetings and follow-ups on the Visits page.' : 'Set the regular weekly visit on the Visits page.'} />}
          {!!board?.requests.length && (
            <button className="a-btn soft sm" style={{ marginTop: 12 }} onClick={() => nav('/visits')}>{board.requests.length} resident request{board.requests.length === 1 ? '' : 's'} waiting for an answer <ArrowRight size={13} /></button>
          )}
        </div>
        <div className="panel">
          <PanelHead icon={ChartDonut} title="Issue overview" sub="Where every request stands right now" tone="good" />
          <Donut parts={OVERVIEW.map(o => ({ label: o.label, value: ops.buckets[o.key], color: o.color }))} />
        </div>
      </div>

      <div className="grid2">
        <div className="panel">
          <PanelHead icon={Truck} title="Vendor task allocation" sub="Open and in-progress work orders, and what each vendor closed in the last 30 days"
            right={<button className="a-btn ghost xs" onClick={() => nav('/maintenance')}>Manage vendors</button>} />
          {ops.vendors.length ? (
            <div className="a-tbl-wrap" style={{ boxShadow: 'none' }}>
              <table className="a-tbl compact">
                <thead><tr><th>Vendor</th><th style={{ textAlign: 'right' }}>Open</th><th style={{ textAlign: 'right' }}>In progress</th><th style={{ textAlign: 'right' }}>Completed</th></tr></thead>
                <tbody>
                  {ops.vendors.slice(0, 6).map(v => (
                    <tr key={v.id}>
                      <td style={{ whiteSpace: 'normal' }}><b style={{ color: 'var(--ink)', fontWeight: 600 }}>{v.name}</b><div style={{ fontSize: 11.5, color: 'var(--ink3)' }}>{v.category}</div></td>
                      <td className="num" style={{ textAlign: 'right' }}>{v.open}</td>
                      <td className="num" style={{ textAlign: 'right' }}>{v.inProgress}</td>
                      <td className="num" style={{ textAlign: 'right', color: 'var(--good)' }}>{v.completed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty icon={Wrench} title="No vendors yet" body="Add vendors under Maintenance to assign work orders." />}
        </div>
        <div className="panel">
          <PanelHead icon={Handshake} title="Resident satisfaction" sub="Ratings residents give when a request is resolved" tone="warn" />
          {sat.count ? (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
                <b className="num" style={{ fontSize: 30, letterSpacing: '-0.03em' }}>{sat.avg}</b><span style={{ color: 'var(--ink3)' }}>/ 5</span>
                <span style={{ color: '#E3A008', letterSpacing: 2 }} aria-hidden>{'★★★★★'.slice(0, Math.round(sat.avg ?? 0))}<span style={{ color: 'var(--line2)' }}>{'★★★★★'.slice(Math.round(sat.avg ?? 0))}</span></span>
                <span style={{ color: 'var(--ink3)', fontSize: 12 }}>{sat.count} ratings</span>
              </div>
              {sat.dist.map(d => (
                <div key={d.star} className="bar-row">
                  <span className="lab" style={{ width: 52 }}>{d.star} star{d.star === 1 ? '' : 's'}</span>
                  <div className="bar-track"><div className="bar-fill" style={{ width: (d.n / maxStar) * 100 + '%', background: d.star >= 4 ? '#12A36B' : d.star === 3 ? '#E3A008' : '#D9534F' }} /></div>
                  <b className="num" style={{ fontSize: 12, width: 38, textAlign: 'right' }}>{Math.round((d.n / sat.count) * 100)}%</b>
                </div>
              ))}
            </>
          ) : <Empty icon={Star} title="No ratings yet" body="Residents can rate a request once it is resolved." />}
        </div>
      </div>
    </>
  );
}
