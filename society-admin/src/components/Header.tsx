import { ArrowCounterClockwise, CaretDown, CaretRight, List, MagnifyingGlass, SignOut } from '@phosphor-icons/react';
import { api, LIVE } from '../lib/api';
import { association } from '../lib/live';
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
  const [hits, setHits] = useState<{ kind: string; label: string; sub: string; link: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // ⌘K / Ctrl+K focuses search; Esc and outside clicks close the user menu
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === 'Escape') setMenu(false);
    };
    const onClick = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); if (!formRef.current?.contains(e.target as Node)) setSearching(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick); };
  }, []);

  // connected: as you type, look across flats, people, vendors, work orders, bills and the console's own screens
  useEffect(() => {
    const term = q.trim();
    if (!LIVE || term.length < 2) return;
    const h = setTimeout(() => { api<typeof hits>('GET', `/v1/admin/${association()}/search?q=${encodeURIComponent(term)}`).then(r => { setHits(r); setSearching(true); }).catch(() => setHits([])); }, 220);
    return () => clearTimeout(h);
  }, [q]);
  const go = (link: string) => { setQ(''); setSearching(false); searchRef.current?.blur(); nav(link); };
  const shown = searching && q.trim().length >= 2;

  const search = (e: FormEvent) => {
    e.preventDefault();
    const term = q.trim();
    nav(term ? '/issues?q=' + encodeURIComponent(term) : '/issues');
    setQ('');
    setSearching(false);
    searchRef.current?.blur();
  };

  return (
    <header className="hdr">
      <button className="hdr-menu" onClick={onMenu} aria-label="Open menu"><List size={20} /></button>
      <div className="crumb">
        <span>{grp}</span><CaretRight size={14} /><b>{page}</b>
      </div>

      <form className="hdr-search" onSubmit={search} role="search" ref={formRef} style={{ position: 'relative' }}>
        <MagnifyingGlass size={15} />
        <input ref={searchRef} value={q} onChange={e => setQ(e.target.value)} onFocus={() => setSearching(true)} placeholder={LIVE ? 'Search flats, people, vendors, work orders…' : 'Search issues, residents, units…'} aria-label="Search" />
        <kbd>Ctrl K</kbd>
        {shown && (
          <div className="udrop" role="listbox" style={{ left: 0, right: 0, width: 'auto', maxHeight: 360, overflowY: 'auto' }}>
            {hits.map((h, i) => (
              <button key={i} type="button" role="option" aria-selected={false} onClick={() => go(h.link)}>
                <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--ink3)', width: 74, flex: '0 0 auto', textAlign: 'left' }}>{h.kind}</span>
                <span style={{ textAlign: 'left', minWidth: 0 }}><b style={{ display: 'block', fontSize: 13 }}>{h.label}</b><span style={{ fontSize: 11.5, color: 'var(--ink3)' }}>{h.sub}</span></span>
              </button>
            ))}
            {!hits.length && <div style={{ padding: '10px 12px', fontSize: 12.5, color: 'var(--ink3)' }}>Nothing matches. Press Enter to search issues, or ask the Assistant.</div>}
          </div>
        )}
      </form>

      {!LIVE && <span className="demo-pill" title="Simulation — every record is fictional">Demo data</span>}

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
              {!LIVE && <button role="menuitem" onClick={() => { setMenu(false); actions.reset(); }}><ArrowCounterClockwise size={15} />Reset demo data</button>}
              <button role="menuitem" className="danger" onClick={() => { setMenu(false); onSignOut(); }}><SignOut size={15} />Sign out</button>
            </div>
          )}
        </div>
      )}
    </header>
  );
}
