import { Alarm, Cpu, DownloadSimple, MagnifyingGlassMinus, ShieldWarning } from '@phosphor-icons/react';
import { useState } from 'react';
import { Avatar, Empty, PageHead } from '../components/ui';
import { downloadCsv } from '../lib/format';
import { useStore } from '../store/context';
import type { AuditEntry } from '../store/data';

type Who = 'all' | 'people' | 'system';

const isSystem = (a: AuditEntry) => a.who.startsWith('System');

function ActorIcon({ who }: { who: string }) {
  if (who === 'System (SLA)') return <span className="aud-ic bad"><Alarm size={15} /></span>;
  if (who === 'System (safety)') return <span className="aud-ic warn"><ShieldWarning size={15} /></span>;
  if (who.startsWith('System')) return <span className="aud-ic"><Cpu size={15} /></span>;
  return <Avatar name={who} size={30} />;
}

export function AuditLog() {
  const { state } = useStore();
  const [who, setWho] = useState<Who>('all');
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const list = state.audit
    .filter(a => who === 'all' || (who === 'system') === isSystem(a))
    .filter(a => !term || (a.who + ' ' + a.what).toLowerCase().includes(term));

  return (
    <>
      <PageHead
        title="Audit log"
        sub="Who did what, when, and why — for every admin, moderator and system action. New entries appear at the top. Private message content is never stored in general logs."
        actions={<button className="a-btn ghost" disabled={!list.length} onClick={() => downloadCsv('audit-log.csv', [['Who', 'What', 'When'], ...list.map(a => [a.who, a.what, a.when])])}><DownloadSimple size={15} />Export CSV</button>}
      />
      <div className="toolbar">
        <div className="filters">
          {([['all', 'Everything'], ['people', 'People'], ['system', 'System']] as [Who, string][]).map(([k, l]) => (
            <button key={k} className={who === k ? 'on' : ''} onClick={() => setWho(k)}>{l}</button>
          ))}
        </div>
        <div className="search-in">
          <input className="a-in" value={q} onChange={e => setQ(e.target.value)} placeholder="Search the log…" aria-label="Search the audit log" />
        </div>
      </div>
      <div className="panel">
        {list.map((a, i) => (
          <div key={i} className="audit-line">
            <ActorIcon who={a.who} />
            <div className="aud-body">
              <span className="who">{a.who}</span> <span>{a.what}</span>
            </div>
            <span className="when">{a.when}</span>
          </div>
        ))}
        {!list.length && <Empty icon={MagnifyingGlassMinus} title="No entries match" body="Try a different filter or search." />}
      </div>
    </>
  );
}
