import { ArrowCounterClockwise, CaretDown, CaretRight, List, MagnifyingGlass, SignOut } from '@phosphor-icons/react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth/auth-context';
import { crumbFor } from '../lib/nav';
import { useStore } from '../store/context';
import { Avatar } from './ui';

export function Header({ onMenu, onSignOut }: { onMenu: () => void; onSignOut: () => void }) {
  const { user } = useAuth();
  const { actions } = useStore();
  const { pathname } = useLocation();
  const nav = useNavigate();
  const [grp, page] = crumbFor(pathname);
  const [q, setQ] = useState('');
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl+K focuses search; Esc and outside clicks close the user menu
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === 'Escape') setMenu(false);
    };
    const onClick = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick); };
  }, []);

  const search = (e: FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    nav(term ? '/issues?q=' + encodeURIComponent(term) : '/issues');
    setQ('');
    searchRef.current?.blur();
  };

  return (
    <header className="hdr">
      <button className="hdr-menu" onClick={onMenu} aria-label="Open menu"><List size={20} /></button>
      <div className="crumb">
        <span>{grp}</span><CaretRight size={14} /><b>{page}</b>
      </div>

      <form className="hdr-search" onSubmit={search} role="search">
        <MagnifyingGlass size={15} />
        <input ref={searchRef} value={q} onChange={e => setQ(e.target.value)} placeholder="Search issues, residents, units…" aria-label="Search issues" />
        <kbd>Ctrl K</kbd>
      </form>

      <span className="demo-pill" title="Simulation — every record is fictional">Demo data</span>

      {user && (
        <div className="umenu" ref={menuRef}>
          <button className="ubtn" onClick={() => setMenu(m => !m)} aria-expanded={menu} aria-haspopup="menu">
            <Avatar name={user.name} size={32} />
            <span className="uname"><b>{user.name}</b><span>{user.role}</span></span>
            <CaretDown size={15} />
          </button>
          {menu && (
            <div className="udrop" role="menu">
              <div className="uhead"><b>{user.name}</b><span>{user.email}</span></div>
              <button role="menuitem" onClick={() => { setMenu(false); actions.reset(); }}><ArrowCounterClockwise size={15} />Reset demo data</button>
              <button role="menuitem" className="danger" onClick={() => { setMenu(false); onSignOut(); }}><SignOut size={15} />Sign out</button>
            </div>
          )}
        </div>
      )}
    </header>
  );
}
