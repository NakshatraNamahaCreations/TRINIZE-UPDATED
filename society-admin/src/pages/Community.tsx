import { ArrowDown, ArrowRight, ArrowUp, ChartLineUp, ChatsCircle, CheckCircle, Handshake, Heart, type Icon as IconType, ListChecks, Robot, ShieldCheck, ShieldWarning, Smiley, UsersThree, Warning } from '@phosphor-icons/react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { PositivityChart, WeekBars, WeekLegend } from '../components/Charts';
import { Avatar, Empty, PageHead, PanelHead, Pill } from '../components/ui';
import { ApiError, LIVE } from '../lib/api';
import { sevTone } from '../lib/format';
import { communityInsightsLive, type CommunityInsights } from '../lib/live';

/** the four house rules residents see on their Home screen (resident app: home.g.*) */
const RULES = ['Be respectful', 'Use kind words', 'Create a positive space', 'No abuse or hate speech'];

/** sample figures for the demo console (not connected to a server) */
const DEMO: CommunityInsights = {
  members: { total: 312, active: 248, prev: 226 },
  posts: { today: 14, yesterday: 11 },
  positive: { now: 96, prev: 92, written: 420 },
  held: { now: 7, prev: 9 },
  trend: [['May', 88], ['Jun', 90], ['Jul', 89], ['Aug', 92], ['Sep', 93], ['Oct', 95], ['Nov', 96]].map(([month, positive]) => ({ month: month as string, positive: positive as number, total: 60 })),
  week: [['Wed', 3, 2], ['Thu', 5, 4], ['Fri', 2, 3], ['Sat', 4, 4], ['Sun', 1, 2], ['Mon', 3, 2], ['Tue', 2, 1]].map(([day, reported, resolved]) => ({ day: day as string, reported: reported as number, resolved: resolved as number })),
  alerts: [
    { id: 'd1', ref: 'MOD-91', kind: 'Discussion post', category: 'Abusive', severity: 'High', state: 'open', createdAt: new Date(Date.now() - 2 * 60_000).toISOString(), by: 'Ankit Sharma' },
    { id: 'd2', ref: 'MOD-90', kind: 'Reported post', category: 'Reported by a resident', severity: 'Medium', state: 'open', createdAt: new Date(Date.now() - 15 * 60_000).toISOString(), by: 'Priya Nair' },
    { id: 'd3', ref: 'MOD-87', kind: 'Discussion post', category: 'Spam / marketplace', severity: 'Low', state: 'done', createdAt: new Date(Date.now() - 60 * 60_000).toISOString(), by: 'Deepak R' },
  ],
  givers: [{ id: 'g1', name: 'Aarav Mehta', n: 24 }, { id: 'g2', name: 'Neha Iyer', n: 21 }, { id: 'g3', name: 'Rohit Kumar', n: 19 }],
};

const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'yesterday' : `${d}d ago`;
};

