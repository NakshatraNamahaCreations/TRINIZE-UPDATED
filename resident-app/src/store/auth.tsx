import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { saveAuth, type SavedAuth } from '@/lib/persist';

/** Mocked OTP — any real build swaps these two calls for the SMS provider's API. */
export const DEMO_OTP = '123456';
export const OTP_LENGTH = 6;
export const RESEND_SECONDS = 30;

type Auth = {
  signedIn: boolean;
  /** 10-digit number awaiting verification, or the signed-in number */
  phone: string;
  requestOtp: (phone: string) => Promise<void>;
  verifyOtp: (code: string) => Promise<boolean>;
  /** Swaps the auth stack for the app — screens call it after their success animation. */
  completeSignIn: () => void;
  signOut: () => void;
};

const AuthCtx = createContext<Auth | null>(null);
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

export function AuthProvider({ initial, children }: { initial?: SavedAuth; children: ReactNode }) {
  const [signedIn, setSignedIn] = useState(initial?.signedIn ?? false);
  const [phone, setPhone] = useState(initial?.phone ?? '');
  // stay signed in across restarts; the phone is kept so OTP and Profile can show it
  useEffect(() => { saveAuth({ signedIn, phone }); }, [signedIn, phone]);

  const requestOtp = useCallback(async (p: string) => {
    await wait(700);
    setPhone(p);
  }, []);

  const verifyOtp = useCallback(async (code: string) => {
    await wait(600);
    return code === DEMO_OTP;
  }, []);

  const value = useMemo<Auth>(() => ({
    signedIn, phone, requestOtp, verifyOtp,
    completeSignIn: () => setSignedIn(true),
    signOut: () => { setSignedIn(false); setPhone(''); },
  }), [signedIn, phone, requestOtp, verifyOtp]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const a = useContext(AuthCtx);
  if (!a) throw new Error('useAuth must be used inside <AuthProvider>');
  return a;
}

/** 9876543210 → "98765 43210" */
export const formatPhone = (p: string) => (p.length > 5 ? p.slice(0, 5) + ' ' + p.slice(5) : p);
