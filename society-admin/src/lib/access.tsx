import { LockKey } from '@phosphor-icons/react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { useAuth } from '../auth/auth-context';
import { api, LIVE } from './api';
import { association, setMySections } from './live';
import { SOCIETY } from '../store/data';
import { PlanGate } from './plan';

/* What the signed-in person may use. The society's admin has the whole console; anyone else on the team
   is given a list of sections on the Team & access page. The server enforces it on every request — this
   file only keeps the menu and the pages in step, so nobody is shown a section that would answer "no". */

export type SectionInfo = { key: string; name: string; group: string };
export type Society = { name: string; short: string; city: string };
export type Access = { role: string; title: string | null; full: boolean; permissions: string[]; sections: SectionInfo[]; society?: Society };

/** the section each page belongs to; a page not listed here (the dashboard, help) is open to everyone on the team */
const PAGE: Record<string, string> = {
  '/assistant': 'assistant', '/issues': 'issues', '/maintenance': 'maintenance', '/inspections': 'inspections', '/visits': 'issues',
  '/gate': 'gate', '/accounts': 'accounts', '/owners': 'owners', '/moderation': 'moderation', '/community': 'moderation',
  '/communication': 'communication', '/announcements': 'announcements', '/events-polls': 'events', '/gallery': 'gallery',
  '/residents': 'users', '/flats': 'users', '/users': 'users', '/directory': 'directory', '/ai': 'ai', '/ai-usage': 'ai', '/audit': 'audit',
};
const sectionOf = (path: string) => Object.entries(PAGE).find(([to]) => path.startsWith(to))?.[1];

/** may this person open the page at `to`? */
export function allowed(a: Access | null, to: string) {
  if (!a) return true; // not connected, or not answered yet
  if (to.startsWith('/team')) return a.full;
  const s = sectionOf(to);
  return !s || a.permissions.includes(s);
}

const SOCIETY_KEY = 'trinize.admin.society.';
/** two letters for the society's badge: "Prestige Lakeside Habitat" → "PL" */
export const societyInitials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('');
/** The society this console is running. Connected, it is whatever the server says the signed-in person manages; the demo has its own. */
export function useSociety(): Society {
  const { access } = useAccess();
  if (!LIVE) return { name: SOCIETY.name, short: 'Prestige Lakeside', city: 'Bengaluru' };
  if (access?.society?.name) return access.society;
  // until the server answers — on a reload, say — the name it gave last time, so the sidebar never falls back to a blank
  try { const kept = localStorage.getItem(SOCIETY_KEY + association()); if (kept) return JSON.parse(kept) as Society; } catch { /* nothing kept */ }
  return { name: '', short: '', city: '' };
}

const Ctx = createContext<{ access: Access | null; settled: boolean; reload: () => void }>({ access: null, settled: true, reload: () => {} });
export const useAccess = () => useContext(Ctx);

export function AccessProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const signedIn = !!user;
  // kept with the sign-in it was read for, so one person's access is never applied to the next on the same browser
  const who = user?.email ?? null;
  const [got, setGot] = useState<{ who: string | null; access: Access } | null>(null);
  const access = got && got.who === who ? got.access : null;
  const settled = !LIVE || !signedIn || access !== null || got?.who === who + ':failed';
  const reload = useCallback(() => {
    if (!LIVE || !association()) return;
    api<Access>('GET', `/v1/admin/${association()}/staff/me`).then(a => {
      setMySections(a.full ? null : a.permissions);
      // modules this console no longer has are not offered as sections to give someone
      const society = a.society?.name ? a.society : undefined;
      if (society) { try { localStorage.setItem(SOCIETY_KEY + association(), JSON.stringify(society)); } catch { /* private mode: it is simply asked for again */ } }
      setGot({ who, access: { ...a, sections: (a.sections ?? []).filter(s => !['leasing', 'insights', 'workflows'].includes(s.key)) } });
    })
      // the console still opens if this cannot be read; the server enforces access either way
      .catch(() => setGot(g => (g?.who === who ? g : { who: who + ':failed', access: g?.access as Access })));
  }, [who]);
  useEffect(() => {
    if (!LIVE || !signedIn) { setMySections(undefined); return; }
    const tick = () => { if (document.visibilityState === 'visible') reload(); };
    tick();
    // an admin can change someone's access while they are signed in; pick it up without a reload
    const h = setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(h); document.removeEventListener('visibilitychange', tick); };
  }, [signedIn, reload]);
  const value = useMemo(() => ({ access: signedIn ? access : null, settled, reload }), [access, signedIn, settled, reload]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Stands in for a page the signed-in person was not given; otherwise hands over to the plan check. */
export function AccessGate() {
  const { access, settled } = useAccess();
  const { pathname } = useLocation();
  if (!settled) return null;
  if (allowed(access, pathname)) return <PlanGate />;
  const name = access?.sections.find(s => s.key === sectionOf(pathname))?.name ?? 'Team & access';
  return (
    <div className="plan-wall warn">
      <div className="pw-ic"><LockKey size={26} weight="fill" /></div>
      <h1>{name} isn’t part of your access</h1>
      <p>Your society admin decides which sections of the console each person on the team can use. Ask them to add <b>{name}</b> to your access if you need it.</p>
      <div className="pw-act"><Link className="a-btn" to="/dashboard">Back to the dashboard</Link></div>
    </div>
  );
}
