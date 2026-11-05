import { ChatCircleText, Heart, Robot, ShieldCheck, Sparkle } from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import { Avatar, Empty, IconTile, PageHead, Pill } from '../components/ui';
import { sevTone } from '../lib/format';
import { GUIDANCE, type ModAction, type ModItem } from '../store/data';
import { useStore } from '../store/context';

const ACTIONS: [ModAction, string][] = [['Allowed', 'Allow'], ['Warned author', 'Warn'], ['Rewrite suggested', 'Suggest rewrite'], ['Hidden', 'Hide']];
const REASONS = ['Hostile language', 'Spam / marketplace', 'Privacy', 'Off-topic'];

function ModCard({ m }: { m: ModItem }) {
  const { actions } = useStore();
  const [reason, setReason] = useState('');
  const [guidance, setGuidance] = useState(GUIDANCE[m.rec] ?? GUIDANCE.default);
  const reasonRef = useRef<HTMLInputElement>(null);

  const act = (a: ModAction) => {
    const ok = actions.moderate(m.id, a, reason.trim(), guidance.trim() || GUIDANCE[a]);
    if (!ok) reasonRef.current?.focus();
  };

  return (
    <div className="modcard">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <IconTile icon={m.kind.includes('chat') ? Robot : m.kind.includes('Gratitude') ? Heart : ChatCircleText} tone={sevTone(m.sev)} size={30} />
        <Pill tone={sevTone(m.sev)}>{m.cat} · {m.sev}</Pill>
        <span style={{ fontSize: 11.5, color: 'var(--ink3)' }}>{m.kind} · {m.when} · {m.ctx}</span>
      </div>
      <div className="who-cell" style={{ fontSize: 12.5, color: 'var(--ink2)', marginTop: 10 }}>
        <Avatar name={m.by} size={26} /><span><b style={{ color: 'var(--ink)' }}>{m.by}</b> · {m.unit}</span>
      </div>
      <div className={'quote' + (m.sev !== 'High' ? ' warn' : '')}>“{m.text}”</div>
      <div style={{ fontSize: 12, color: 'var(--ink2)' }}><b style={{ color: 'var(--acc-ink)' }}>AI analysis:</b> {m.ai}</div>

      <div style={{ marginTop: 12 }}>
        <div className="lbl">Internal reason · audit log only — never shown to the resident</div>
        <input ref={reasonRef} className="a-in" value={reason} onChange={e => setReason(e.target.value)} placeholder="Why you are taking this action…" />
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
          {REASONS.map(r => <button key={r} className="a-btn ghost xs" onClick={() => setReason(r)}>{r}</button>)}
        </div>
      </div>
      <div style={{ marginTop: 10 }}>
        <div className="lbl">Message to the resident</div>
        <textarea className="a-in" style={{ minHeight: 52 }} value={guidance} onChange={e => setGuidance(e.target.value)} />
      </div>
      <div className="modrow">
        {ACTIONS.map(([a, label]) => (
          <button key={a} className={'a-btn' + (m.rec === a ? '' : ' ghost')} onClick={() => act(a)}>
            {m.rec === a && <Sparkle size={13} />}{label}
          </button>
        ))}
      </div>
      <div className="flow-note" style={{ marginTop: 10 }}>The highlighted action is what the AI recommends — you decide. The internal reason goes to the audit log; only the message above reaches the resident.</div>
    </div>
  );
}

export function Moderation() {
  const { state } = useStore();
  const [tab, setTab] = useState<'open' | 'done'>('open');
  const open = state.modqueue.filter(m => m.state === 'open');

  return (
    <>
      <PageHead title="Discussions & moderation" sub="Items flagged by the server-side safety check or reported by residents. Every decision requires a reason and is written to the audit log. For private AI chats, only the flagged excerpt is visible — never the full conversation." />
      <div className="filters">
        <button className={tab === 'open' ? 'on' : ''} onClick={() => setTab('open')}>Needs review · {open.length}</button>
        <button className={tab === 'done' ? 'on' : ''} onClick={() => setTab('done')}>Resolved · {state.resolvedMods.length}</button>
      </div>
      {tab === 'open'
        ? (open.length ? open.map(m => <ModCard key={m.id} m={m} />) : <div className="panel"><Empty icon={ShieldCheck} title="Queue is clear" body="New flags from the resident app arrive here." /></div>)
        : state.resolvedMods.map(m => (
          <div key={m.id + m.when} className="modcard">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Pill tone="good">{m.action}</Pill>
              <span style={{ fontSize: 11.5, color: 'var(--ink3)' }}>{m.when} · by {m.admin}</span>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--ink2)', marginTop: 8 }}>{m.text}</div>
          </div>
        ))}
    </>
  );
}
