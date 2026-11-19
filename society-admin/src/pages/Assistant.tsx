import { ArrowRight, ClipboardText, PaperPlaneRight, Robot, Sparkle } from '@phosphor-icons/react';
import { TableCard } from '../components/TableCard';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useToast } from '../components/toast-context';
import { Empty, PageHead, Pill } from '../components/ui';
import { api, ApiError, LIVE } from '../lib/api';
import { association } from '../lib/live';

/* The assistant for staff: ask about the society in plain words and get the answer with the table
   behind it; ask it to do something and it shows what it would do and waits for a yes.
   The second tab is the record of everything it was asked and did. Connected mode only. */

const A = () => `/v1/admin/${association()}`;
type About = { role: string; sees: string[]; canAct: boolean; aiConnected: boolean; draftKinds: string[]; examples: string[] };
type Card = { key: string; title: string; headline: string; columns: string[]; rows: string[][]; link: string | null };
type Action = { id: string; kind: string };
type Draft = { kind: string; title: string; body: string; by: string };
type Reply = { id: string; text: string; cards: Card[]; action?: Action; draft?: Draft; link?: string; linkLabel?: string; chips?: string[]; refused?: boolean; by: 'ai' | 'rules' };
type Turn = { q: string; a: Reply | null; outcome?: { status: string; text: string; link?: string | null } };
type Entry = { id: string; at: string; user: string; role: string; surface: string; prompt: string; response: string; dataAccessed: string[]; action: string | null; approvalRequired: boolean; status: string; outcome: string; by: string };
const STATUS_TONE: Record<string, 'good' | 'warn' | 'bad' | 'acc' | 'dim'> = { answered: 'dim', refused: 'bad', proposed: 'warn', done: 'good', cancelled: 'dim', failed: 'bad' };
const ACTION_NAME: Record<string, string> = { send_reminders: 'Send payment reminders', create_work_order: 'Create a work order', create_task: 'Add a task', ask_office: 'Question passed to the office' };
const small = { fontSize: 12, color: 'var(--ink3)' } as const;
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export function Assistant() {
  const toast = useToast();
  const [tab, setTab] = useState<'ask' | 'log'>('ask');
  const [about, setAbout] = useState<About | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<Entry[]>([]);
  const [only, setOnly] = useState<'all' | 'actions'>('all');
  const [draft, setDraft] = useState({ kind: 'Payment reminder', details: '' });
  const [drafted, setDrafted] = useState<Draft | null>(null);
  const end = useRef<HTMLDivElement>(null);

  const fail = useCallback((e: unknown) => toast(e instanceof ApiError ? e.message : 'That didn’t go through.', undefined, 'warn'), [toast]);
  useEffect(() => { if (LIVE) api<About>('GET', `${A()}/assistant/about`).then(setAbout).catch(fail); }, [fail]);
  useEffect(() => { if (LIVE && tab === 'log') api<Entry[]>('GET', `${A()}/ai-audit?only=${only}`).then(setLog).catch(fail); }, [tab, only, fail]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [turns]);

  if (!LIVE) {
    return (
      <>
        <PageHead title="Assistant" sub="Ask about your society in plain words." />
        <Empty icon={Robot} title="Connect the console to the API" body="The assistant reads the society’s live records. Set VITE_API_URL to use it." />
      </>
    );
  }

  const ask = async (q: string) => {
    const question = q.trim();
    if (question.length < 2 || busy) return;
    setText(''); setBusy(true);
    setTurns(t => [...t, { q: question, a: null }]);
    try {
      const a = await api<Reply>('POST', `${A()}/assistant/ask`, { text: question });
      setTurns(t => t.map((x, i) => (i === t.length - 1 ? { ...x, a } : x)));
    } catch (e) { fail(e); setTurns(t => t.slice(0, -1)); }
    setBusy(false);
  };
  const decide = async (index: number, verdict: 'confirm' | 'cancel') => {
    const id = turns[index]?.a?.action?.id;
    if (!id) return;
    setBusy(true);
    try {
      const r = await api<{ status: string; outcome: string; link?: string | null }>('POST', `${A()}/assistant/actions/${id}/${verdict}`);
      setTurns(t => t.map((x, i) => (i === index ? { ...x, outcome: { status: r.status, text: r.outcome, link: r.link } } : x)));
    } catch (e) { fail(e); }
    setBusy(false);
  };
  const submit = (e: FormEvent) => { e.preventDefault(); void ask(text); };
  const write = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    api<Draft>('POST', `${A()}/assistant/draft`, draft).then(d => setDrafted({ ...d, kind: draft.kind })).catch(fail).finally(() => setBusy(false));
  };
  const copy = (d: { title: string; body: string }) => navigator.clipboard.writeText(`${d.title}\n\n${d.body}`).then(() => toast('Copied', 'Paste it into a new message in Communication.')).catch(() => toast('Couldn’t copy', undefined, 'warn'));
  const draftBox = (d: Draft) => (
    <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12, marginTop: 8, background: 'var(--panel2)' }}>
      <b style={{ fontSize: 13.5 }}>{d.title}</b>
      <p style={{ fontSize: 13.5, whiteSpace: 'pre-wrap', margin: '6px 0 10px' }}>{d.body}</p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="a-btn ghost" onClick={() => copy(d)}>Copy</button>
        <Link className="a-btn ghost" to="/communication">Open Communication<ArrowRight size={14} /></Link>
        <span style={small}>{d.by === 'ai' ? 'Written by the AI model' : 'From the built-in wording'} · nothing has been sent</span>
      </div>
    </div>
  );

  return (
    <>
      <PageHead title="Assistant" sub="Ask about the society in plain words, or ask it to do something. It only ever shows what your role may see, and it never acts without your yes." />
      <div className="toolbar" style={{ gap: 6 }}>
        <button className={'a-btn' + (tab === 'ask' ? '' : ' ghost')} onClick={() => setTab('ask')}><Sparkle size={15} />Ask</button>
        <button className={'a-btn' + (tab === 'log' ? '' : ' ghost')} onClick={() => setTab('log')}><ClipboardText size={15} />Activity log</button>
        <span style={{ flex: 1 }} />
        {about && <span style={small}>Signed in as {about.role} · sees {about.sees.join(', ')} · {about.aiConnected ? 'AI model connected' : 'running on built-in rules (no AI key)'}</span>}
      </div>

      {tab === 'ask' && (
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'minmax(0, 1fr)' }}>
          <div className="card" style={{ display: 'grid', gap: 14 }}>
            {!turns.length && about && (
              <div>
                <b style={{ fontSize: 13.5 }}>Try asking</b>
                <div className="filters" style={{ marginTop: 8, marginBottom: 0 }}>{about.examples.map(x => <button key={x} onClick={() => ask(x)}>{x}</button>)}</div>
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i} style={{ display: 'grid', gap: 8 }}>
                <div style={{ justifySelf: 'end', background: 'var(--acc)', color: '#fff', padding: '8px 13px', borderRadius: '14px 14px 4px 14px', fontSize: 13.5, maxWidth: '80%' }}>{t.q}</div>
                {!t.a ? <div style={small}>Looking that up…</div> : (
                  <div style={{ maxWidth: '100%' }}>
                    <div style={{ fontSize: 14, lineHeight: 1.5, color: t.a.refused ? 'var(--bad)' : undefined }}>{t.a.text}</div>
                    {t.a.cards.map(c => (
                      <div key={c.key} style={{ marginTop: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                          <b style={{ fontSize: 13 }}>{c.title}</b><span style={{ flex: 1 }} />
                          {c.link && <Link to={c.link} style={{ fontSize: 12, fontWeight: 700, color: 'var(--acc-ink)' }}>Open the screen →</Link>}
                        </div>
                        {c.rows.length > 0 && (
                          <div className="a-tbl-wrap" style={{ marginTop: 6 }}>
                            <table className="a-tbl"><thead><tr>{c.columns.map(h => <th key={h}>{h}</th>)}</tr></thead>
                              <tbody>{c.rows.map((r, n) => <tr key={n}>{r.map((v, k) => <td key={k}>{v}</td>)}</tr>)}</tbody></table>
                          </div>
                        )}
                      </div>
                    ))}
                    {t.a.draft && draftBox(t.a.draft)}
                    {t.a.link && !t.a.draft && <Link className="a-btn ghost" style={{ marginTop: 8 }} to={t.a.link}>{t.a.linkLabel ?? 'Open'}<ArrowRight size={14} /></Link>}
                    {t.a.action && !t.outcome && (
                      <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
                        <button className="a-btn" disabled={busy} onClick={() => decide(i, 'confirm')}>Yes, do it</button>
                        <button className="a-btn ghost" disabled={busy} onClick={() => decide(i, 'cancel')}>No, cancel</button>
                        <span style={small}>Nothing happens until you say yes.</span>
                      </div>
                    )}
                    {t.outcome && (
                      <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <Pill tone={t.outcome.status === 'done' ? 'good' : 'dim'}>{t.outcome.status === 'done' ? 'Done' : 'Cancelled'}</Pill><span style={{ fontSize: 13.5 }}>{t.outcome.text}</span>
                        {t.outcome.link && <Link to={t.outcome.link} style={{ fontSize: 12, fontWeight: 700, color: 'var(--acc-ink)' }}>Open →</Link>}
                      </div>
                    )}
                    {t.a.chips && <div className="filters" style={{ marginTop: 8, marginBottom: 0 }}>{t.a.chips.map(x => <button key={x} onClick={() => ask(x)}>{x}</button>)}</div>}
                    <div style={{ ...small, marginTop: 6 }}>{t.a.by === 'ai' ? 'Worded by the AI model from the records shown' : 'Answered from the records by the built-in rules'}</div>
                  </div>
                )}
              </div>
            ))}
            <div ref={end} />
            <form onSubmit={submit} style={{ display: 'flex', gap: 8 }}>
              <input className="a-in" style={{ flex: 1 }} value={text} onChange={e => setText(e.target.value)} placeholder="Ask about dues, complaints, vendors, visitors… or say what to do" aria-label="Ask the assistant" maxLength={1000} />
              <button className="a-btn" disabled={busy || text.trim().length < 2}><PaperPlaneRight size={15} />Ask</button>
            </form>
          </div>

          <form onSubmit={write} className="card" style={{ display: 'grid', gap: 10 }}>
            <b>Write a message for me</b>
            <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'minmax(180px, 240px) 1fr auto', alignItems: 'end' }}>
              <label>What kind<select className="a-in" value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value })}>{(about?.draftKinds ?? [draft.kind]).map(k => <option key={k}>{k}</option>)}</select></label>
              <label>The details<input className="a-in" value={draft.details} onChange={e => setDraft({ ...draft, details: e.target.value })} placeholder="e.g. Tower 4, Saturday 10 am to 2 pm, pump repair" maxLength={1500} /></label>
              <button className="a-btn" disabled={busy}>Write it</button>
            </div>
            {drafted && draftBox(drafted)}
          </form>
        </div>
      )}

      {tab === 'log' && (
        <>
          <div className="filters">
            <button className={only === 'all' ? 'on' : ''} onClick={() => setOnly('all')}>Everything</button>
            <button className={only === 'actions' ? 'on' : ''} onClick={() => setOnly('actions')}>Actions only</button>
          </div>
          {!log.length ? <Empty icon={ClipboardText} title="Nothing yet" body="Every question asked of the assistant and every action it proposes is recorded here." /> : (
            <TableCard rows={log} noun="entry" search={l => [l.user, l.prompt, l.response, l.outcome]} placeholder="Search what was asked or answered"
              filters={[{ key: 'who', label: 'Who', get: l => l.user }, { key: 'role', label: 'Role', get: l => l.role }, { key: 'status', label: 'Status', get: l => l.status }, { key: 'by', label: 'Answered by', get: l => (l.by === 'ai' ? 'AI model' : 'Built-in rules'), options: ['AI model', 'Built-in rules'] }]}
              csv={{ name: 'assistant-activity', head: ['When', 'Who', 'Role', 'Asked', 'Answer', 'Records read', 'Action', 'Status', 'Outcome'], row: l => [l.at, l.user, l.role, l.prompt, l.response, l.dataAccessed.join('; '), l.action ?? '', l.status, l.outcome] }}>{(page, sl) => (<div className="a-tbl-wrap">
              <table className="a-tbl">
                <thead><tr><th className="sl">Sl. no.</th><th>When</th><th>Who</th><th>Asked</th><th>Answer</th><th>Records read</th><th>Action</th><th>Status</th></tr></thead>
                <tbody>{page.map((l, rowNo) => (
                  <tr key={l.id}><td className="sl num">{sl(rowNo)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{when(l.at)}</td>
                    <td><div className="cell-t">{l.user}</div><div className="cell-m">{l.role} · {l.surface === 'app' ? 'mobile app' : 'console'}</div></td>
                    <td style={{ maxWidth: 240 }}>{l.prompt}</td>
                    <td style={{ maxWidth: 320 }}><div>{l.response.length > 160 ? l.response.slice(0, 160) + '…' : l.response}</div>{l.outcome && <div className="cell-m">{l.outcome}</div>}<div className="cell-m">{l.by === 'ai' ? 'AI model' : 'Built-in rules'}</div></td>
                    <td>{l.dataAccessed.join(', ') || '—'}</td>
                    <td>{l.action ? <>{ACTION_NAME[l.action] ?? l.action}<div className="cell-m">Needed a yes</div></> : '—'}</td>
                    <td><Pill tone={STATUS_TONE[l.status] ?? 'dim'}>{l.status}</Pill></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>)}</TableCard>
          )}
        </>
      )}
    </>
  );
}
