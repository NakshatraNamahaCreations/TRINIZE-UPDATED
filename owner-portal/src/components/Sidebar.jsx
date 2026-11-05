import { ExternalLink, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useLocation } from 'react-router';
import { NAV } from '../data/nav';
import { COMMUNITY_SIM_URL, OPERATOR } from '../data/portal';
import { usePortal } from '../store/context';

/** which nav key owns the current URL — /associations/:id is Association 360, not the list */
function activeKey(path) {
  if (path === '/') return 'command';
  if (/^\/associations\/[^/]+/.test(path)) return 'a360';
  return path.split('/')[1];
}

/** Desktop: full or icon-rail sidebar. Phone: slide-out drawer (`open`). */
export function Sidebar({ collapsed, onToggle, open, onClose }) {
  const { go } = usePortal();
  const on = activeKey(useLocation().pathname);
  return (
    <>
      <div className={'veil side-veil' + (open ? ' show' : '')} onClick={onClose} />
      <aside className={'side' + (open ? ' open' : '')} aria-label="Main navigation">
        <div className="brand">
          <div className="t">T</div>
          <div className="brand-txt"><b>TRINIZE</b><span>OWNER PORTAL 2.0</span></div>
        </div>
        <nav className="side-nav">
          {NAV.map(i => i.grp
            ? <div className="grp" key={i.grp}><span>{i.grp}</span></div>
            : (
              <button key={i.k} className={'nav' + (on === i.k ? ' on' : '')} onClick={() => { go(i.k); onClose(); }} title={collapsed ? i.l : undefined} aria-current={on === i.k ? 'page' : undefined}>
                <span className="ic"><i.ic size={17} strokeWidth={2} /></span>
                <span className="lbl">{i.l}</span>
                {i.cnt && <span className={'cnt' + (i.hot ? ' hot' : '')}>{i.cnt}</span>}
              </button>
            ))}
        </nav>
        <div className="me" title={collapsed ? OPERATOR.name : undefined}>
          <div className="av">{OPERATOR.ini}</div>
          <div className="me-txt"><b>{OPERATOR.name}</b><span>{OPERATOR.role}</span></div>
        </div>
        <div className="foot">
          Concept UI by Ghani · demo data only.<br />
          <a href={COMMUNITY_SIM_URL} target="_blank" rel="noopener noreferrer">Community simulation <ExternalLink size={11} /></a>
        </div>
        <button className="collapse" onClick={onToggle} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <PanelLeftOpen size={16} /> : <><PanelLeftClose size={16} /><span className="lbl">Collapse</span></>}
        </button>
      </aside>
    </>
  );
}
