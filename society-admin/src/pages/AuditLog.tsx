import { Alarm, ClipboardText, Cpu, DownloadSimple, MagnifyingGlassMinus, ShieldWarning, User, X } from '@phosphor-icons/react';
import { useState } from 'react';
import { Avatar, Empty, PageHead, PanelHead, Pill, Stat } from '../components/ui';
import { downloadCsv, type PillTone } from '../lib/format';
import { useStore } from '../store/context';
import type { AuditEntry } from '../store/data';

type Who = 'all' | 'people' | 'system';
const PAGE = 40;

const isSystem = (a: AuditEntry) => a.who.startsWith('System');

/** what part of the console an entry is about, read from its own wording */
const AREAS: [string, PillTone, RegExp][] = [
  ['Issues', 'acc', /\bISS-\d+|work order|vendor|\bSLA\b/i],
  ['Moderation', 'warn', /\bMOD-\d+|moderation|removed a|abuse-guard|threshold/i],
  ['Residents', 'bad', /standing of|restricted|suspended|reactivated|member verified|warned/i],
  ['Announcements', 'acc', /announcement|\bAN-\d+|message sent|notice/i],
  ['Events & polls', 'good', /\bevent|\bpoll|\bRSVP|\bvote/i],
  ['Gratitude', 'good', /gratitude/i],
  ['Accounts', 'dim', /bill|payment|receipt|expense|invoice|payout|ledger|₹/i],
  ['Gate', 'dim', /visitor|guard|gate|delivery|watch ?list/i],
];
const areaOf = (a: AuditEntry): [string, PillTone] => { const hit = AREAS.find(([, , re]) => re.test(a.what)); return hit ? [hit[0], hit[1]] : ['Other', 'dim']; };

