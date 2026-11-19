import { X, type Icon as IconType } from '@phosphor-icons/react';
import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { avatarColor, initials, type PillTone } from '../lib/format';

export const Pill = ({ tone, children, dot }: { tone: PillTone; children: ReactNode; dot?: boolean }) =>
  <span className={'pill ' + tone + (dot ? ' dot' : '')}>{children}</span>;

export function PageHead({ title, sub, actions }: { title: string; sub: string; actions?: ReactNode }) {
  return (
    <div className="phead">
      <div>
        <h1>{title}</h1>
        <div className="sub">{sub}</div>
      </div>
      {actions && <div className="phead-act">{actions}</div>}
    </div>
  );
}

export function Switch({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return <button className={'sw' + (on ? ' on' : '')} role="switch" aria-checked={on} aria-label={label} onClick={onToggle} />;
}

export function Avatar({ name, size = 30 }: { name: string; size?: number }) {
  const [bg, fg] = avatarColor(name);
  return (
    <span className="avatar" style={{ width: size, height: size, background: bg, color: fg, fontSize: Math.round(size * 0.38) }} aria-hidden>
      {initials(name)}
    </span>
  );
}

export function Empty({ icon: Icon, title, body }: { icon: IconType; title: string; body?: string }) {
  return (
    <div className="empty">
      <span className="empty-ic"><Icon size={22} /></span>
      <b>{title}</b>
      {body && <span>{body}</span>}
    </div>
  );
}

/**
 * An action in a table row, as an icon. Its name shows when the pointer rests on it (or the keyboard reaches it),
 * and is what a screen reader says. On a phone, where nothing hovers, the name is written beside the icon.
 */
export function IconBtn({ icon: Icon, label, tone, primary, className, ...rest }: { icon: IconType; label: string; tone?: 'danger' | 'good'; primary?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...rest} className={'ibtn' + (primary ? ' primary' : '') + (tone ? ' ' + tone : '') + (className ? ' ' + className : '')} aria-label={label} data-tip={label}>
      <Icon size={17} /><span className="ibtn-l">{label}</span>
    </button>
  );
}

/** Small stat chip used in page summaries. */
export function Stat({ label, value, tone, icon: Icon }: { label: string; value: number | string; tone?: PillTone; icon?: IconType }) {
  return (
    <div className={'stat' + (tone ? ' ' + tone : '')}>
      {Icon && <span className="stat-ic"><Icon size={17} /></span>}
      <b className="num">{value}</b>
      <span>{label}</span>
    </div>
  );
}

/** Icon tile + title + subtitle at the top of a panel. */
export function PanelHead({ icon: Icon, title, sub, tone = 'acc', right }: { icon: IconType; title: string; sub?: string; tone?: PillTone; right?: ReactNode }) {
  return (
    <div className="panel-head">
      <span className={'ph-ic ' + tone}><Icon size={19} /></span>
      <div className="ph-t">
        <h3>{title}</h3>
        {sub && <div className="p-sub">{sub}</div>}
      </div>
      {right}
    </div>
  );
}

/** Side panel for one record's full detail. Closes on Escape or a click outside. */
export function Drawer({ label, onClose, children }: { label: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);
  return (
    <>
      <div className="drawer-veil" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={label}>
        <button className="d-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        {children}
      </aside>
    </>
  );
}

/** Labelled facts in a two-column grid — the top of a detail drawer. */
export function Facts({ items }: { items: Record<string, ReactNode> }) {
  return <div className="kv">{Object.entries(items).map(([k, v]) => <div key={k}><span>{k}</span><b>{v}</b></div>)}</div>;
}

/** Rounded tinted square holding an icon — list rows, table cells. */
export function IconTile({ icon: Icon, tone = 'acc', size = 34 }: { icon: IconType; tone?: PillTone; size?: number }) {
  return <span className={'tile ' + tone} style={{ width: size, height: size }}><Icon size={Math.round(size * 0.53)} /></span>;
}
