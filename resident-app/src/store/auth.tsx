import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError, bindTokens, LIVE, setTokens, type Tokens } from '@/lib/api';
import { saveAuth, type SavedAuth } from '@/lib/persist';

/** Demo mode only (no EXPO_PUBLIC_API_URL): the one code that works. With the API, codes come by SMS. */
export const DEMO_OTP = '123456';
export const OTP_LENGTH = 6;
export const RESEND_SECONDS = 30;

/** ok, or the reason to show the resident */
/** `roleCheck`: signed in, but which app the number gets couldn't be worked out (the server failed or was out of reach) */
export type Outcome = { ok: true } | { ok: false; message?: string; roleCheck?: boolean };

export type Role = 'resident' | 'vpm' | 'guard';

type Auth = {
  signedIn: boolean;
  /** which app this number gets: the resident tabs, the property manager's societies, or the guard's gate */
  role: Role;
  /** 10-digit number awaiting verification, or the signed-in number */
  phone: string;
  requestOtp: (phone: string) => Promise<Outcome>;
  verifyOtp: (code: string) => Promise<Outcome>;
  /** Swaps the auth stack for the app — screens call it after their success animation. */
  completeSignIn: () => void;
  signOut: () => void;
};

const AuthCtx = createContext<Auth | null>(null);
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const failed = (e: unknown): Outcome => ({ ok: false, message: e instanceof ApiError ? e.message : undefined });

export function AuthProvider({ initial, children }: { initial?: SavedAuth; children: ReactNode }) {
  const [signedIn, setSignedIn] = useState(initial?.signedIn ?? false);
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [tokens, setTok] = useState<Tokens | null>(initial?.tokens ?? null);
  const [role, setRole] = useState<Role>(initial?.role ?? 'resident');
  // stay signed in across restarts; the phone is kept so OTP and Profile can show it
  useEffect(() => { saveAuth({ signedIn, phone, tokens, role }); }, [signedIn, phone, tokens, role]);

  // the API client refreshes tokens on its own; when the server ends the session, so do we
  useState(() => bindTokens(initial?.tokens ?? null, t => {
    setTok(t);
    if (!t) { setSignedIn(false); setPhone(''); }
  }));

  const requestOtp = useCallback(async (p: string): Promise<Outcome> => {
    if (!LIVE) { await wait(700); setPhone(p); return { ok: true }; }
    try {
      await api('POST', '/v1/auth/otp/request', { phone: p }, { auth: false });
      setPhone(p);
      return { ok: true };
    } catch (e) {
      return failed(e);
    }
  }, []);

  const verifyOtp = useCallback(async (code: string): Promise<Outcome> => {
    if (!LIVE) { await wait(600); return code === DEMO_OTP ? { ok: true } : { ok: false }; }
    try {
      const s = await api<{ accessToken: string; refreshToken: string }>('POST', '/v1/auth/otp/verify', { phone, code }, { auth: false });
      setTokens({ access: s.accessToken, refresh: s.refreshToken });
      // a Virtual Property Manager's number (created by the operator) gets the manager's app
      // …and a security guard's number (added by the society office) gets the gate.
      // Only "you're not that" (403) moves on to the next app: any other failure (the server erred or was out of
      // reach) stops sign-in with a message, rather than quietly opening the wrong app.
      const notThis = (e: unknown) => e instanceof ApiError && e.status === 403 && e.code !== 'account_blocked';
      let next: Role = 'resident';
      try {
        try { await api('GET', '/v1/me'); } catch (e) {
          if (!notThis(e)) throw e;
          try { await api('GET', '/v1/vpm/me'); next = 'vpm'; } catch (e2) {
            if (!notThis(e2)) throw e2;
            // none of them: the resident screens explain how to get a flat verified
            try { await api('GET', '/v1/gate/me'); next = 'guard'; } catch (e3) { if (!notThis(e3)) throw e3; }
          }
        }
      } catch (e) {
        setTokens(null);
        // clearing the session also forgets the number; keep it, so the code screen stays up and shows why
        setPhone(phone);
        // a blocked account keeps the office's own explanation
        return e instanceof ApiError && e.code === 'account_blocked' ? failed(e) : { ok: false, roleCheck: true };
      }
      setRole(next);
      return { ok: true };
    } catch (e) {
      return failed(e);
    }
  }, [phone]);

  const value = useMemo<Auth>(() => ({
    signedIn, phone, role, requestOtp, verifyOtp,
    completeSignIn: () => setSignedIn(true),
    signOut: () => {
      // tell the server to end this device's session; signing out locally doesn't wait for it
      if (LIVE && tokens) api('POST', '/v1/auth/logout', { refreshToken: tokens.refresh }, { auth: false }).catch(() => {});
      setTokens(null);
      setSignedIn(false);
      setPhone('');
      setRole('resident');
    },
  }), [signedIn, phone, role, tokens, requestOtp, verifyOtp]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const a = useContext(AuthCtx);
  if (!a) throw new Error('useAuth must be used inside <AuthProvider>');
  return a;
}

/** 9876543210 → "98765 43210" */
export const formatPhone = (p: string) => (p.length > 5 ? p.slice(0, 5) + ' ' + p.slice(5) : p);