/** the day an entry belongs under: exact when the server gave a time, otherwise what its own label says */
function dayOf(a: AuditEntry) {
  if (a.at) {
    const d = new Date(a.at), now = new Date();
    const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) / 864e5);
    return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }
  return a.when === 'Just now' || /ago$/.test(a.when) ? 'Today' : a.when.split(',')[0];
}
const clock = (a: AuditEntry) => (a.at ? new Date(a.at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : a.when.includes(',') ? a.when.split(',')[1].trim() : a.when);

function ActorIcon({ who }: { who: string }) {
  if (who === 'System (SLA)') return <span className="aud-ic bad"><Alarm size={15} /></span>;
  if (who === 'System (safety)') return <span className="aud-ic warn"><ShieldWarning size={15} /></span>;
  if (who.startsWith('System')) return <span className="aud-ic"><Cpu size={15} /></span>;
  return <Avatar name={who} size={30} />;
}

export function AuditLog() {
  const { state } = useStore();
  const [who, setWho] = useState<Who>('all');
  const [area, setArea] = useState('');
  const [actor, setActor] = useState('');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const term = q.trim().toLowerCase();

  const all = state.audit;
  const list = all
    .filter(a => who === 'all' || (who === 'system') === isSystem(a))
    .filter(a => !area || areaOf(a)[0] === area)
    .filter(a => !actor || a.who === actor)
    .filter(a => !term || (a.who + ' ' + a.what).toLowerCase().includes(term));
  const shown = list.slice(0, limit);
  const tally = (key: (a: AuditEntry) => string) => { const m = new Map<string, number>(); all.forEach(a => m.set(key(a), (m.get(key(a)) ?? 0) + 1)); return [...m.entries()].sort((x, y) => y[1] - x[1]); };
  const areas = tally(a => areaOf(a)[0]);
  const actors = tally(a => a.who);
  const most = Math.max(1, ...areas.map(x => x[1]));
  const filtered = who !== 'all' || !!area || !!actor || !!term;
  const clear = () => { setWho('all'); setArea(''); setActor(''); setQ(''); setLimit(PAGE); };
  const pick = <T,>(set: (v: T) => void, v: T) => { set(v); setLimit(PAGE); };

  return (
    <>
      <PageHead
        title="Audit log"
        sub="Who did what, when, and why — for every admin, moderator and system action. New entries appear at the top. Private message content is never stored in general logs."
        actions={<button className="a-btn ghost" disabled={!list.length} onClick={() => downloadCsv('audit-log.csv', [['Who', 'Area', 'What', 'When'], ...list.map(a => [a.who, areaOf(a)[0], a.what, a.at ? new Date(a.at).toLocaleString('en-IN') : a.when])])}><DownloadSimple size={15} />Export CSV</button>}
      />
      <div className="stats">
        <Stat icon={ClipboardText} label="Entries" value={all.length} />
        <Stat icon={User} label="By people" value={all.filter(a => !isSystem(a)).length} />
        <Stat icon={Cpu} label="By the system" value={all.filter(isSystem).length} />
        <Stat icon={ClipboardText} label="Today" value={all.filter(a => dayOf(a) === 'Today').length} tone="good" />
      </div>
      <div className="toolbar">
        <div className="filters">
          {([['all', 'Everything'], ['people', 'People'], ['system', 'System']] as [Who, string][]).map(([k, l]) => (
            <button key={k} className={who === k ? 'on' : ''} onClick={() => pick(setWho, k)}>{l}</button>
          ))}
        </div>
        <select className="a-in" value={area} onChange={e => pick(setArea, e.target.value)} aria-label="Area">
          <option value="">All areas</option>{areas.map(([a]) => <option key={a}>{a}</option>)}
        </select>
        <select className="a-in" value={actor} onChange={e => pick(setActor, e.target.value)} aria-label="Who">
          <option value="">Anyone</option>{actors.map(([a]) => <option key={a}>{a}</option>)}
        </select>
        <div className="search-in">
          <input className="a-in" value={q} onChange={e => pick(setQ, e.target.value)} placeholder="Search the log…" aria-label="Search the audit log" />
          {q && <button onClick={() => pick(setQ, '')} aria-label="Clear search"><X size={14} /></button>}
        </div>
      </div>

      <div className="grid2">
        <div className="panel">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, color: 'var(--ink2)', fontWeight: 600, marginBottom: 10 }}>
            <span className="num">{filtered ? `${list.length} of ${all.length} entries match` : `${all.length} entries`}</span>
            {filtered && <button className="tbl-clear" onClick={clear}>Clear filters</button>}
          </div>
          {shown.map((a, i) => {
            const [name, tone] = areaOf(a);
            const d = dayOf(a);
            return (
              <div key={i}>
                {(i === 0 || dayOf(shown[i - 1]) !== d) && <div className="day-h">{d}</div>}
                <div className="audit-line">
                  <ActorIcon who={a.who} />
                  <div className="aud-body">
                    <span className="who">{a.who}</span> <span>{a.what}</span>
                  </div>
                  <span className="when"><Pill tone={tone}>{name}</Pill><span className="num">{clock(a)}</span></span>
                </div>
              </div>
            );
          })}
          {!list.length && <Empty icon={MagnifyingGlassMinus} title="No entries match" body="Try a different filter or search." />}
          {list.length > limit && <div className="more"><button className="a-btn ghost" onClick={() => setLimit(limit + PAGE)}>Show {Math.min(PAGE, list.length - limit)} more · {list.length - limit} left</button></div>}
        </div>

        <div className="stack">
          <div className="panel">
            <PanelHead icon={ClipboardText} title="By area" sub="Click an area to filter the log" />
            {areas.map(([a, n]) => (
              <button key={a} className="bar-row" style={{ width: '100%', textAlign: 'left' }} onClick={() => pick(setArea, area === a ? '' : a)} aria-pressed={area === a}>
                <span className="lab" style={area === a ? { color: 'var(--acc-ink)', fontWeight: 700 } : undefined}>{a}</span>
                <div className="bar-track"><div className="bar-fill" style={{ width: (n / most) * 100 + '%' }} /></div>
                <b className="num" style={{ fontSize: 12, width: 26, textAlign: 'right' }}>{n}</b>
              </button>
            ))}
            {!areas.length && <div className="d-none">Nothing has been logged yet.</div>}
          </div>
          <div className="panel">
            <PanelHead icon={User} title="Most active" sub="Entries per person or system job" tone="good" />
            <ul className="mini">
              {actors.slice(0, 6).map(([a, n]) => (
                <li key={a}><button className="m-go" onClick={() => pick(setActor, actor === a ? '' : a)} aria-pressed={actor === a}><ActorIcon who={a} /><span className="m-t"><b style={actor === a ? { color: 'var(--acc-ink)' } : undefined}>{a}</b><span>{a.startsWith('System') ? 'Automatic' : 'Person'}</span></span></button><b className="num">{n}</b></li>
              ))}
            </ul>
            {!actors.length && <div className="d-none">Nothing has been logged yet.</div>}
          </div>
        </div>
      </div>
    </>
  );
}
