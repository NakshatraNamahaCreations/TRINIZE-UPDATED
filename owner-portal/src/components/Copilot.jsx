import { Paperclip, SendHorizontal, Sparkles, X } from 'lucide-react';
import { Icon3D } from './Icon3D';
import { useEffect, useRef, useState } from 'react';
import { usePortal } from '../store/context';

/** Right-hand drawer + floating button. Answers come from data/copilot.jsx. */
export function Copilot() {
  const { cop, openCop, closeCop, copAsk } = usePortal();
  const [text, setText] = useState('');
  const logRef = useRef(null);
  const inRef = useRef(null);

  useEffect(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight; }, [cop.log]);
  useEffect(() => {
    if (!cop.open) return;
    const h = setTimeout(() => inRef.current?.focus(), 260);
    return () => clearTimeout(h);
  }, [cop.open]);

  const send = () => {
    const v = text.trim();
    if (!v) return;
    setText('');
    copAsk(v);
  };

  return (
    <>
      <div className={'veil cop-veil' + (cop.open ? ' show' : '')} onClick={closeCop} />
      <div className={'cop' + (cop.open ? ' open' : '')} role="dialog" aria-label="Trinize Assistant">
        <div className="cop-h">
          <div className="ic"><Icon3D name="sparkles" size={24} /></div>
          <div style={{ flex: 1 }}><b>Trinize Assistant</b><span>Answers from your own records · suggests, never acts</span></div>
          <button onClick={closeCop} aria-label="Close" className="icon-btn"><X size={17} /></button>
        </div>
        <div className="cop-log" ref={logRef}>
          {cop.log.map((m, i) => {
            if (m.who === 'me') return <div key={i} className="msg me">{m.t}</div>;
            if (m.who === 'typing') return <div key={i} className="typing"><i /><i /><i /></div>;
            const last = i === cop.log.length - 1;
            return (
              <div key={i} style={{ display: 'contents' }}>
                <div className="msg ai">{m.t}{m.src && <span className="src"><Paperclip size={11} /> {m.src}</span>}</div>
                {m.chips && last && (
                  <div className="chips">{m.chips.map(c => <button key={c} onClick={() => copAsk(c)}>{c}</button>)}</div>
                )}
              </div>
            );
          })}
        </div>
        <div className="cop-in">
          <input ref={inRef} value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') send(); }} placeholder="Ask about your portfolio…" maxLength={300} />
          <button onClick={send} aria-label="Send"><SendHorizontal size={16} /></button>
        </div>
      </div>
      <button className="fab" onClick={openCop} aria-label="Open Trinize Assistant" title="Trinize Assistant"><Sparkles size={22} /></button>
    </>
  );
}
