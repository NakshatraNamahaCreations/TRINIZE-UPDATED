import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { usePortal } from '../store/context';
import { Icon3D } from './Icon3D';

export function Toast() {
  const { toastMsg } = usePortal();
  // each toast has a unique key; it is visible until its own timer marks that key as expired
  const [expired, setExpired] = useState(null);
  useEffect(() => {
    if (!toastMsg) return;
    const h = setTimeout(() => setExpired(toastMsg.key), 3600);
    return () => clearTimeout(h);
  }, [toastMsg]);
  const show = !!toastMsg && toastMsg.key !== expired;
  return (
    <div className={'toast' + (show ? ' show' : '')} role="status" aria-live="polite">
      {toastMsg && (
        <>
          <Icon3D name={toastMsg.icon ?? 'information'} size={22} className="toast-ic" />
          <div>{toastMsg.msg}{toastMsg.sub && <span className="sub-t">{toastMsg.sub}</span>}</div>
        </>
      )}
    </div>
  );
}

export function Modal() {
  const { modal, closeModal } = usePortal();
  return (
    <>
      <div className={'veil modal-veil' + (modal ? ' show' : '')} onClick={closeModal} />
      <div className={'modal' + (modal ? ' open' : '')} role="dialog" aria-modal="true">
        {modal && (
          <div className="mbox">
            <button className="mclose" onClick={closeModal} aria-label="Close"><X size={18} /></button>
            {modal}
          </div>
        )}
      </div>
    </>
  );
}

/** Follows the pointer over chart points and bars (see showTip in PortalContext). */
export function ChartTip() {
  const { tip } = usePortal();
  return (
    <div className="chart-tip" style={tip ? { opacity: 1, left: tip.x, top: tip.y } : undefined}>
      {tip?.content}
    </div>
  );
}
