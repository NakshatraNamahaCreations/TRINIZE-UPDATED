/* Hand-drawn SVG charts, ported from the concept. All hover tooltips go through the shared ChartTip. */
import { ASSOC, bandColor, BILLED, fmtI, fmtL, health, MONTHS, MRR } from '../../data/portal';
import { usePortal } from '../../store/context';
import { useTipProps } from '../hooks';

const path = pts => 'M' + pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' L');
const Tip = ({ head, line }) => <><b>{head}</b>{line}</>;

export function MrrChart() {
  const tip = useTipProps();
  const W = 520, H = 190, PL = 44, PR = 10, PT = 12, PB = 26;
  const d = MRR, mx = Math.max(...d) * 1.08, mn = Math.min(...d) * 0.86;
  const x = i => PL + i * ((W - PL - PR) / (d.length - 1));
  const y = v => PT + (1 - (v - mn) / (mx - mn)) * (H - PT - PB);
  const pts = d.map((v, i) => [x(i), y(v)]);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="Monthly recurring revenue over 12 months, growing from ₹97.1K to ₹1.4L">
      {[0, 1, 2, 3].map(k => {
        const v = mn + (mx - mn) * k / 3;
        return (
          <g key={k}>
            <line x1={PL} y1={y(v)} x2={W - PR} y2={y(v)} stroke="#EEF2F8" strokeWidth="1" />
            <text x={PL - 8} y={y(v) + 3.5} fill="#8B97AC" fontSize="9" textAnchor="end" className="num">{fmtL(Math.round(v))}</text>
          </g>
        );
      })}
      <defs><linearGradient id="mg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0B87D4" stopOpacity=".22" /><stop offset="1" stopColor="#0B87D4" stopOpacity="0" /></linearGradient></defs>
      <path d={`${path(pts)} L${x(d.length - 1).toFixed(1)},${H - PB} L${PL},${H - PB} Z`} fill="url(#mg)" />
      <path d={path(pts)} fill="none" stroke="#0B87D4" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
      {d.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r="9" fill="transparent" {...tip(<Tip head={fmtI(v)} line={MONTHS[i] + ' 2026'} />)} />)}
      <circle cx={x(11)} cy={y(d[11])} r="4.5" fill="#0B87D4" stroke="#fff" strokeWidth="2" />
      <text x={x(11) - 4} y={y(d[11]) - 11} fill="#0C1830" fontSize="11" fontWeight="800" textAnchor="end" className="num">{fmtL(d[11])}</text>
      {MONTHS.map((m, i) => (i % 2 === 0 ? <text key={m} x={x(i)} y={H - 8} fill="#8B97AC" fontSize="9" textAnchor="middle">{m}</text> : null))}
    </svg>
  );
}

/** One bar per account, best first; clicking a bar opens the account. */
export function HealthChart() {
  const { go } = usePortal();
  const tip = useTipProps();
  const rows = ASSOC.map(a => ({ a, h: health(a) })).sort((p, q) => q.h.score - p.h.score);
  return rows.map(({ a, h }) => {
    const col = bandColor(h.band);
    return (
      <button key={a.id} className="health-row" style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left', margin: '7px 0' }} onClick={() => go('a360', a.id)}>
        <span style={{ flex: '0 0 128px', fontSize: 11.5, color: 'var(--ink2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.n}</span>
        <span style={{ flex: 1, height: 16, background: 'var(--wash)', borderRadius: 5, overflow: 'hidden', minWidth: 40 }}>
          <span {...tip(<Tip head={`${h.band} · ${h.score}/100`} line={h.why} />)} style={{ display: 'block', width: h.score + '%', height: '100%', background: col, borderRadius: '0 5px 5px 0' }} />
        </span>
        <b className="num" style={{ fontSize: 12, width: 26, color: col }}>{h.score}</b>
      </button>
    );
  });
}

export function UsageChart({ assoc }) {
  const tip = useTipProps();
  const d = assoc.usage;
  const W = 520, H = 170, PL = 32, PR = 10, PT = 12, PB = 24;
  const x = i => PL + i * ((W - PL - PR) / (d.length - 1));
  const y = v => PT + (1 - v / 100) * (H - PT - PB);
  const up = d[11] >= d[8];
  const col = up ? '#067647' : '#B42318';
  return (
    <>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label={'Owner onboarding percentage over 12 months for ' + assoc.n}>
        {[0, 50, 100].map(v => (
          <g key={v}>
            <line x1={PL} y1={y(v)} x2={W - PR} y2={y(v)} stroke="#EEF2F8" />
            <text x={PL - 6} y={y(v) + 3.5} fill="#8B97AC" fontSize="9" textAnchor="end" className="num">{v}%</text>
          </g>
        ))}
        <path d={path(d.map((v, i) => [x(i), y(v)]))} fill="none" stroke={col} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
        {d.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r="9" fill="transparent" {...tip(<Tip head={v + '% onboarded'} line={MONTHS[i] + ' 2026'} />)} />)}
        <circle cx={x(11)} cy={y(d[11])} r="4.5" fill={col} stroke="#fff" strokeWidth="2" />
      </svg>
      <div style={{ fontSize: 12, color: 'var(--ink2)', marginTop: 4 }}>
        {up ? '▲ Climbing' : '▼ Sliding'} — {d[8]}% → {d[11]}% over the last quarter. {up ? 'Adoption at this level protects the renewal.' : 'A falling adoption curve is what a churn looks like three months early.'}
      </div>
    </>
  );
}

export function BilledChart() {
  const tip = useTipProps();
  const d = BILLED, W = 520, H = 170, PL = 40, PR = 8, PT = 10, PB = 24;
  const mx = Math.max(...d.map(r => r[1])) * 1.1;
  const bw = (W - PL - PR) / d.length;
  const y = v => PT + (1 - v / mx) * (H - PT - PB);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="Invoiced versus collected by month">
      {[0, mx / 2, mx].map(v => (
        <g key={v}>
          <line x1={PL} y1={y(v)} x2={W - PR} y2={y(v)} stroke="#EEF2F8" />
          <text x={PL - 6} y={y(v) + 3.5} fill="#8B97AC" fontSize="9" textAnchor="end" className="num">{fmtL(Math.round(v))}</text>
        </g>
      ))}
      {d.map(([m, inv, col], i) => {
        const x0 = PL + i * bw + 7, w = (bw - 16) / 2 - 1;
        return (
          <g key={m}>
            <rect x={x0} y={y(inv)} width={w} height={H - PB - y(inv)} rx="3" fill="var(--s1)" {...tip(<Tip head={fmtI(inv) + ' invoiced'} line={m + ' 2026'} />)} />
            <rect x={x0 + w + 2} y={y(col)} width={w} height={H - PB - y(col)} rx="3" fill="var(--s2)" {...tip(<Tip head={fmtI(col) + ' collected'} line={m + ' 2026'} />)} />
            <text x={x0 + w} y={H - 8} fill="#8B97AC" fontSize="9" textAnchor="middle">{m}</text>
          </g>
        );
      })}
    </svg>
  );
}
