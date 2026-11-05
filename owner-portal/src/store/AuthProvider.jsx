import { useCallback, useMemo, useState } from 'react';
import { DEMO_LOGIN } from '../data/portal';
import { AuthCtx } from './context';

/* Demo-only session: no server, credentials are the fictional operator's. "Remember me" keeps the
   session in localStorage; otherwise it lives in sessionStorage and ends with the tab. */
const KEY = 'trinize.owner.session';

function readSession() {
  try {
    const raw = localStorage.getItem(KEY) ?? sessionStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const wait = ms => new Promise(r => setTimeout(r, ms));

export function AuthProvider({ children }) {
  const [session, setSession] = useState(readSession);

  /** resolves to an error message, or null on success */
  const signIn = useCallback(async (email, password, remember) => {
    await wait(700); // feels like a round-trip
    if (email.trim().toLowerCase() !== DEMO_LOGIN.email || password !== DEMO_LOGIN.password) {
      return 'That email and password don’t match an operator account.';
    }
    const s = { email: DEMO_LOGIN.email, at: Date.now() };
    try {
      (remember ? localStorage : sessionStorage).setItem(KEY, JSON.stringify(s));
    } catch {
      // storage blocked (private mode) — still signed in for this page
    }
    setSession(s);
    return null;
  }, []);

  const signOut = useCallback(() => {
    try {
      localStorage.removeItem(KEY);
      sessionStorage.removeItem(KEY);
    } catch {
      // nothing to clear
    }
    setSession(null);
  }, []);

  const value = useMemo(() => ({ session, signIn, signOut }), [session, signIn, signOut]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
