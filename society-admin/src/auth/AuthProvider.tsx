import { promptBox } from '../lib/dialog';
import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { api, ApiError, bindTokens, LIVE, setTokens, type Tokens } from '../lib/api';
import { setAssociation } from '../lib/live';
import { ADMIN } from '../store/data';
import { AuthCtx, DEMO_ACCOUNT, useAuth, type Session, type SignInResult } from './auth-context';

const KEY = 'trinize-society-admin:session';
/** what's kept in the browser: the session shown in the header, plus the API tokens when connected */
type Stored = Session & { tokens?: Tokens; aid?: string };

function read(): Stored | null {
  try {
    const raw = localStorage.getItem(KEY) ?? sessionStorage.getItem(KEY);
    const s = raw ? (JSON.parse(raw) as Stored) : null;
    // a session saved by the demo build has no tokens — it can't be used against the API
    return s && (!LIVE || s.tokens) ? s : null;
  } catch {
    return null;
  }
}
function write(s: Stored | null, remember?: boolean) {
  try {
    const inLocal = localStorage.getItem(KEY) !== null;
    localStorage.removeItem(KEY); sessionStorage.removeItem(KEY);
    // "remember me" survives a browser restart; otherwise the session ends with the tab
    if (s) (remember ?? inLocal ? localStorage : sessionStorage).setItem(KEY, JSON.stringify(s));
  } catch { /* storage blocked — session lives in memory only */ }
}

type StaffLogin = { accessToken: string; refreshToken: string; user: { name: string; email: string }; roles: { role: string; associationId: string | null; title: string | null }[] };
const initials = (name: string) => name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Stored | null>(() => {
    const s = read();
    if (s?.aid) setAssociation(s.aid);
    return s;
  });
  // the API client refreshes tokens on its own; keep storage in step, and sign out when the server ends the session
  useState(() => bindTokens(user?.tokens ?? null, t => {
    setUser(cur => {
      const next = cur && t ? { ...cur, tokens: t } : null;
      write(next);
      return next;
    });
  }));

  const signIn = useCallback(async (email: string, password: string, remember: boolean): Promise<SignInResult> => {
    if (!LIVE) {
      await new Promise(r => setTimeout(r, 650)); // feels like a network round-trip
      if (email.trim().toLowerCase() !== DEMO_ACCOUNT.email || password !== DEMO_ACCOUNT.password) {
        return { ok: false, error: 'That email and password don’t match an admin account for this society.' };
      }
      const s: Stored = { name: ADMIN.name, email: DEMO_ACCOUNT.email, role: ADMIN.role, initials: 'SR' };
      write(s, remember);
      setUser(s);
      return { ok: true };
    }
    try {
      let res = await api<StaffLogin | { mfaRequired: true; mfaToken: string }>('POST', '/v1/auth/staff/login', { email: email.trim(), password }, { auth: false });
      if ('mfaRequired' in res) {
        // two-step sign-in is on for this account: ask for the authenticator code
        const code = (await promptBox('Two-step sign-in', '', { body: 'Enter the 6-digit code from your authenticator app.', placeholder: '123456', type: 'number', confirm: 'Verify', required: true }))?.trim() ?? '';
        if (!/^\d{6}$/.test(code)) return { ok: false, error: 'A 6-digit authenticator code is needed to finish signing in.' };
        res = await api<StaffLogin>('POST', '/v1/auth/staff/mfa', { mfaToken: res.mfaToken, code }, { auth: false });
      }
      const role = res.roles.find(r => r.associationId);
      if (!role?.associationId) return { ok: false, error: 'This account doesn’t manage a society. Operators sign in to the Operator console.' };
      const s: Stored = {
        name: res.user.name, email: res.user.email, role: role.title ?? role.role, initials: initials(res.user.name),
        tokens: { access: res.accessToken, refresh: res.refreshToken }, aid: role.associationId,
      };
      setAssociation(role.associationId);
      write(s, remember);
      setUser(s);
      setTokens(s.tokens!);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof ApiError ? e.message : 'Sign-in failed. Please try again.' };
    }
  }, []);

  const signOut = useCallback(() => {
    if (LIVE && user?.tokens) api('POST', '/v1/auth/logout', { refreshToken: user.tokens.refresh }, { auth: false }).catch(() => {});
    write(null);
    setTokens(null);
    setUser(null);
  }, [user]);

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
