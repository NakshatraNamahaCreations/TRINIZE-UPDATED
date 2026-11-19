import { confirmBox } from '../lib/dialog';
import { Books, ChatCircleText, ChatsCircle, FilePdf, HandHeart, type Icon as IconType, Lightning, MagicWand, Newspaper, ShieldCheck, Smiley, SmileyWink, Ticket, Trash, UploadSimple } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { ApiError, LIVE } from '../lib/api';
import { addKnowledgeLive, factsLive, removeKnowledgeLive, saveFactsLive, type Fact } from '../lib/live';
import { IconTile, PageHead, PanelHead, Switch } from '../components/ui';
import { useToast } from '../components/toast-context';
import type { State, Tone } from '../store/data';
import { useStore } from '../store/context';

type Feature = 'qna' | 'issueCreate' | 'toneRewrite' | 'summaries';
const FEATURES: [Feature, string, string, IconType][] = [
  ['qna', 'Community Q&A', 'Answers only from approved documents, always citing the source', ChatCircleText],
  ['issueCreate', 'Issue creation in chat', 'Guided flow · resident must confirm before anything is created', Ticket],
  ['toneRewrite', 'Tone rewrite', 'Suggests a rewrite the resident must accept — never auto-replaces', MagicWand],
  ['summaries', 'Private summaries', 'Weekly digest, visible only to the resident', Newspaper],
];
const TONE_ICON: Record<Tone, IconType> = { Polite: HandHeart, Friendly: Smiley, Funny: SmileyWink, 'Short & Clear': Lightning };
const TONE_HINT: Record<Tone, string> = {
  Polite: 'Kind, respectful & professional — default',
  Friendly: 'Warm & casual',
  Funny: 'Light-hearted — never at someone’s expense',
  'Short & Clear': 'Straight to the point',
};

