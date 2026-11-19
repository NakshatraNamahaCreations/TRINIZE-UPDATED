import { ArrowUpRight } from 'lucide-react';
import { useCountUp } from './hooks';

export const Pill = ({ tone = 'dim', children }) => <span className={'pill ' + tone}>{children}</span>;

/** Circular score ring (health). */
export function Ring({ pct, size, color }) {
  const r = size / 2 - 4, c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#EFEEE9" strokeWidth="5" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" strokeDasharray={`${(c * pct / 100).toFixed(1)} ${c.toFixed(1)}`} />
    </svg>
  );
}

/** Tiny trend line in the corner of a KPI card. */
export function Spark({ data, color, w, h }) {
  const mx = Math.max(...data), mn = Math.min(...data), span = (mx - mn) || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, h - 2 - ((v - mn) / span) * (h - 6)]);
  const last = pts[pts.length - 1];
  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={'M' + pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' L')} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0].toFixed(1)} cy={last[1].toFixed(1)} r="2.6" fill={color} />
    </svg>
  );
}

/** Clickable KPI tile: a label, the figure, and one line of context. `hot` marks a figure that needs attention.
    Plain integer values count up; formatted ones (₹1.4L, 76%) render as given. */
export function Kpi({ label, value, sub, onClick, extra, hot, hint }) {
  const isNum = /^[\d,]+$/.test(String(value));
  const counted = useCountUp(isNum ? Number(String(value).replace(/,/g, '')) : 0, isNum);
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className="kpi" onClick={onClick} title={hint}>
      <div className="k-l">{label}{onClick && <ArrowUpRight size={14} className="k-go" style={{ color: hot ? 'var(--bad)' : undefined }} />}</div>
      <div className={'k-v num' + (hot ? ' badv' : '')}>{isNum ? counted.toLocaleString('en-IN') : value}</div>
      <div className="k-s">{sub}</div>
      {extra}
    </Tag>
  );
}

export function PageHead({ crumb, title, children }) {
  return (
    <>
      <div className="crumb">{crumb}</div>
      <h1 className="pgt">{title}</h1>
      <div className="pgs">{children}</div>
    </>
  );
}

/** Purple callout used for the Community Engagement module across pages. */
export function CommunityPanel({ title, sub, children, actions }) {
  return (
    <div className="panel" style={{ borderColor: '#DAD3FA', background: 'linear-gradient(120deg,#FAF9FF,#FAF9FF)' }}>
      <h3>{title}</h3>
      <div className="p-sub">{sub}</div>
      <p style={{ color: 'var(--ink2)', fontSize: 13, maxWidth: '78ch' }}>{children}</p>
      {actions}
    </div>
  );
}

export const Ink = ({ children }) => <b style={{ color: 'var(--ink)' }}>{children}</b>;
