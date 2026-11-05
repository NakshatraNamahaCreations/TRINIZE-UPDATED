import { CheckCircle, WarningCircle } from '@phosphor-icons/react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ToastCtx, type ToastFn, type ToastTone } from './toast-context';

type Msg = { msg: string; sub?: string; tone: ToastTone; key: number };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [m, setM] = useState<Msg | null>(null);
  const toast = useCallback<ToastFn>((msg, sub, tone = 'ok') => setM({ msg, sub, tone, key: Date.now() }), []);

  useEffect(() => {
    if (!m) return;
    const h = setTimeout(() => setM(null), 3600);
    return () => clearTimeout(h);
  }, [m]);

  return (
    <ToastCtx.Provider value={toast}>
      {children}
      <div className={'toast' + (m ? ' show' : '')} role="status" aria-live="polite">
        {m && (
          <>
            {m.tone === 'warn' ? <WarningCircle size={18} className="toast-ic warn" /> : <CheckCircle size={18} className="toast-ic" />}
            <div>
              {m.msg}
              {m.sub && <span className="sub-t">{m.sub}</span>}
            </div>
          </>
        )}
      </div>
    </ToastCtx.Provider>
  );
}
