import { createContext, useContext } from 'react';

export type Session = { name: string; email: string; role: string; initials: string };

export type SignInResult = { ok: true } | { ok: false; error: string };

export type Auth = {
  user: Session | null;
  signIn: (email: string, password: string, remember: boolean) => Promise<SignInResult>;
  signOut: () => void;
};

/** Demo-only account — there is no backend; the real build uses Trinize OTP login. */
export const DEMO_ACCOUNT = { email: 'sanjana.rao@prestigelakeside.in', password: 'Lakeside@2026' };

export const AuthCtx = createContext<Auth | null>(null);

export function useAuth() {
  const a = useContext(AuthCtx);
  if (!a) throw new Error('useAuth must be used inside <AuthProvider>');
  return a;
}
