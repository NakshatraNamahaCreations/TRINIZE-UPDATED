import { ChartBar, Cpu, Database, Lightning, Robot } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';
import { Empty, PageHead, PanelHead, Pill, Stat } from '../components/ui';
import { api, ApiError, LIVE } from '../lib/api';
import { association } from '../lib/live';

/* What the AI features have used in this society: model calls, tokens and their cost, the answers the
   Community Assistant gave from its store, and the monthly cap Trinize has set (if any). Connected mode only. */

type Sum = { calls: number; stored: number; input: number; cached: number; output: number; cost: number; unpriced: number };
type Report = {
  days: number; unpricedModels: string[]; total: Sum; storedAnswersNow: number; capEnforceable: boolean;
  budget: { monthlyUsd: number | null; spentThisMonth: number; capped: boolean; enforceable: boolean } | null;
  byModel: (Sum & { model: string })[]; byFeature: (Sum & { feature: string })[]; byDay: (Sum & { date: string })[];
};
const FEATURE: Record<string, string> = {
  answer: 'Community Assistant answers', moderate: 'Abuse check on posts and chat', rewrite: 'Tone rewrite',
  compose: 'Assistant summaries and drafts', 'extract:pick': 'Assistant: picking look-ups',
};
const featureName = (f: string) => FEATURE[f] ?? (f.startsWith('extract:') ? 'Reading: ' + f.slice(8) : f);
const usd = (n: number) => (n === 0 ? '$0' : n < 0.01 ? '<$0.01' : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const tokens = (n: number) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n));
const small = { fontSize: 12, color: 'var(--ink3)' } as const;

export function AiUsage() {
  const [days, setDays] = useState(30);
  const [r, setR] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    api<Report>('GET', `/v1/admin/${association()}/ai-usage?days=${days}`)
      .then(v => { setError(''); setR(v); })
      .catch(e => setError(e instanceof ApiError && e.status === 403 ? 'Only the society admin can see AI usage.' : e instanceof ApiError ? e.message : 'Couldn’t load the usage.'));
  }, [days]);
  useEffect(() => { if (LIVE) load(); }, [load]);

  const head = <PageHead title="AI usage" sub="What the AI features in your society have used — the Community Assistant, the abuse check, tone rewrites and the staff assistant" />;
  if (!LIVE) return <>{head}<Empty icon={Robot} title="Available when connected" body="Usage is counted on the server, so this page works only in the connected console." /></>;
  if (error) return <>{head}<Empty icon={Robot} title="AI usage isn’t available" body={error} /></>;
  if (!r) return head;

  const t = r.total, b = r.budget;
  const answers = t.stored + (r.byFeature.find(f => f.feature === 'answer')?.calls ?? 0);
  const peak = Math.max(1, ...r.byDay.map(d => d.calls + d.stored));
  return (
    <>
      {head}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }} role="group" aria-label="Period">
        {[7, 30, 90].map(d => <button key={d} className={'a-btn sm' + (d === days ? '' : ' ghost')} onClick={() => setDays(d)} aria-pressed={d === days}>Last {d} days</button>)}
      </div>

      <div className="stats">
        <Stat label={`Model calls · ${days} days`} value={t.calls.toLocaleString('en-IN')} icon={Cpu} />
        <Stat label="Answers from the store" value={t.stored.toLocaleString('en-IN')} icon={Database} tone={t.stored ? 'good' : undefined} />
        <Stat label="Tokens in / out" value={`${tokens(t.input)} / ${tokens(t.output)}`} icon={ChartBar} />
        <Stat label={t.unpriced ? `Cost · ${t.unpriced} calls not priced` : 'Cost'} value={usd(t.cost)} icon={Lightning} />
      </div>

      {b && (
        <div className="panel">
          <PanelHead icon={Lightning} title="This month’s AI spending" sub={b.monthlyUsd === null ? 'No monthly cap is set for your society' : `Trinize has set a cap of ${usd(b.monthlyUsd)} a month`} tone={b.capped ? 'bad' : 'acc'}
            right={b.capped ? <Pill tone="bad">Cap reached</Pill> : undefined} />
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <b className="num" style={{ fontSize: 26 }}>{usd(b.spentThisMonth)}</b>
            {b.monthlyUsd !== null && <span style={small}>of {usd(b.monthlyUsd)}</span>}
          </div>
          {b.monthlyUsd !== null && <div className="prog" style={{ marginTop: 8 }}><i style={{ width: Math.min(100, (b.spentThisMonth / b.monthlyUsd) * 100) + '%', background: b.capped ? 'var(--bad)' : 'var(--acc)' }} /></div>}
          {b.capped && <p style={{ ...small, marginTop: 10 }}>The AI features have switched to the built-in rules for the rest of the month: the assistant still answers from your approved documents and stored answers, and the abuse check keeps running. Ask Trinize to raise the cap if you need more.</p>}
          {b.monthlyUsd !== null && !b.enforceable && <p style={{ ...small, marginTop: 10 }}>The cap can’t be fully held to yet: Trinize hasn’t set prices for every model in use.</p>}
        </div>
      )}

      <div className="panel">
        <PanelHead icon={ChartBar} title="By day" sub="Model calls (purple) and answers from the store (green), India time" />
        {r.byDay.length ? (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 110 }}>
            {r.byDay.map(d => (
              <div key={d.date} title={`${d.date}: ${d.calls} calls, ${d.stored} from the store, ${usd(d.cost)}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%', minWidth: 4 }}>
                <div style={{ height: `${(d.stored / peak) * 100}%`, background: '#12A36B', borderRadius: '3px 3px 0 0' }} />
                <div style={{ height: `${(d.calls / peak) * 100}%`, background: 'var(--s1)', minHeight: d.calls ? 2 : 0 }} />
              </div>
            ))}
          </div>
        ) : <Empty icon={Robot} title="Nothing yet" body="No AI feature has been used in this period." />}
      </div>

      <div className="grid2">
        <div className="panel">
          <PanelHead icon={Robot} title="By feature" sub="What the calls were for" />
          {r.byFeature.length ? (
            <ul className="mini">
              {r.byFeature.map(f => (
                <li key={f.feature}>
                  <span className="m-t"><b>{featureName(f.feature)}</b><span>{f.calls.toLocaleString('en-IN')} calls{f.stored ? ` · ${f.stored.toLocaleString('en-IN')} from the store` : ''}</span></span>
                  {f.calls && f.unpriced === f.calls ? <Pill tone="warn">price not set</Pill> : <b className="num">{usd(f.cost)}</b>}
                </li>
              ))}
            </ul>
          ) : <div className="d-none">No AI use in this period.</div>}
        </div>
        <div className="panel">
          <PanelHead icon={Database} title="Stored answers" sub="Repeated questions about your society, answered without calling the model" tone="good" />
          <b className="num" style={{ fontSize: 26 }}>{answers ? Math.round((t.stored / answers) * 100) : 0}%</b>
          <p style={small}>of the Community Assistant’s answers in this period came from the store. {r.storedAnswersNow} answer{r.storedAnswersNow === 1 ? ' is' : 's are'} stored right now; each lasts until the end of the hour and is dropped as soon as the information it came from changes. Only questions about your society’s shared information are stored — never a resident’s own dues, issues or visitors.</p>
        </div>
      </div>
    </>
  );
}
