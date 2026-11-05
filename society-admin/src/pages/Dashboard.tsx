import { Alarm, ArrowRight, CalendarCheck, ChartBar, ChartBarHorizontal, CheckCircle, HandWaving, Heart, type Icon as IconType, Megaphone, ShieldWarning, Sparkle, Ticket, TrendUp, WarningDiamond } from '@phosphor-icons/react';
import { useNavigate } from 'react-router';
import { CategoryBars, TrendChart } from '../components/Charts';
import { Empty, PanelHead } from '../components/ui';
import { greeting } from '../lib/format';
import { ADMIN, isOpen } from '../store/data';
import { useStore } from '../store/context';

type Kpi = { label: string; value: number; sub: string; to: string; hot?: boolean; icon: IconType; bg: string; fg: string };

export function Dashboard() {
  const { state } = useStore();
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

  const yoga = state.events.find(e => e.id === 'E-52');
  const cctv = state.polls.find(p => p.id === 'P-20');
  const water = state.announcements.find(a => a.id === 'AN-118');
  const lift = slaOver.find(i => i.id === 'ISS-1039');

  // SLA breaches first, then unacknowledged reports, then the moderation queue, then high-priority work
  const attention: { key: string; icon: IconType; tone: string; title: string; sub: string; to: string }[] = [
    ...slaOver.filter(isOpen).map(i => ({ key: i.id, icon: Alarm, tone: 'bad', title: `${i.id} · SLA breached`, sub: i.title, to: `/issues?open=${i.id}` })),
    ...open.filter(i => i.status === 'Submitted').map(i => ({ key: i.id, icon: Ticket, tone: 'acc', title: `${i.id} · awaiting acknowledgement`, sub: i.title, to: `/issues?open=${i.id}` })),
    ...openMod.map(m => ({ key: m.id, icon: ShieldWarning, tone: 'warn', title: `${m.id} · ${m.cat}`, sub: `${m.kind} by ${m.by}`, to: '/moderation' })),
    ...open.filter(i => i.pri === 'High' && i.slaState !== 'over' && i.status !== 'Submitted').map(i => ({ key: i.id, icon: Ticket, tone: 'warn', title: `${i.id} · high priority`, sub: i.title, to: `/issues?open=${i.id}` })),
  ].slice(0, 5);

  return (
    <>
      <div className="greet">{greeting()}, {ADMIN.first} <HandWaving size={14} /></div>
      <h1>Community dashboard</h1>
      <div className="sub">Everything below is computed live from the same records the resident app writes to — click any number to open its matching list. Counts always reconcile.</div>

      <div className="kpis">
        {kpis.map(k => (
          <button key={k.label} className="kpi" onClick={() => nav(k.to)}>
            <div className="k-ic" style={{ background: k.bg, color: k.fg }}><k.icon size={22} /></div>
            <div className="k-l">{k.label}<ArrowRight size={12} color={k.hot ? 'var(--bad)' : 'var(--ink3)'} /></div>
            <div className="k-v num" style={k.hot ? { color: 'var(--bad)' } : undefined}>{k.value}</div>
            <div className="k-s">{k.sub}</div>
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

      <div className="panel">
        <PanelHead icon={Sparkle} title="This week, in plain words" sub="AI generated · from your own community records — verify anything operational against the ticket before acting" />
        <p style={{ color: 'var(--ink2)', fontSize: 13, maxWidth: '80ch' }}>
          You have <b style={{ color: 'var(--ink)' }} className="num">{open.length} open issue{open.length === 1 ? '' : 's'}</b>
          {lift && <>, and <b style={{ color: 'var(--bad)' }}>ISS-1039 (lift 2, Tower 1) has breached its response SLA</b> — the vendor is waiting on a part; chase OTIS today</>}.{' '}
          {openMod.length > 0 && <>The moderation queue has <b style={{ color: 'var(--ink)' }} className="num">{openMod.length}</b> item{openMod.length > 1 ? 's' : ''} — oldest is {openMod[openMod.length - 1].when}. </>}
          {yoga
            ? <>Yoga by the Lake is {yoga.going >= yoga.cap ? `full (${yoga.going} of ${yoga.cap} — waitlist open)` : `nearly full (${yoga.going} of ${yoga.cap})`}, and the</>
            : 'The'}
          {cctv && <> CCTV poll is trending <b style={{ color: 'var(--ink)' }}>{Math.round((cctv.opts[0].v / (cctv.opts[0].v + cctv.opts[1].v)) * 100)}% in favour</b>.</>}
          {water && <> Wednesday’s water shutdown notice has reached {water.read}% of Towers 4–5 — consider a reminder ping tomorrow.</>}
        </p>
      </div>
      <div className="flow-note"><b>The loop:</b> issues residents report through the Community Assistant land in <b>Issues</b> here — work them through to resolved, and the resident’s tracker updates with every step.</div>
    </>
  );
}
