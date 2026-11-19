import { useEffect, useState } from 'react';

type Tip = { text: string; x: number; y: number; below: boolean };

/**
 * The name that appears when the pointer rests on an icon button — or when it is reached with the keyboard.
 * One host for the whole console: anything carrying `data-tip` gets one. It is drawn fixed to the window,
 * above the element, so a table that scrolls sideways (and clips what overflows it) cannot cut it off.
 */
export function TipHost() {
  const [tip, setTip] = useState<Tip | null>(null);
  useEffect(() => {
    let timer = 0;
    const show = (e: Event, wait: number) => {
      const el = (e.target as Element | null)?.closest?.('[data-tip]');
      window.clearTimeout(timer);
      if (!(el instanceof HTMLElement)) { setTip(null); return; }
      timer = window.setTimeout(() => {
        const r = el.getBoundingClientRect();
        if (!r.width) return;
        const below = r.top < 44; // no room above: go underneath
        // kept inside the window, so a button at the edge of the page still gets a whole label
        const x = Math.min(window.innerWidth - 12, Math.max(12, r.left + r.width / 2));
        setTip({ text: el.dataset.tip ?? '', x, y: below ? r.bottom + 8 : r.top - 8, below });
      }, wait);
    };
    const over = (e: Event) => show(e, 260);
    const focus = (e: Event) => { if ((e.target as Element | null)?.matches?.(':focus-visible')) show(e, 0); };
    const hide = () => { window.clearTimeout(timer); setTip(null); };
    document.addEventListener('mouseover', over);
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', hide);
    document.addEventListener('mousedown', hide);
    document.addEventListener('keydown', hide);
    window.addEventListener('scroll', hide, true);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mouseover', over);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', hide);
      document.removeEventListener('mousedown', hide);
      document.removeEventListener('keydown', hide);
      window.removeEventListener('scroll', hide, true);
    };
  }, []);
  if (!tip?.text) return null;
  // decoration only: the button itself already carries the name for screen readers
  return <div className={'tip' + (tip.below ? ' below' : '')} style={{ left: tip.x, top: tip.y }} aria-hidden="true">{tip.text}</div>;
}
