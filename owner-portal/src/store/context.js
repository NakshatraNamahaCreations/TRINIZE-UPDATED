import { createContext, useContext } from 'react';

export const PortalCtx = createContext(null);
export const AuthCtx = createContext(null);

export function usePortal() {
  const v = useContext(PortalCtx);
  if (!v) throw new Error('usePortal must be used inside <PortalProvider>');
  return v;
}

export function useAuth() {
  const v = useContext(AuthCtx);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}
