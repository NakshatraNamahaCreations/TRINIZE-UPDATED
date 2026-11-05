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
