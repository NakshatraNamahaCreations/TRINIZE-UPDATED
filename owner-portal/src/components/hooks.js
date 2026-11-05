import { useEffect, useState } from 'react';
import { usePortal } from '../store/context';

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Counts from 0 to `target` on mount (skipped for reduced motion). */
export function useCountUp(target, enabled) {
  const [v, setV] = useState(enabled && !reducedMotion() ? 0 : target);
  useEffect(() => {
    if (!enabled || reducedMotion()) return;
    const t0 = performance.now(), dur = 620;
    const frame = { id: 0 };
    const step = t => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      setV(Math.round(target * e));
      if (k < 1) frame.id = requestAnimationFrame(step);
    };
    frame.id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.id);
  }, [target, enabled]);
  return v;
}

/** Closes a dropdown when the pointer goes down outside `ref`. */
export function useDismiss(ref, open, onClose) {
  useEffect(() => {
    if (!open) return;
    const onDown = e => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [ref, open, onClose]);
}

/** Spread onto any SVG element that should show the shared chart tooltip. */
export function useTipProps() {
  const { showTip, hideTip } = usePortal();
  return content => ({ onMouseMove: e => showTip(content, e), onMouseLeave: hideTip });
}