export function AIControls() {
  const { state, actions } = useStore();
  const toast = useToast();
  const ai = state.ai;
  /* timings and rules: the questions residents ask most, one line each */
  const [facts, setFacts] = useState<Fact[]>([]);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [savingFacts, setSavingFacts] = useState(false);
  useEffect(() => { if (LIVE) factsLive().then(setFacts).catch(() => {}); }, [ai.docs.length]);
  const changed = Object.entries(typed).filter(([k, v]) => v.trim() !== (facts.find(f => f.key === k)?.value ?? ''));
  const saveFacts = () => {
    setSavingFacts(true);
    saveFactsLive(Object.fromEntries(changed.map(([k, v]) => [k, v.trim()])))
      .then(now => { setFacts(now); setTyped({}); toast('Saved', 'The assistant answers from these straight away.'); actions.refresh(); })
      .catch(oops).finally(() => setSavingFacts(false));
  };

  /* approved knowledge: adding and removing what the assistant may answer from */
  const [doc, setDoc] = useState({ title: '', section: '', body: '' });
  const [openDoc, setOpenDoc] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const docOk = doc.title.trim().length >= 3 && doc.body.trim().length >= 20;
  const oops = (e: unknown) => toast(e instanceof ApiError ? e.message : 'That didn’t go through. Please try again.', undefined, 'warn');
  const addDoc = () => {
    setSaving(true);
    addKnowledgeLive({ title: doc.title.trim(), section: doc.section.trim(), body: doc.body.trim() })
      .then(() => { toast('Added', 'The assistant can answer from it straight away.'); setDoc({ title: '', section: '', body: '' }); actions.refresh(); })
      .catch(oops).finally(() => setSaving(false));
  };
  const removeDoc = async (id: string, title: string, section: string) => {
    if (!(await confirmBox(`Remove “${title} · ${section}”? The assistant will stop answering from it.`))) return;
    removeKnowledgeLive(id).then(() => { toast('Removed'); actions.refresh(); }).catch(oops);
  };

  return (
    <>
      <PageHead title="AI assistant — controls" sub="Everything the AI does is configurable per society, without code changes. Toggles here change the resident app immediately — switch a tone off and it disappears from the resident composer." />
      <div className="grid2">
        <div>
          <div className="panel">
            <PanelHead icon={Lightning} title="Features" sub="Turn each capability on or off independently" />
            {FEATURES.map(([k, title, sub, Icon]) => (
              <div key={k} className="setrow">
                <IconTile icon={Icon} tone={ai[k] ? 'acc' : 'dim'} />
                <div className="st"><b>{title}</b><span>{sub}</span></div>
                <Switch on={ai[k]} label={title} onToggle={() => actions.toggleFeature(k)} />
              </div>
            ))}
          </div>
          <div className="panel">
            <PanelHead icon={ChatsCircle} title="Message tones" sub="Tones offered in the resident composer" tone="good" />
            {(Object.keys(ai.tones) as Tone[]).map(t => (
              <div key={t} className="setrow">
                <IconTile icon={TONE_ICON[t]} tone={ai.tones[t] ? 'good' : 'dim'} />
                <div className="st"><b>{t}</b><span>{TONE_HINT[t]}</span></div>
                <Switch on={ai.tones[t]} label={t} onToggle={() => actions.toggleTone(t)} />
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="panel">
            <PanelHead icon={ShieldCheck} title="Safety & moderation" sub="Server-side checks on every post, comment and chat" tone="warn" />
            <div className="setrow">
              <div className="st"><b>Moderation threshold</b><span>How strict the safety check is</span></div>
              <select className="a-in" value={ai.threshold} onChange={e => actions.setThreshold(e.target.value as State['ai']['threshold'])} aria-label="Moderation threshold">
                {['Lenient', 'Standard', 'Strict'].map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div className="setrow">
              <div className="st"><b>Auto-hold for review</b><span>Severity that goes straight to the queue</span></div>
              <select className="a-in" value={ai.autoHold} onChange={e => actions.setAutoHold(e.target.value as State['ai']['autoHold'])} aria-label="Auto-hold severity">
                {['Medium & above', 'High severity'].map(o => <option key={o}>{o}</option>)}
              </select>
            </div>
            <div className="flow-note" style={{ marginTop: 10 }}>
              <b>Hard guarantees (not configurable):</b> AI never posts, votes, RSVPs or closes anything on its own · all checks re-run server-side on the final text · private chats surface only flagged excerpts · every action is audited.
            </div>
          </div>
          {LIVE && facts.length > 0 && (
            <div className="panel">
              <PanelHead icon={ChatsCircle} title="Timings and rules" sub="What residents ask most — the assistant answers from whatever you fill in here" />
              <div className="form-grid">
                {facts.map(f => (
                  <label key={f.key} className={'fld' + (f.key === 'other' ? ' full' : '')}>{f.label}
                    {f.key === 'other'
                      ? <textarea className="a-in" maxLength={2000} value={typed[f.key] ?? f.value} onChange={e => setTyped(v => ({ ...v, [f.key]: e.target.value }))} placeholder={f.hint} style={{ minHeight: 80 }} />
                      : <input className="a-in" maxLength={300} value={typed[f.key] ?? f.value} onChange={e => setTyped(v => ({ ...v, [f.key]: e.target.value }))} placeholder={'e.g. ' + f.hint} />}
                  </label>
                ))}
              </div>
              <button className="a-btn" style={{ marginTop: 12 }} disabled={!changed.length || savingFacts} onClick={saveFacts}>Save {changed.length ? `${changed.length} change${changed.length === 1 ? '' : 's'}` : 'changes'}</button>
              <div className="flow-note">{facts.filter(f => f.value).length} of {facts.length} filled in. Leave a line empty if it doesn’t apply; clearing a line removes it from the assistant. Each line shows below as a “Society facts” entry.</div>
            </div>
          )}
          <div className="panel">
            <PanelHead icon={Books} title="Approved knowledge" sub="The only sources the assistant may answer from" />
            {!ai.docs.length && <div className="d-none">Nothing yet. Until you add something, the assistant tells residents it doesn’t know and offers to pass the question to the office.</div>}
            {ai.docs.map(d => (
              <div key={d.id ?? d.n + d.t} className="setrow" style={{ alignItems: 'flex-start' }}>
                <IconTile icon={FilePdf} tone="bad" />
                <div className="st">
                  <b>{d.n}</b><span>{d.t} · added {d.d}</span>
                  {d.body && <button className="doc-body" onClick={() => setOpenDoc(openDoc === d.id ? null : d.id ?? null)} aria-expanded={openDoc === d.id}>{openDoc === d.id ? d.body : d.body.slice(0, 110) + (d.body.length > 110 ? '… show all' : '')}</button>}
                </div>
                {LIVE && d.id
                  ? <button className="a-btn ghost sm danger" onClick={() => removeDoc(d.id!, d.n, d.t)} aria-label={`Remove ${d.n} · ${d.t}`} title="Remove"><Trash size={14} /></button>
                  : <button className="a-btn ghost sm" onClick={() => toast('Available when connected to the server')}>Manage</button>}
              </div>
            ))}
            {LIVE ? (
              <div className="reg">
                <div className="lbl">Add something the assistant can answer from</div>
                <div className="form-grid">
                  <label className="fld">Document or topic<input className="a-in" value={doc.title} maxLength={120} onChange={e => setDoc(v => ({ ...v, title: e.target.value }))} placeholder="e.g. Clubhouse rules 2026" /></label>
                  <label className="fld">Section <span style={{ fontWeight: 400 }}>(optional)</span><input className="a-in" value={doc.section} maxLength={80} onChange={e => setDoc(v => ({ ...v, section: e.target.value }))} placeholder="e.g. Pool, page 2" /></label>
                  <label className="fld full">The text<textarea className="a-in" value={doc.body} maxLength={20000} onChange={e => setDoc(v => ({ ...v, body: e.target.value }))} placeholder="Write or paste the rule as residents should hear it. For example: Pool hours are 6:00–9:00 AM and 4:00–8:00 PM. The pool is closed on Mondays for cleaning." style={{ minHeight: 110 }} /></label>
                </div>
                <button className="a-btn" style={{ marginTop: 10 }} disabled={!docOk || saving} onClick={addDoc}><UploadSimple size={14} />Add to the assistant</button>
                <div className="flow-note">One topic per entry works best: the assistant quotes the entry that matches the question and names it as the source. Include days and times in full.</div>
              </div>
            ) : (
              <button className="a-btn soft" style={{ marginTop: 10 }} onClick={() => toast('Available when connected to the server', 'Add text → the assistant can cite it.')}>
                <UploadSimple size={14} />Add document
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
