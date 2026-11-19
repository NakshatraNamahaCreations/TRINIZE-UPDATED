import { Heart, LockKey, SignOut, X } from '@phosphor-icons/react';
import { Fragment } from 'react';
import { NavLink } from 'react-router';
import { useAuth } from '../auth/auth-context';
import { allowed, societyInitials, useAccess, useSociety } from '../lib/access';
import { NAV, type NavKey } from '../lib/nav';
import { isLocked, planLine, usePlan } from '../lib/plan';
import { useStore } from '../store/context';
import { isOpen } from '../store/data';
import { Avatar } from './ui';

export function Sidebar({ open, onClose, onSignOut }: { open: boolean; onClose: () => void; onSignOut: () => void }) {
  const { state } = useStore();
  const { user } = useAuth();
  const { plan } = usePlan();
  const { access } = useAccess();
  const society = useSociety();
  // only the sections this person was given; a group with nothing left in it is not drawn
  const groups = NAV.map(([grp, items]) => [grp, items.filter(i => allowed(access, i.to))] as const).filter(([, items]) => items.length);
  const counts: Record<NavKey, { n: number; hot: boolean }> = {
    issues: { n: state.issues.filter(isOpen).length, hot: false },
    moderation: { n: state.modqueue.filter(m => m.state === 'open').length, hot: true },
  };

  return (
    <>
      {open && <div className="side-veil" onClick={onClose} />}
      <nav className={'adm-side' + (open ? ' open' : '')} aria-label="Society admin">
        <div className="side-brand">
          <div className="mark"><Heart size={16} weight="fill" color="#fff" /></div>
          <div><b>Trinize</b><span>Society admin</span></div>
          <button className="side-close" onClick={onClose} aria-label="Close menu"><X size={18} /></button>
        </div>

        <div className="adm-soc">
          <div className="soc-ic">{societyInitials(society.name) || '·'}</div>
          <div>
            <b>{society.name || 'Your society'}</b>
            <span>{planLine(plan) ?? society.city}</span>
          </div>
        </div>

        <div className="side-scroll">
          {groups.map(([grp, items]) => (
            <Fragment key={grp}>
              <div className="grp">{grp}</div>
              {items.map(({ to, icon: Icon, label, badge }) => {
                const c = badge && counts[badge], locked = isLocked(plan, to);
                return (
                  <NavLink key={to} to={to} className={'nav' + (locked ? ' locked' : '')} onClick={onClose} title={locked ? 'Not in your plan' : undefined}>
                    <Icon size={17} />
                    {label}
                    {locked && <LockKey size={13} weight="fill" className="nav-lock" aria-label="Not in your plan" />}
                    {c && c.n > 0 && <span className={'cnt' + (c.hot ? ' hot' : '')}>{c.n}</span>}
                  </NavLink>
                );
              })}
            </Fragment>
          ))}
        </div>

        {user && (
          <div className="side-user">
            <Avatar name={user.name} size={34} />
            <div className="who">
              <b>{user.name}</b>
              <span>{user.role}</span>
            </div>
            <button className="side-out" onClick={onSignOut} title="Sign out" aria-label="Sign out"><SignOut size={16} /></button>
          </div>
        )}
      </nav>
    </>
  );
}
