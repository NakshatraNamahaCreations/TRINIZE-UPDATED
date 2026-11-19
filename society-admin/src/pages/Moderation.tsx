import { ChatCircleText, EyeSlash, Heart, Robot, ShieldCheck, ShieldWarning, Sparkle, UserMinus, Warning } from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import { TableCard } from '../components/TableCard';
import { Avatar, Empty, IconTile, PageHead, Pill, Stat } from '../components/ui';
import { sevTone, userTone } from '../lib/format';
import { GUIDANCE, type ModAction, type ModItem } from '../store/data';
import { useStore } from '../store/context';

const ACTIONS: [ModAction, string][] = [['Allowed', 'Allow'], ['Warned author', 'Warn'], ['Rewrite suggested', 'Suggest rewrite'], ['Hidden', 'Hide']];
const REASONS = ['Hostile language', 'Spam / marketplace', 'Privacy', 'Off-topic'];

function ModCard({ m }: { m: ModItem }) {
  const { state, actions } = useStore();
  // what the moderator should know about the author before deciding
  const author = state.users.find(u => u.n === m.by);
  const earlier = state.resolvedMods.filter(r => r.by === m.by).length;
  const alsoOpen = state.modqueue.filter(x => x.state === 'open' && x.by === m.by && x.id !== m.id).length;
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
        {author && <Pill tone={userTone(author.status)} dot>{author.status}</Pill>}
      </div>
      <div className="num" style={{ fontSize: 11.5, color: 'var(--ink3)', marginTop: 6 }}>
        <span className="cell-id">{m.id}</span> · {author ? `${author.warns} earlier warning${author.warns === 1 ? '' : 's'}` : 'Not a current resident'} · {earlier} earlier decision{earlier === 1 ? '' : 's'}{alsoOpen > 0 && ` · ${alsoOpen} more waiting in this queue`}
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
  const [sev, setSev] = useState<'All' | ModItem['sev']>('All');
  const open = state.modqueue.filter(m => m.state === 'open');
  const queue = open.filter(m => sev === 'All' || m.sev === sev);
  const done = state.resolvedMods;
  const flagged = state.users.filter(u => u.status !== 'Active').length;

  return (
    <>
      <PageHead title="Discussions & moderation" sub="Items flagged by the server-side safety check or reported by residents. Every decision requires a reason and is written to the audit log. For private AI chats, only the flagged excerpt is visible — never the full conversation." />
      <div className="stats">
        <Stat icon={ShieldWarning} label="Needs review" value={open.length} tone={open.length ? 'warn' : undefined} />
        <Stat icon={Warning} label="High severity" value={open.filter(m => m.sev === 'High').length} tone={open.some(m => m.sev === 'High') ? 'bad' : undefined} />
        <Stat icon={ShieldCheck} label="Decided" value={done.length} tone="good" />
        <Stat icon={EyeSlash} label="Hidden or removed" value={done.filter(m => /hid|remov/i.test(m.action)).length} />
        <Stat icon={UserMinus} label="Residents warned or restricted" value={flagged} tone={flagged ? 'warn' : undefined} />
      </div>
      <div className="toolbar">
        <div className="filters">
          <button className={tab === 'open' ? 'on' : ''} onClick={() => setTab('open')}>Needs review · {open.length}</button>
          <button className={tab === 'done' ? 'on' : ''} onClick={() => setTab('done')}>Resolved · {done.length}</button>
        </div>
        {tab === 'open' && open.length > 0 && (
          <select className="a-in" style={{ marginLeft: 'auto' }} value={sev} onChange={e => setSev(e.target.value as typeof sev)} aria-label="Severity">
            {['All', 'High', 'Medium', 'Low'].map(s => <option key={s} value={s}>{s === 'All' ? 'Any severity' : s + ' severity'}</option>)}
          </select>
        )}
      </div>
      {tab === 'open' && (queue.length
        ? queue.map(m => <ModCard key={m.id} m={m} />)
        : <div className="panel"><Empty icon={ShieldCheck} title={open.length ? 'Nothing at this severity' : 'Queue is clear'} body={open.length ? 'Choose another severity to see the rest of the queue.' : 'New flags from the resident app arrive here.'} /></div>)}
      {tab === 'done' && (
        <TableCard rows={done} noun="decision" search={m => [m.id, m.by, m.text, m.action, m.admin]} placeholder="Search decisions by author, text or action"
          filters={[{ key: 'action', label: 'Decision', get: m => m.action }, { key: 'by', label: 'Author', get: m => m.by }]}
          csv={{ name: 'moderation-decisions', head: ['Ref', 'Author', 'Excerpt', 'Decision', 'Decided by', 'When'], row: m => [m.id, m.by, m.text, m.action, m.admin, m.when] }}>{(page, sl) => (<div className="a-tbl-wrap">
          <table className="a-tbl">
            <tbody>
              <tr><th className="sl">Sl. no.</th><th>Item</th><th>Author</th><th>Decision</th><th>When</th></tr>
              {page.map((m, rowNo) => (
                <tr key={m.id + m.when}>
                  <td className="sl num">{sl(rowNo)}</td>
                  <td><span className="cell-id num">{m.id}</span><div className="cell-t" style={{ fontWeight: 500 }}>{m.text}</div></td>
                  <td data-l="Author"><span className="who-cell"><Avatar name={m.by} size={26} />{m.by}</span></td>
                  <td data-l="Decision"><Pill tone={m.action === 'Allowed' ? 'good' : /warn/i.test(m.action) ? 'warn' : /hid|remov/i.test(m.action) ? 'bad' : 'acc'}>{m.action}</Pill></td>
                  <td data-l="When">{m.when}{m.admin && <div className="cell-m">by {m.admin}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!done.length && <Empty icon={ShieldCheck} title="No decisions yet" body="Items you decide move here, with the action taken." />}
        </div>)}</TableCard>
      )}
    </>
  );
}
