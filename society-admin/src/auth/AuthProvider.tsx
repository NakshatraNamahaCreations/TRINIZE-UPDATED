import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { ADMIN } from '../store/data';
import { AuthCtx, DEMO_ACCOUNT, useAuth, type Session, type SignInResult } from './auth-context';

const KEY = 'trinize-society-admin:session';

function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY) ?? sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Session | null>(readSession);

  const signIn = useCallback(async (email: string, password: string, remember: boolean): Promise<SignInResult> => {
    await new Promise(r => setTimeout(r, 650)); // feels like a network round-trip
    if (email.trim().toLowerCase() !== DEMO_ACCOUNT.email || password !== DEMO_ACCOUNT.password) {
      return { ok: false, error: 'That email and password don’t match an admin account for this society.' };
    }
    const s: Session = { name: ADMIN.name, email: DEMO_ACCOUNT.email, role: ADMIN.role, initials: 'SR' };
    try {
      // "remember me" survives a browser restart; otherwise the session ends with the tab
      (remember ? localStorage : sessionStorage).setItem(KEY, JSON.stringify(s));
    } catch { /* storage blocked — session lives in memory only */ }
    setUser(s);
    return { ok: true };
  }, []);

  const signOut = useCallback(() => {
    try { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY); } catch { /* ignore */ }
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, signIn, signOut }), [user, signIn, signOut]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

/** Route guard: signed-out visitors go to /login and come back where they were heading. */
export function RequireAuth() {
  const { user } = useAuth();
  const loc = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname + loc.search }} />;
  return <Outlet />;
}
