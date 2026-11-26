import { CheckCircle } from '@phosphor-icons/react';
import { useEffect, useState, type PointerEvent } from 'react';
import { Empty } from './ui';
import { isOpen, type Issue, type State } from '../store/data';

type Tip = { x: number; y: number; text: string } | null;

/** One floating tooltip per chart; pointer events so charts also answer on a phone. */
function useTip() {
  const [tip, setTip] = useState<Tip>(null);
  useEffect(() => {
    if (!tip) return;
    const h = setTimeout(() => setTip(null), 2400);
    return () => clearTimeout(h);
  }, [tip]);
  const show = (text: string) => (e: PointerEvent) =>
    setTip({ text, x: Math.min(e.clientX + 12, window.innerWidth - 180), y: Math.max(8, e.clientY - 34) });
  const el = tip && <div className="chart-tip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>;
  return { show, hide: () => setTip(null), el };
}

export function TrendChart({ trend }: { trend: State['trend'] }) {
  const { show, hide, el } = useTip();
  const W = 520, H = 170, P = 28;
  const { days, created, resolved } = trend;
  const last = days.length - 1;
  const maxY = Math.max(...created, ...resolved, 4);
  const x = (i: number) => P + i * ((W - P - 10) / last);
  const y = (v: number) => H - P + 6 - (v / maxY) * (H - P - 24);
  // today is a partial day — dash its segment so the drop doesn't read as a collapse
  const solid = (a: number[]) => a.slice(0, last).map((v, i) => (i ? 'L' : 'M') + x(i) + ',' + y(v)).join(' ');
  const tail = (a: number[]) => 'M' + x(last - 1) + ',' + y(a[last - 1]) + ' L' + x(last) + ',' + y(a[last]);
  const area = created.map((v, i) => (i ? 'L' : 'M') + x(i) + ',' + y(v)).join(' ') + ` L${x(last)},${y(0)} L${P},${y(0)} Z`;
  const gridYs = Array.from({ length: Math.floor(maxY / 2) + 1 }, (_, k) => k * 2);
  const series: [number[], string, string][] = [[created, 'var(--s1)', 'created'], [resolved, 'var(--s2)', 'resolved']];
  const tc = created.reduce((a, b) => a + b, 0);
  const tr = resolved.reduce((a, b) => a + b, 0);

  return (
    <div onPointerLeave={hide}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Issues created versus resolved, last 14 days">
        {gridYs.map(g => (
          <g key={g}>
            <line x1={P} y1={y(g)} x2={W - 8} y2={y(g)} stroke="var(--line)" />
            <text x={P - 7} y={y(g) + 3} fill="var(--ink3)" fontSize="9" textAnchor="end" className="num">{g}</text>
          </g>
        ))}
        <line x1={x(last)} y1={y(maxY) - 4} x2={x(last)} y2={H - P + 6} stroke="var(--line2)" strokeDasharray="3 3" />
        <path d={area} fill="var(--s1)" fillOpacity=".08" />
        {series.map(([arr, color]) => (
          <g key={color}>
            <path d={solid(arr)} fill="none" stroke={color} strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />
            <path d={tail(arr)} fill="none" stroke={color} strokeWidth="2.25" strokeLinecap="round" strokeDasharray="4 3" />
          </g>
        ))}
        {series.map(([arr, color, word]) => arr.map((v, i) => (
          <g key={word + i}>
            <circle cx={x(i)} cy={y(v)} r={2 + (i === last ? 1.5 : 0)} fill={color} pointerEvents="none" />
            <circle cx={x(i)} cy={y(v)} r="8" fill="transparent" style={{ cursor: 'pointer' }}
              onPointerMove={show(`${v} ${word} · ${i === last ? 'today so far' : days[i] + ' Aug'}`)}
              onPointerDown={show(`${v} ${word} · ${i === last ? 'today so far' : days[i] + ' Aug'}`)} />
          </g>
        )))}
        {days.map((d, i) => i === last
          ? <text key={d} x={x(i)} y={H - 6} fill="var(--ink2)" fontSize="8.5" textAnchor="end" fontWeight="700">Today</text>
          : i % 2 === 0 && <text key={d} x={x(i)} y={H - 6} fill="var(--ink3)" fontSize="8.5" textAnchor="middle" className="num">{d}</text>)}
      </svg>
      <div className="foot num">14-day total: {tc} created · {tr} resolved · net {tc - tr >= 0 ? '+' : ''}{tc - tr} open</div>
      {el}
    </div>
  );
}

