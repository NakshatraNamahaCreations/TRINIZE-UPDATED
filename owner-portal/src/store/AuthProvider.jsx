import { useCallback, useMemo, useState } from 'react';
import { DEMO_LOGIN, setOperator } from '../data/portal';
import { api, ApiError, bindTokens, LIVE, setTokens } from '../lib/api';
import { AuthCtx } from './context';

/* Two modes. Without VITE_API_URL: a demo-only session, no server, the fictional operator's credentials.
   With it: a real staff sign-in against the API, operators only, with two-step sign-in when it is on.
   "Remember me" keeps the session in localStorage; otherwise it lives in sessionStorage and ends with the tab. */
const KEY = 'trinize.owner.session';

function readSession() {
  try {
    const raw = localStorage.getItem(KEY) ?? sessionStorage.getItem(KEY);
    const s = raw ? JSON.parse(raw) : null;
    // a session saved by the demo build has no tokens — it can't be used against the API
    return s && (!LIVE || s.tokens) ? s : null;
  } catch {
    return null;
  }
}
function writeSession(s, remember) {
  try {
    const inLocal = localStorage.getItem(KEY) !== null;
    localStorage.removeItem(KEY);
    sessionStorage.removeItem(KEY);
    if (s) (remember ?? inLocal ? localStorage : sessionStorage).setItem(KEY, JSON.stringify(s));
  } catch {
    // storage blocked (private mode) — still signed in for this page
  }
}

const wait = ms => new Promise(r => setTimeout(r, ms));
const NOT_OPERATOR = 'That login isn’t a Trinize operator account. Society admins sign in at the society console.';

export function AuthProvider({ children }) {
  const [session, setSession] = useState(() => {
    const s = readSession();
    if (LIVE && s?.name) setOperator(s.name, s.email);
    return s;
  });
  // the API client refreshes tokens on its own; keep storage in step, and sign out when the server ends the session
  useState(() => bindTokens(session?.tokens ?? null, t => {
    setSession(cur => {
      const next = cur && t ? { ...cur, tokens: t } : null;
      writeSession(next);
      return next;
    });
  }));

  const finish = useCallback((j, remember) => {
    if (!j.roles.some(r => r.role === 'operator')) return NOT_OPERATOR;
    const tokens = { access: j.accessToken, refresh: j.refreshToken };
    const s = { email: j.user.email, name: j.user.name, at: Date.now(), tokens };
    setOperator(s.name, s.email);
    writeSession(s, remember);
    bindTokens(tokens, t => {
      setSession(cur => {
        const next = cur && t ? { ...cur, tokens: t } : null;
        writeSession(next);
        return next;
      });
    });
    setSession(s);
    return null;
  }, []);

  /** resolves to null on success, an error message, or { mfaToken } when a second step is needed */
  const signIn = useCallback(async (email, password, remember) => {
    if (!LIVE) {
      await wait(700); // feels like a round-trip
      if (email.trim().toLowerCase() !== DEMO_LOGIN.email || password !== DEMO_LOGIN.password) {
        return 'That email and password don’t match an operator account.';
      }
      const s = { email: DEMO_LOGIN.email, at: Date.now() };
      writeSession(s, remember);
      setSession(s);
      return null;
    }
    try {
      const j = await api('POST', '/v1/auth/staff/login', { email: email.trim(), password }, { auth: false });
      if (j.mfaRequired) return { mfaToken: j.mfaToken };
      return finish(j, remember);
    } catch (e) {
      return e instanceof ApiError ? e.message : 'Something went wrong. Try again.';
    }
  }, [finish]);

  /** second step: the 6-digit code from the authenticator app */
  const verifyMfa = useCallback(async (mfaToken, code, remember) => {
    try {
      return finish(await api('POST', '/v1/auth/staff/mfa', { mfaToken, code }, { auth: false }), remember);
    } catch (e) {
      return e instanceof ApiError ? e.message : 'Something went wrong. Try again.';
    }
  }, [finish]);

  const signOut = useCallback(() => {
    const refreshToken = session?.tokens?.refresh;
    if (LIVE && refreshToken) api('POST', '/v1/auth/logout', { refreshToken }, { auth: false }).catch(() => {});
    writeSession(null);
    if (LIVE) setTokens(null);
    setSession(null);
  }, [session]);

  const value = useMemo(() => ({ session, signIn, verifyMfa, signOut }), [session, signIn, verifyMfa, signOut]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
