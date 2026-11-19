import { Activity, Bell, ChevronDown, Keyboard, LogOut, Menu, Search, Sparkles } from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { FEED, initials, OPERATOR } from '../data/portal';
import { LIVE } from '../lib/api';
import { useAuth, usePortal } from '../store/context';
import { useDismiss } from './hooks';
import { Icon3D } from './Icon3D';

const WHATS_NEW = [
  ['compass', 'Command centre', 'Four ranked decisions with the money at stake — before any chart.', p => p.go('command')],
  ['hourglass_not_done', 'Renewal runway', 'Every account health-scored, ordered by days remaining.', p => p.go('renewals')],
  ['office_building', 'Association 360', 'Adoption curve, timeline, invoices, tickets and committee on one screen.', p => p.go('a360')],
  ['sparkles', 'Trinize Assistant', 'Ask follow-ups; it drafts the actual email. Suggest-only.', p => p.openCop()],
  ['magnifying_glass_tilted_left', 'Command palette', '⌘K searches accounts, invoices, issues and pages at once.', p => p.setCmdkOpen(true)],
  ['puzzle_piece', 'Plan simulator', 'Pick a tier, see exactly what an account gains.', p => p.go('modules')],
];

function WhatsNew() {
  const portal = usePortal();
  return (
    <>
      <h2>What's new in this concept</h2>
      <div className="msub">A UI/UX concept built on the live portal's own data model — same records, better decisions. Click any item to jump straight to it.</div>
      {WHATS_NEW.map(([icon, title, body, run]) => (
        <button key={title} className="wn" style={{ width: '100%', textAlign: 'left' }} onClick={() => { portal.closeModal(); run(portal); }}>
          <div className="ic" style={{ background: 'var(--raise)' }}><Icon3D name={icon} size={26} /></div>
          <div><b>{title}</b><span>{body}</span></div>
        </button>
      ))}
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)', fontSize: 12, color: 'var(--ink3)' }}>
        {LIVE ? 'Connected to the Trinize API · what you do here is saved.' : 'Demo data only · no backend · nothing here is stored or sent anywhere.'}
      </div>
    </>
  );
}

const SHORTCUTS = [
  [['Ctrl', 'K'], 'Search accounts, invoices, issues and pages (⌘K on Mac)'],
  [['↑', '↓'], 'Move through search results'],
  [['↵'], 'Open the highlighted result'],
  [['Esc'], 'Close search, dialogs and the assistant'],
];

function Shortcuts() {
  return (
    <>
      <h2>Keyboard shortcuts</h2>
      <div className="msub">Operators live in keyboards — these work on every page.</div>
      {SHORTCUTS.map(([keys, what]) => (
        <div key={what} className="kv"><span>{what}</span><b className="keys">{keys.map(k => <kbd key={k}>{k}</kbd>)}</b></div>
      ))}
    </>
  );
}

/** Bell with the activity feed; anything newer than the last open counts as unread. */
function Notifications() {
  const { feed, go } = usePortal();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(LIVE ? Infinity : FEED.length - 3); // demo: three unread on first visit
  const ref = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);
  const unread = Math.max(0, feed.length - seen);

  const toggle = () => {
    setOpen(o => !o);
    setSeen(feed.length);
  };

  return (
    <div className="dd-wrap" ref={ref}>
      <button className="icon-btn" onClick={toggle} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open}>
        <Bell size={18} />
        {unread > 0 && <span className="badge num">{unread}</span>}
      </button>
      {open && (
        <div className="dropdown notif">
          <div className="dd-h"><b>Activity</b><span>Across every account</span></div>
          <div className="dd-list">
            {feed.slice(0, 6).map((f, i) => (
              <div key={i} className="dd-item">
                <span className={'dd-av' + (f.who === 'System' ? ' sys' : '')}>{f.who === 'System' ? <Activity size={14} /> : initials(f.who)}</span>
                <div><b>{f.who}</b> {f.what}<span className="when">{f.when}</span></div>
              </div>
            ))}
          </div>
          <button className="dd-foot" onClick={() => { close(); go('command'); }}>Open the command centre</button>
        </div>
      )}
    </div>
  );
}

function UserMenu() {
  const { openModal } = usePortal();
  const { session, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(ref, open, close);

  return (
    <div className="dd-wrap" ref={ref}>
      <button className="user-btn" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label="Account menu">
        <span className="av">{OPERATOR.ini}</span>
        <span className="user-name">{OPERATOR.first}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="dropdown menu">
          <div className="dd-h"><b>{OPERATOR.name}</b><span>{session?.email ?? OPERATOR.email}</span></div>
          <button className="dd-btn" onClick={() => { close(); openModal(<Shortcuts />); }}><Keyboard size={15} /> Keyboard shortcuts</button>
          {!LIVE && <button className="dd-btn" onClick={() => { close(); openModal(<WhatsNew />); }}><Sparkles size={15} /> What's new</button>}
          <div className="dd-sep" />
          <button className="dd-btn danger" onClick={() => { close(); signOut(); navigate('/login', { replace: true }); }}><LogOut size={15} /> Sign out</button>
        </div>
      )}
    </div>
  );
}

export function Topbar({ onMenu }) {
  const { setCmdkOpen, openModal } = usePortal();
  return (
    <div className="topbar">
      <button className="icon-btn menu-btn" onClick={onMenu} aria-label="Open navigation"><Menu size={19} /></button>
      <button className="searchbox" onClick={() => setCmdkOpen(true)} aria-label="Search everything">
        <Search size={16} /><span>Search associations, invoices, issues…</span><kbd>⌘K</kbd>
      </button>
      <div className="top-right">
        {!LIVE && (
          <button className="whatsnew" onClick={() => openModal(<WhatsNew />)} aria-label="What's new in this concept">
            <Sparkles size={14} /><span className="wn-l">What's new</span>
          </button>
        )}
        {!LIVE && <span className="demo-pill">DEMO DATA</span>}
        <Notifications />
        <UserMenu />
      </div>
    </div>
  );
}