export function CategoryBars({ issues }: { issues: Issue[] }) {
  const { show, hide, el } = useTip();
  const [grown, setGrown] = useState(false);
  useEffect(() => {
    const h = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(h);
  }, []);

  const open = issues.filter(isOpen);
  const cats = new Map<string, number>();
  open.forEach(i => cats.set(i.cat, (cats.get(i.cat) ?? 0) + 1));
  const entries = [...cats.entries()].sort((a, b) => b[1] - a[1]);
  // fixed minimum domain so 1-of-1 never renders as "maxed out"
  const domain = Math.max(...entries.map(e => e[1]), 4);
  const high = open.filter(i => i.pri === 'High').length;

  if (!entries.length) return <Empty icon={CheckCircle} title="No open issues" body="The queue is clear." />;
  return (
    <div onPointerLeave={hide}>
      {entries.map(([c, v]) => (
        <div key={c} className="bar-row">
          <span className="lab">{c}</span>
          <div className="bar-track">
            {[1, 2, 3].map(g => <span key={g} className="grid" style={{ left: (g / domain) * 100 + '%' }} />)}
            <div className="bar-fill" style={{ width: grown ? (v / domain) * 100 + '%' : 0 }}
              onPointerMove={show(`${v} open · ${c}`)} onPointerDown={show(`${v} open · ${c}`)} />
          </div>
          <b className="num" style={{ fontSize: 12, width: 16 }}>{v}</b>
        </div>
      ))}
      <div className="foot num">{open.length} open across {entries.length} categor{entries.length === 1 ? 'y' : 'ies'} · {high} high priority</div>
      {el}
    </div>
  );
}

/** Monthly line of the share of writing that passed the safety check. Months with nothing written leave a gap. */
/** Community hub chart colours, taken from the design */
const BLUE = '#3B6EF0', TEAL = '#5ED3C3', GREEN = '#12A36B';

/** legend for WeekBars, in the same colours */
export const WeekLegend = () => <div className="leg"><span><i style={{ background: TEAL }} />Reported</span><span><i style={{ background: GREEN }} />Resolved</span></div>;

