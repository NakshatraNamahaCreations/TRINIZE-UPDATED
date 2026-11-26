import { Alarm, ArrowRight, CalendarCheck, ChartBar, ChartBarHorizontal, CheckCircle, ClockCounterClockwise, HandWaving, Heart, type Icon as IconType, Megaphone, ShieldWarning, Sparkle, Ticket, TrendUp, UsersThree, WarningDiamond } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { LIVE } from '../lib/api';
import { allowed, useAccess } from '../lib/access';
import { setupLive, type SetupStep } from '../lib/live';
import { CategoryBars, TrendChart } from '../components/Charts';
import { OpsPanels } from '../components/OpsPanels';
import { Empty, PanelHead, Pill } from '../components/ui';
import { greeting } from '../lib/format';
import { useAuth } from '../auth/auth-context';
import { ADMIN, isOpen } from '../store/data';
import { useStore } from '../store/context';

type Kpi = { label: string; value: number; sub: string; to: string; hot?: boolean; icon: IconType; bg: string; fg: string };

export function Dashboard() {
  const { state } = useStore();
  const { user } = useAuth();
  /* a new society's first steps; gone once every one of them is done */
  const { access } = useAccess();
  const [setup, setSetup] = useState<{ steps: SetupStep[]; done: number; total: number } | null>(null);
  const stamp = state.users.length + ':' + state.announcements.length + ':' + state.ai.docs.length;
  useEffect(() => { if (LIVE) setupLive().then(setSetup).catch(() => {}); }, [stamp]);
  const todo = (setup?.steps ?? []).filter(s => allowed(access, s.to));
  const nav = useNavigate();
  const open = state.issues.filter(isOpen);
  const resolved = state.issues.length - open.length;
  const slaOver = state.issues.filter(i => i.slaState === 'over');
  const openMod = state.modqueue.filter(m => m.state === 'open');
  const activePolls = state.polls.filter(p => !p.closed);
  const votes = activePolls.reduce((a, p) => a + p.opts.reduce((x, o) => x + o.v, 0), 0);
  const going = state.events.reduce((a, e) => a + e.going, 0);
  const avgRead = Math.round(state.announcements.reduce((a, x) => a + x.read, 0) / Math.max(1, state.announcements.length));

  const kpis: Kpi[] = [
    { label: 'Open issues', value: open.length, sub: `${resolved} resolved · 30 days`, to: '/issues?filter=Open', icon: Ticket, bg: '#EFEAFE', fg: '#6D28D9' },
    { label: 'SLA breached', value: slaOver.length, sub: 'response SLA missed', to: '/issues?filter=SLA breached', hot: slaOver.length > 0, icon: Alarm, bg: '#FDE9E7', fg: '#B42318' },
    { label: 'Moderation queue', value: openMod.length, sub: 'awaiting review', to: '/moderation', hot: openMod.length > 0, icon: ShieldWarning, bg: '#FEF0DC', fg: '#B54708' },
    { label: 'Active polls', value: activePolls.length, sub: `${votes} votes so far`, to: '/events-polls', icon: ChartBar, bg: '#E3F3FC', fg: '#0369A1' },
    { label: 'Event RSVPs', value: going, sub: `across ${state.events.length} upcoming events`, to: '/events-polls', icon: CalendarCheck, bg: '#E4F7EE', fg: '#067647' },
    { label: 'Announcements', value: state.announcements.length, sub: `avg read rate ${avgRead}%`, to: '/announcements', icon: Megaphone, bg: '#E0E7FF', fg: '#4338CA' },
    { label: 'Gratitudes', value: state.gratitudes, sub: 'private notes · each one audited', to: '/audit', icon: Heart, bg: '#FCE7F3', fg: '#BE185D' },
  ];

  // the facts the plain-words summary is written from: the worst breach, the fullest event, the busiest open poll, the notice that reached fewest
  const breach = slaOver.filter(isOpen)[0];
  const fullest = [...state.events].sort((a, b) => b.going / b.cap - a.going / a.cap)[0];
  const busiest = [...activePolls].map(p => ({ p, total: p.opts.reduce((x, o) => x + o.v, 0) })).sort((a, b) => b.total - a.total)[0];
  const lead = busiest && busiest.total > 0 ? [...busiest.p.opts].sort((a, b) => b.v - a.v)[0] : undefined;
  const quiet = state.announcements.filter(a => a.ack && a.read < 50)[0];
  const owners = state.users.filter(u => u.role === 'Owner').length;
  const flats = new Set(state.users.map(u => u.unit)).size;
  const standing = state.users.filter(u => u.status !== 'Active').length;

  // SLA breaches first, then unacknowledged reports, then the moderation queue, then high-priority work
  const attention: { key: string; icon: IconType; tone: string; title: string; sub: string; to: string }[] = [
    ...slaOver.filter(isOpen).map(i => ({ key: i.id, icon: Alarm, tone: 'bad', title: `${i.id} · SLA breached`, sub: i.title, to: `/issues?open=${i.id}` })),
    ...open.filter(i => i.status === 'Submitted').map(i => ({ key: i.id, icon: Ticket, tone: 'acc', title: `${i.id} · awaiting acknowledgement`, sub: i.title, to: `/issues?open=${i.id}` })),
    ...openMod.map(m => ({ key: m.id, icon: ShieldWarning, tone: 'warn', title: `${m.id} · ${m.cat}`, sub: `${m.kind} by ${m.by}`, to: '/moderation' })),
    ...open.filter(i => i.pri === 'High' && i.slaState !== 'over' && i.status !== 'Submitted').map(i => ({ key: i.id, icon: Ticket, tone: 'warn', title: `${i.id} · high priority`, sub: i.title, to: `/issues?open=${i.id}` })),
  ].slice(0, 5);

  return (
    <>
      <div className="greet">{greeting()}, {user?.name.split(' ')[0] ?? ADMIN.first} <HandWaving size={14} /></div>
      <h1>Community dashboard</h1>
      <div className="sub">Everything below is computed live from the same records the resident app writes to — click any number to open its matching list. Counts always reconcile.</div>

      {setup && setup.done < setup.total && todo.length > 0 && (
        <div className="panel setup">
          <div className="setup-h">
            <div><b>Finish setting up your society</b><span>{setup.done} of {setup.total} done — residents get the most from the app once these are in place.</span></div>
            <div className="prog" style={{ width: 160 }}><i style={{ width: (setup.done / setup.total) * 100 + '%', background: 'var(--good)' }} /></div>
          </div>
          <div className="setup-steps">
            {todo.map((s, i) => (
              <button key={s.key} className={'setup-step' + (s.done ? ' done' : '')} onClick={() => nav(s.to)}>
                <span className="n">{s.done ? <CheckCircle size={18} weight="fill" /> : i + 1}</span>
                <span className="t"><b>{s.title}</b><span>{s.done ? `Done · ${s.count} so far` : s.body}</span></span>
                <ArrowRight size={15} />
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="kpis">
        {kpis.map(k => (
          <button key={k.label} className="kpi" onClick={() => nav(k.to)}>
            <div className="k-ic" style={{ background: k.bg, color: k.fg }}><k.icon size={22} /></div>
            <div className="k-l">{k.label}</div>
            <div className="k-v num" style={k.hot ? { color: 'var(--bad)' } : undefined}>{k.value}</div>
            <div className="k-s"><span>{k.sub}</span><ArrowRight size={13} color={k.hot ? 'var(--bad)' : 'var(--ink3)'} /></div>
          </button>
        ))}
      </div>

      <div className="grid2">
        <div className="panel">
          <PanelHead icon={TrendUp} title="Issues — created vs resolved" sub="Last 14 days · updates when a resident reports or you resolve" />
          <div className="leg"><span><i style={{ background: 'var(--s1)' }} />Created</span><span><i style={{ background: 'var(--s2)' }} />Resolved</span></div>
          <TrendChart trend={state.trend} />
        </div>
        <div className="stack">
          <div className="panel">
            <PanelHead icon={ChartBarHorizontal} title="Open issues by category" sub="Where the workload is right now" tone="good" />
            <CategoryBars issues={state.issues} />
          </div>
          <div className="panel">
            <PanelHead icon={WarningDiamond} title="Needs attention" sub="Oldest and most urgent first" tone="bad" />
            {attention.length ? (
              <ul className="attn">
                {attention.map(a => (
                  <li key={a.key}>
                    <button onClick={() => nav(a.to)}>
                      <span className={'attn-ic ' + a.tone}><a.icon size={17} /></span>
                      <span className="attn-t"><b>{a.title}</b><span>{a.sub}</span></span>
                      <ArrowRight size={14} className="attn-go" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : <Empty icon={CheckCircle} title="All clear" body="Nothing is waiting on you right now." />}
          </div>
        </div>
      </div>

      {/* the Virtual Property Manager's numbers: resolution time, satisfaction, the on-site visit, vendor workload */}
      <OpsPanels />

      <div className="panel">
        <PanelHead icon={Sparkle} title="This week, in plain words" sub="AI generated · from your own community records — verify anything operational against the ticket before acting" />
        <p style={{ color: 'var(--ink2)', fontSize: 13, maxWidth: '80ch' }}>
          You have <b style={{ color: 'var(--ink)' }} className="num">{open.length} open issue{open.length === 1 ? '' : 's'}</b>
          {breach && <>, and <b style={{ color: 'var(--bad)' }}>{breach.id} ({breach.title}) has breached its SLA</b>{breach.vendor !== '—' && <> — chase {breach.vendor} today</>}</>}.{' '}
          {openMod.length > 0 && <>The moderation queue has <b style={{ color: 'var(--ink)' }} className="num">{openMod.length}</b> item{openMod.length > 1 ? 's' : ''} — the oldest arrived {openMod[openMod.length - 1].when.toLowerCase()}. </>}
          {fullest && <>{fullest.title} is {fullest.going >= fullest.cap ? `full (${fullest.going} of ${fullest.cap} — further RSVPs join the waitlist)` : `the fullest event so far (${fullest.going} of ${fullest.cap})`}. </>}
          {lead && <>On “{busiest.p.q}”, <b style={{ color: 'var(--ink)' }}>{lead.t}</b> leads with {Math.round((lead.v / busiest.total) * 100)}% of {busiest.total} votes. </>}
          {quiet && <>“{quiet.title}” has reached only {quiet.read}% of {quiet.aud.toLowerCase()} — consider a reminder.</>}
        </p>
      </div>

      <div className="grid3">
        <div className="panel">
          <PanelHead icon={CalendarCheck} title="Upcoming events" sub="RSVPs against capacity" tone="good" right={<button className="a-btn ghost xs" onClick={() => nav('/events-polls')}>All</button>} />
          {state.events.length ? (
            <ul className="mini">
              {state.events.slice(0, 4).map(e => {
                const pct = Math.min(100, Math.round((e.going / e.cap) * 100));
                return (
                  <li key={e.id}>
                    <span className="m-t"><b>{e.title}</b><span>{e.when} · {e.where}</span>
                      <span className="prog" style={{ display: 'block', height: 5, marginTop: 5 }}><i style={{ width: pct + '%', background: pct >= 100 ? 'var(--bad)' : pct >= 85 ? 'var(--warn)' : 'var(--acc)' }} /></span>
                    </span>
                    <b className="num" style={{ color: 'var(--ink)' }}>{e.going}/{e.cap}</b>
                  </li>
                );
              })}
            </ul>
          ) : <div className="d-none">No upcoming events.</div>}
        </div>
        <div className="panel">
          <PanelHead icon={Megaphone} title="Latest announcements" sub="Newest first" right={<button className="a-btn ghost xs" onClick={() => nav('/announcements')}>All</button>} />
          {state.announcements.length ? (
            <ul className="mini">
              {state.announcements.slice(0, 4).map(a => (
                <li key={a.id}>
                  <span className="m-t"><b>{a.title}</b><span>{a.aud} · {a.when}</span></span>
                  {a.pri === 'High' ? <Pill tone="bad">High</Pill> : <Pill tone="dim">Normal</Pill>}
                </li>
              ))}
            </ul>
          ) : <div className="d-none">Nothing published yet.</div>}
        </div>
        <div className="panel">
          <PanelHead icon={ClockCounterClockwise} title="Recent activity" sub="From the audit log" tone="dim" right={<button className="a-btn ghost xs" onClick={() => nav('/audit')}>All</button>} />
          {state.audit.length ? (
            <ul className="mini">
              {state.audit.slice(0, 5).map((a, i) => (
                <li key={i}><span className="m-t"><b>{a.who}</b><span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.what}</span></span><span style={{ fontSize: 11, color: 'var(--ink3)', whiteSpace: 'nowrap' }}>{a.when}</span></li>
              ))}
            </ul>
          ) : <div className="d-none">Nothing has been logged yet.</div>}
        </div>
      </div>

      <div className="panel">
        <PanelHead icon={UsersThree} title="Community at a glance" sub="Residents on the app — open Residents or Flats & units for every flat and household" />
        <div className="snap">
          <button onClick={() => nav('/residents')}><b className="num">{state.users.length}</b><span>Residents</span></button>
          <button onClick={() => nav('/flats')}><b className="num">{flats}</b><span>Flats with residents</span></button>
          <button onClick={() => nav('/residents')}><b className="num">{owners}</b><span>Owners</span></button>
          <button onClick={() => nav('/residents')}><b className="num">{state.users.length - owners}</b><span>Tenants & family</span></button>
          <button onClick={() => nav('/residents')}><b className="num" style={standing ? { color: 'var(--warn)' } : undefined}>{standing}</b><span>Warned or restricted</span></button>
          <button onClick={() => nav('/issues?filter=Resolved')}><b className="num" style={{ color: 'var(--good)' }}>{state.issues.length ? Math.round((resolved / state.issues.length) * 100) : 0}%</b><span>Issues resolved</span></button>
        </div>
      </div>
      <div className="flow-note"><b>The loop:</b> issues residents report through the Community Assistant land in <b>Issues</b> here — work them through to resolved, and the resident’s tracker updates with every step.</div>
    </>
  );
}
