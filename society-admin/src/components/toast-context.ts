import { createContext, useContext } from 'react';

export type ToastTone = 'ok' | 'warn';
export type ToastFn = (msg: string, sub?: string, tone?: ToastTone) => void;

export const ToastCtx = createContext<ToastFn | null>(null);

export function useToast() {
  const t = useContext(ToastCtx);
  if (!t) throw new Error('useToast must be used inside <ToastProvider>');
  return t;
}
