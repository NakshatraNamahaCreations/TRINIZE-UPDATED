import { Books, ChatCircleText, ChatsCircle, FilePdf, HandHeart, type Icon as IconType, Lightning, MagicWand, Newspaper, ShieldCheck, Smiley, SmileyWink, Ticket, UploadSimple } from '@phosphor-icons/react';
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
          <div className="panel">
            <PanelHead icon={Books} title="Approved knowledge" sub="The only sources the assistant may answer from" />
            {ai.docs.map(d => (
              <div key={d.n} className="setrow">
                <IconTile icon={FilePdf} tone="bad" />
                <div className="st"><b>{d.n}</b><span>{d.t} · updated {d.d}</span></div>
                <button className="a-btn ghost sm" onClick={() => toast('Coming in the real build', 'Version history, re-index and remove.')}>Manage</button>
              </div>
            ))}
            <button className="a-btn soft" style={{ marginTop: 10 }} onClick={() => toast('Coming in the real build', 'Upload → auto-index → the assistant can cite it.')}>
              <UploadSimple size={14} />Upload document
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
