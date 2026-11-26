import { CircleAlert } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { DataList } from '../components/DataList';
import { usePortal } from '../store/context';
import { Kpi, PageHead, Pill } from '../components/ui';
import * as live from '../lib/live';

/* What the AI costs: tokens counted on every model call, priced from AI_PRICES on the server, and the answers
   the Community Assistant gave from its store instead of calling the model again. Connected mode only. */

const RANGES = [7, 30, 90];
const FEATURE = {
  answer: 'Community Assistant answers', moderate: 'Abuse check on posts', rewrite: 'Tone rewrite',
  compose: 'Staff assistant: summaries and drafts', 'extract:verdict': 'Abuse check', 'extract:pick': 'Staff assistant: picking look-ups',
};
const featureName = f => FEATURE[f] ?? (f.startsWith('extract:') ? 'Reading: ' + f.slice(8) : f);
const usd = n => (n === 0 ? '$0' : n < 0.01 ? '<$0.01' : '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const tokens = n => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n));
/** cost, or why there isn't one */
const Cost = ({ s }) => (s.calls === 0 ? <span className="num">—</span> : s.unpriced === s.calls ? <Pill tone="warn">price not set</Pill> : <b className="num" style={{ color: 'var(--ink)' }}>{usd(s.cost)}{s.unpriced > 0 && <i className="a-sub">+ {s.unpriced} unpriced</i>}</b>);

/** set or remove one society's monthly cap */
function CapForm({ society, onSaved }) {
  const { closeModal, toast } = usePortal();
  const [usd, setUsd] = useState(society.budget?.monthlyUsd != null ? String(society.budget.monthlyUsd) : '');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const save = async value => {
    if (value !== null && !(value > 0)) { setError('Enter the most the society may spend in a month, in US dollars.'); return; }
    setBusy(true);
    try {
      await live.setAiBudget(society.id, value);
      closeModal();
      toast(value === null ? `No cap for ${society.name}` : `${society.name}: capped at ${usd2(value)} a month`, value === null ? 'Its AI features run without a monthly limit.' : 'Past the cap, its AI features switch to the built-in rules until the month turns. The abuse check keeps running.', 'check_mark_button');
      onSaved();
    } catch (e) { setError(e?.message ?? 'Something went wrong.'); setBusy(false); }
  };
  return (
    <form onSubmit={e => { e.preventDefault(); void save(Number(usd)); }} noValidate>
      <h2>Monthly AI cap · {society.name}</h2>
      <div className="msub">The most this society’s AI features may cost in a calendar month (India time). Once it’s reached, the assistant, rewrites and drafts switch to the built-in rules until the month turns; stored answers are still given and the abuse check on posts never stops.</div>
      {error && <div className="form-alert bad" role="alert"><CircleAlert size={16} />{error}</div>}
      <label className="fl">US dollars a month<input className="in num" inputMode="decimal" value={usd} onChange={e => setUsd(e.target.value.replace(/[^\d.]/g, ''))} placeholder="e.g. 20" autoFocus /></label>
      {society.budget && <div className="msub" style={{ marginTop: 8 }}>Spent so far this month: <b>{usd2(society.budget.spentThisMonth)}</b></div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <button className="btn" type="submit" disabled={busy}>Save cap</button>
        {society.budget?.monthlyUsd != null && <button className="btn ghost" type="button" disabled={busy} onClick={() => void save(null)}>Remove cap</button>}
        <button className="btn ghost" type="button" onClick={closeModal}>Cancel</button>
      </div>
    </form>
  );
}
const usd2 = n => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function AiUsage() {
  const { openModal } = usePortal();
  const [days, setDays] = useState(30);
  const [r, setR] = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => { live.aiUsage(days).then(v => { setError(''); setR(v); }).catch(e => setError(e?.message ?? 'Couldn’t load the usage.')); }, [days]);
  useEffect(() => { load(); }, [load]);

  const t = r?.total;
  const served = t ? t.calls + t.stored : 0;
  const peak = Math.max(1, ...(r?.byDay ?? []).map(d => d.calls + d.stored));
  return (
    <>
      <PageHead crumb="Administration" title="AI usage">
        Every call to the AI model is counted here, by society and by feature, and priced in US dollars from the rates set on the server (<code>AI_PRICES</code>).
        When residents ask the Community Assistant the same question about their society, the answer is given from the store instead of calling the model again.
      </PageHead>

      <div style={{ display: 'flex', gap: 6, margin: '4px 0 14px', flexWrap: 'wrap' }} role="group" aria-label="Period">
        {RANGES.map(d => <button key={d} className={'btn sm' + (d === days ? '' : ' ghost')} onClick={() => setDays(d)} aria-pressed={d === days}>Last {d} days</button>)}
      </div>

      {error && <div className="form-alert bad" role="alert"><CircleAlert size={16} />{error}</div>}
      {r && !r.capEnforceable && (
        <div className="form-alert" role="status" style={{ marginBottom: 14, background: 'var(--warn-bg)', color: 'var(--warn)' }}>
          <CircleAlert size={16} />
          <span>Monthly caps can’t be fully held to yet: the server has no price for the models in use. Set <code>AI_PRICES</code> so their spend is counted.</span>
        </div>
      )}
      {r?.unpricedModels.length > 0 && (
        <div className="form-alert" role="status" style={{ marginBottom: 14, background: 'var(--warn-bg)', color: 'var(--warn)' }}>
          <CircleAlert size={16} />
          <span>No price is set for {r.unpricedModels.map(m => <code key={m} style={{ marginRight: 6 }}>{m}</code>)} — their calls are counted but not costed. Add the rates to <code>AI_PRICES</code> in the server’s settings.</span>
        </div>
      )}

      {t && <>
        <div className="kpis">
          <Kpi label="AI spend" value={usd(t.cost)} sub={t.unpriced ? `${t.unpriced} call${t.unpriced === 1 ? '' : 's'} not priced` : `last ${days} days`} />
          <Kpi label="Model calls" value={t.calls.toLocaleString('en-IN')} sub={`${tokens(t.input)} in · ${tokens(t.output)} out tokens`} />
          <Kpi label="Answers from the store" value={t.stored.toLocaleString('en-IN')} sub={served ? `${Math.round((t.stored / served) * 100)}% of answers needed no model call` : 'none yet'} />
          <Kpi label="Cached input" value={tokens(t.cached)} sub="input the provider billed at its cached rate" />
        </div>

        <div className="panel">
          <h3>By day</h3>
          <div className="p-sub">Model calls (purple) and answers from the store (green), India time</div>
          {r.byDay.length ? (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 120, marginTop: 8 }}>
              {r.byDay.map(d => (
                <div key={d.date} title={`${d.date}: ${d.calls} calls, ${d.stored} from the store, ${usd(d.cost)}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%', minWidth: 4 }}>
                  <div style={{ height: `${(d.stored / peak) * 100}%`, background: '#12A36B', borderRadius: '3px 3px 0 0' }} />
                  <div style={{ height: `${(d.calls / peak) * 100}%`, background: '#5B3FE0', borderRadius: d.stored ? 0 : '3px 3px 0 0', minHeight: d.calls ? 2 : 0 }} />
                </div>
              ))}
            </div>
          ) : <div className="p-sub">Nothing used the AI in this period.</div>}
        </div>

        <DataList
          rows={r.bySociety} rowKey={s => s.id ?? 'none'} noun="association" minWidth={720}
          search={s => [s.name]} searchPlaceholder="Search by society"
          defaultSort={{ key: 'cost', dir: 'desc' }} emptyAll="No society has used the AI in this period."
          csv={{ name: `ai-usage-${days}d`, head: ['Society', 'Model calls', 'From the store', 'Input tokens', 'Cached input tokens', 'Output tokens', 'Cost (USD)', 'Unpriced calls'], row: s => [s.name, s.calls, s.stored, s.input, s.cached, s.output, s.cost, s.unpriced] }}
          columns={[
            { key: 'name', label: 'Society', sort: s => s.name.toLowerCase(), cell: s => <b>{s.name}</b> },
            { key: 'calls', label: 'Model calls', right: true, dir: 'desc', sort: s => s.calls, cell: s => <span className="num">{s.calls.toLocaleString('en-IN')}</span> },
            { key: 'stored', label: 'From the store', right: true, dir: 'desc', sort: s => s.stored, cell: s => <span className="num">{s.stored.toLocaleString('en-IN')}</span> },
            { key: 'tok', label: 'Tokens in / out', right: true, dir: 'desc', sort: s => s.input + s.output, cell: s => <span className="num">{tokens(s.input)} / {tokens(s.output)}</span> },
            { key: 'cost', label: 'Cost', right: true, dir: 'desc', sort: s => s.cost, cell: s => <Cost s={s} /> },
            { key: 'cap', label: 'Monthly cap', right: true, sort: s => s.budget?.monthlyUsd ?? -1, cell: s => !s.budget ? null : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                <span className="num" style={{ textAlign: 'right' }}>
                  {s.budget.monthlyUsd === null ? <i className="a-sub" style={{ display: 'inline' }}>none</i> : <>{usd2(s.budget.spentThisMonth)} of {usd2(s.budget.monthlyUsd)}</>}
                  {s.budget.capped && <> <Pill tone="bad">cap reached</Pill></>}
                </span>
                <button className="btn sm soft" onClick={() => openModal(<CapForm society={s} onSaved={load} />)}>{s.budget.monthlyUsd === null ? 'Set cap' : 'Change'}</button>
              </div>
            ) },
          ]}
        />

        <div className="grid2" style={{ marginTop: 14 }}>
          <div className="panel">
            <h3>By model</h3>
            <div className="p-sub">Each model is priced at its own rate, in US dollars per million tokens</div>
            {r.byModel.map(m => (
              <div key={m.model} className="person">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b><code>{m.model}</code></b>
                  <span>{m.calls.toLocaleString('en-IN')} calls · {tokens(m.input)} in · {tokens(m.output)} out{m.price ? ` · $${m.price.input} in / $${m.price.output} out per 1M` : ''}</span>
                </div>
                <Cost s={m} />
              </div>
            ))}
            {!r.byModel.length && <div className="p-sub">No model calls in this period.</div>}
          </div>
          <div className="panel">
            <h3>By feature</h3>
            <div className="p-sub">What the calls were for</div>
            {r.byFeature.map(f => (
              <div key={f.feature} className="person">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b>{featureName(f.feature)}</b>
                  <span>{f.calls.toLocaleString('en-IN')} calls{f.stored ? ` · ${f.stored.toLocaleString('en-IN')} from the store` : ''}</span>
                </div>
                <Cost s={f} />
              </div>
            ))}
            {!r.byFeature.length && <div className="p-sub">No AI use in this period.</div>}
          </div>
        </div>
        <div className="p-sub" style={{ marginTop: 10 }}>{r.storedAnswersNow} answer{r.storedAnswersNow === 1 ? ' is' : 's are'} in the store right now. Each lasts until the end of the hour, and is dropped as soon as the society’s information it came from changes.</div>
      </>}
    </>
  );
}