/** change against the previous period; `lowerIsBetter` flips the colour (fewer held messages is good news) */
function delta(now: number | null, prev: number | null, { points, lowerIsBetter }: { points?: boolean; lowerIsBetter?: boolean } = {}): ReactNode {
  // nothing to compare against (a new society, or a quiet earlier period): say nothing rather than "no change"
  if (now === null || prev === null) return null;
  const diff = points ? now - prev : prev ? Math.round(((now - prev) / prev) * 100) : now ? 100 : 0;
  if (diff === 0) return <span>no change · </span>;
  const good = lowerIsBetter ? diff < 0 : diff > 0;
  const A = diff > 0 ? ArrowUp : ArrowDown;
  return <><span style={{ color: good ? 'var(--good)' : 'var(--bad)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 3 }}><A size={12} weight="bold" />{Math.abs(diff)}{points ? ' pts' : '%'}</span> · </>;
}

type Kpi = { label: string; value: string; delta: ReactNode; note: string; to: string; icon: IconType; bg: string; fg: string };

export function Community() {
  const nav = useNavigate();
  const [data, setData] = useState<CommunityInsights | null>(LIVE ? null : DEMO);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    if (!LIVE) return;
    communityInsightsLive().then(d => { setData(d); setError(''); })
      .catch(e => setError(e instanceof ApiError ? e.message : 'Couldn’t load community figures. Check your connection and try again.'));
  }, []);
  useEffect(() => {
    load();
    const h = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 60_000);
    return () => clearInterval(h);
  }, [load]);

  const head = (
    <PageHead title="Community hub" sub="Building a healthier community — how residents are talking to each other, computed from what they post, reply and send in the resident app."
      actions={<>
        <button className="a-btn ghost" onClick={() => nav('/ai')}><Robot size={15} />Tone settings</button>
        <button className="a-btn" onClick={() => nav('/moderation')}><ShieldCheck size={15} />Moderation queue</button>
      </>} />
  );
  if (!data) return <>{head}<div className="panel">{error ? <Empty icon={Warning} title="Couldn’t load" body={error} /> : <div className="d-none">Loading community figures…</div>}</div></>;

  const { members, posts, positive, held } = data;
  const kpis: Kpi[] = [
    { label: 'Active members', value: String(members.active), delta: delta(members.active, members.prev || null), note: `of ${members.total} on the app · 30 days`, to: '/residents', icon: UsersThree, bg: '#EFEAFE', fg: '#6D28D9' },
    { label: 'Posts today', value: String(posts.today), delta: delta(posts.today, posts.yesterday || null), note: `posts & replies · ${posts.yesterday} yesterday`, to: '/moderation', icon: ChatsCircle, bg: '#E3F3FC', fg: '#0369A1' },
    { label: 'Positive', value: positive.now === null ? '—' : positive.now + '%', delta: delta(positive.now, positive.prev, { points: true }), note: `passed the safety check · ${positive.written} written`, to: '/moderation', icon: Smiley, bg: '#E4F7EE', fg: '#067647' },
    { label: 'Held or hidden', value: String(held.now), delta: delta(held.now, held.prev || null, { lowerIsBetter: true }), note: 'kept out of view · 30 days', to: '/moderation', icon: ShieldWarning, bg: '#FDE9E7', fg: '#B42318' },
  ];
  const openAlerts = data.alerts.filter(a => a.state === 'open').length;
  const maxGiven = Math.max(1, ...data.givers.map(g => g.n));

  return (
    <>
      {head}
      {!LIVE && <div className="flow-note" style={{ marginBottom: 14 }}>Demo figures — connect the console to the server to see your society’s own.</div>}

      <div className="kpis">
        {kpis.map(k => (
          <button key={k.label} className="kpi" onClick={() => nav(k.to)}>
            <div className="k-ic" style={{ background: k.bg, color: k.fg }}><k.icon size={22} /></div>
            <div className="k-l">{k.label}</div>
            <div className="k-v num">{k.value}</div>
            <div className="k-s"><span>{k.delta}{k.note}</span><ArrowRight size={13} color="var(--ink3)" /></div>
          </button>
        ))}
      </div>

      <div className="grid2">
        <div className="panel">
          <PanelHead icon={ChartLineUp} title="Community positivity trend" sub="Share of posts, replies and thanks that passed the safety check · last 7 months" tone="good"
            right={positive.now !== null && positive.prev !== null && positive.now >= positive.prev ? <Pill tone="good">Growing</Pill> : undefined} />
          <PositivityChart trend={data.trend} />
          {(() => {
            const months = data.trend.filter(t => t.positive !== null);
            const last = months[months.length - 1];
            return last && <div className="foot num">{last.month}: {last.positive}% of {last.total} written{months.length < data.trend.length && ` · ${months.length} of ${data.trend.length} months had activity`}</div>;
          })()}
        </div>
        <div className="panel">
          <PanelHead icon={Warning} title="Recent alerts" sub={openAlerts ? `${openAlerts} still waiting for a decision` : 'Everything here has been decided'} tone="bad"
            right={<button className="a-btn ghost xs" onClick={() => nav('/moderation')}>Queue</button>} />
          {data.alerts.length ? (
            <ul className="attn">
              {data.alerts.map(a => (
                <li key={a.id}>
                  <button onClick={() => nav('/moderation')}>
                    <span className={'attn-ic ' + (a.severity === 'High' ? 'bad' : a.severity === 'Medium' ? 'warn' : '')}><ShieldWarning size={17} /></span>
                    <span className="attn-t"><b>{a.category === 'Reported by a resident' ? 'Reported by a resident' : `${a.category} ${a.kind.toLowerCase()}`}</b><span>{a.ref} · {a.by}</span></span>
                    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flex: '0 0 auto' }}>
                      <span style={{ fontSize: 11, color: 'var(--ink3)' }}>{ago(a.createdAt)}</span>
                      {a.state === 'open' ? <Pill tone={sevTone(a.severity)}>{a.severity}</Pill> : <Pill tone="good">Decided</Pill>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <Empty icon={CheckCircle} title="No alerts" body="Nothing has been flagged or reported yet." />}
        </div>
      </div>

      <div className="grid3">
        <div className="panel">
          <PanelHead icon={Heart} title="Top gratitude givers" sub="Thanks sent · last 30 days — counts only, notes stay private" tone="bad" />
          {data.givers.length ? (
            <ul className="mini">
              {data.givers.map((g, i) => (
                <li key={g.id ?? g.name}>
                  <b className="num" style={{ width: 16, color: 'var(--ink3)' }}>{i + 1}</b>
                  <Avatar name={g.name} size={28} />
                  <span className="m-t"><b>{g.name}</b>
                    <span className="prog" style={{ display: 'block', height: 5, marginTop: 5 }}><i style={{ width: (g.n / maxGiven) * 100 + '%', background: '#E0457B' }} /></span>
                  </span>
                  <b className="num" style={{ color: 'var(--ink)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>{g.n}<Heart size={12} weight="fill" color="#E0457B" /></b>
                </li>
              ))}
            </ul>
          ) : <div className="d-none">No thanks sent in the last 30 days.</div>}
        </div>
        <div className="panel">
          <PanelHead icon={ListChecks} title="Reported vs resolved" sub="Flags and reports against decisions · last 7 days" />
          <WeekLegend />
          <WeekBars week={data.week} />
        </div>
        <div className="panel">
          <PanelHead icon={Handshake} title="Community rules" sub="The guidelines residents see on their Home screen" tone="good" />
          <ul className="mini">
            {RULES.map(r => (
              <li key={r}><CheckCircle size={16} weight="fill" color="var(--good)" /><span className="m-t" style={{ color: 'var(--ink)' }}>{r}</span></li>
            ))}
          </ul>
          <div className="flow-note" style={{ marginTop: 10 }}>Tones residents can rewrite in, and how strict the safety check is, are set in <button onClick={() => nav('/ai')} style={{ color: 'var(--acc-ink)', fontWeight: 600, textDecoration: 'underline' }}>AI controls</button>.</div>
        </div>
      </div>
    </>
  );
}