export function PositivityChart({ trend }: { trend: { month: string; total: number; positive: number | null }[] }) {
  const { show, hide, el } = useTip();
  const W = 520, H = 170, P = 30;
  const last = Math.max(1, trend.length - 1);
  const known = trend.map(t => t.positive).filter((v): v is number => v !== null);
  // a floor below the lowest month so small changes still read, never above 60 so 100% doesn't look flat-lined
  const minY = Math.max(0, Math.min(60, Math.floor((Math.min(...known, 100) - 10) / 10) * 10));
  const x = (i: number) => P + i * ((W - P - 12) / last);
  const y = (v: number) => H - P + 6 - ((v - minY) / (100 - minY)) * (H - P - 24);
  const pts = trend.map((t, i) => (t.positive === null ? null : ([x(i), y(t.positive)] as const)));
  // a run of consecutive known months is one segment
  const segs: string[] = [];
  let cur = '';
  pts.forEach(p => { if (p) cur += (cur ? ' L' : 'M') + p[0] + ',' + p[1]; else if (cur) { segs.push(cur); cur = ''; } });
  if (cur) segs.push(cur);
  const grid = [0, 1, 2, 3].map(k => minY + ((100 - minY) / 3) * k);

  if (!known.length) return <Empty icon={CheckCircle} title="Nothing written yet" body="The trend starts once residents post, reply or send thanks." />;
  return (
    <div onPointerLeave={hide}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Share of writing that passed the safety check, by month">
        <defs>
          <linearGradient id="pos-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={BLUE} stopOpacity=".22" /><stop offset="1" stopColor={BLUE} stopOpacity="0" /></linearGradient>
        </defs>
        {grid.map(g => (
          <g key={g}>
            <line x1={P} y1={y(g)} x2={W - 8} y2={y(g)} stroke="var(--line)" />
            <text x={P - 7} y={y(g) + 3} fill="var(--ink3)" fontSize="9" textAnchor="end" className="num">{Math.round(g)}%</text>
          </g>
        ))}
        {segs.map((d, i) => {
          const xs = d.split(/[ML ]+/).filter(Boolean).map(p => Number(p.split(',')[0]));
          return <path key={'a' + i} d={`${d} L${xs[xs.length - 1]},${y(minY)} L${xs[0]},${y(minY)} Z`} fill="url(#pos-fill)" />;
        })}
        {segs.map((d, i) => <path key={'l' + i} d={d} fill="none" stroke={BLUE} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />)}
        {trend.map((t, i) => t.positive !== null && (
          <g key={t.month + i}>
            <circle cx={x(i)} cy={y(t.positive)} r={i === trend.length - 1 ? 4 : 3} fill={BLUE} stroke="#fff" strokeWidth="1.5" pointerEvents="none" />
            <circle cx={x(i)} cy={y(t.positive)} r="9" fill="transparent" style={{ cursor: 'pointer' }}
              onPointerMove={show(`${t.positive}% positive · ${t.month} · ${t.total} written`)} onPointerDown={show(`${t.positive}% positive · ${t.month} · ${t.total} written`)} />
          </g>
        ))}
        {trend.map((t, i) => <text key={'m' + i} x={x(i)} y={H - 6} fill={i === trend.length - 1 ? 'var(--ink2)' : 'var(--ink3)'} fontWeight={i === trend.length - 1 ? 700 : 400} fontSize="8.5" textAnchor="middle">{t.month}</text>)}
      </svg>
      {el}
    </div>
  );
}

/** Seven days of new flags and reports beside the decisions made, as paired bars. */
export function WeekBars({ week }: { week: { day: string; reported: number; resolved: number }[] }) {
  const { show, hide, el } = useTip();
  const W = 300, H = 140, P = 22;
  const maxY = Math.max(4, ...week.flatMap(d => [d.reported, d.resolved]));
  const slot = (W - P - 6) / Math.max(1, week.length);
  const bw = Math.min(11, slot / 3);
  const y = (v: number) => H - 20 - (v / maxY) * (H - 34);
  const tr = week.reduce((a, d) => a + d.reported, 0), td = week.reduce((a, d) => a + d.resolved, 0);
  return (
    <div onPointerLeave={hide}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Reported versus resolved, last 7 days">
        {[0, maxY / 2, maxY].map(g => (
          <g key={g}>
            <line x1={P} y1={y(g)} x2={W - 4} y2={y(g)} stroke="var(--line)" />
            <text x={P - 6} y={y(g) + 3} fill="var(--ink3)" fontSize="9" textAnchor="end" className="num">{Math.round(g)}</text>
          </g>
        ))}
        {week.map((d, i) => {
          const cx = P + slot * i + slot / 2;
          const label = `${d.day}${i === week.length - 1 ? ' (today)' : ''} · ${d.reported} reported · ${d.resolved} resolved`;
          return (
            <g key={d.day + i} style={{ cursor: 'pointer' }} onPointerMove={show(label)} onPointerDown={show(label)}>
              <rect x={cx - slot / 2} y={8} width={slot} height={H - 28} fill="transparent" />
              <rect x={cx - bw - 1} y={y(d.reported)} width={bw} height={Math.max(0, y(0) - y(d.reported))} rx="2" fill={TEAL} />
              <rect x={cx + 1} y={y(d.resolved)} width={bw} height={Math.max(0, y(0) - y(d.resolved))} rx="2" fill={GREEN} />
              <text x={cx} y={H - 6} fill={i === week.length - 1 ? 'var(--ink2)' : 'var(--ink3)'} fontWeight={i === week.length - 1 ? 700 : 400} fontSize="9" textAnchor="middle">{d.day}</text>
            </g>
          );
        })}
      </svg>
      <div className="foot num">7-day total: {tr} reported · {td} resolved</div>
      {el}
    </div>
  );
}
