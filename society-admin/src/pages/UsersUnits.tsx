import { Prohibit, UserCheck, UserMinus, UsersThree, Warning } from '@phosphor-icons/react';
import { useState } from 'react';
import { Avatar, Empty, PageHead, Pill, Stat } from '../components/ui';
import { userTone } from '../lib/format';
import { useStore } from '../store/context';
import { SOCIETY } from '../store/data';

export function UsersUnits() {
  const { state, actions } = useStore();
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const list = state.users.filter(u => !term || (u.n + ' ' + u.unit + ' ' + u.role).toLowerCase().includes(term));
  const count = (s: string) => state.users.filter(u => u.status === s).length;

  return (
    <>
      <PageHead title="Users & units" sub={`Verified members of ${SOCIETY.name}. Restrictions remove only the restricted capability and auto-expire; suspensions block posting and social actions. Every change needs a reason.`} />
      <div className="stats">
        <Stat icon={UsersThree} label="Members" value={state.users.length} />
        <Stat icon={UserCheck} label="Active" value={count('Active')} tone="good" />
        <Stat icon={Warning} label="Warned" value={count('Warned')} tone="warn" />
        <Stat icon={Prohibit} label="Restricted" value={count('Restricted') + count('Suspended')} tone="bad" />
      </div>
      <div className="toolbar">
        <div className="search-in wide">
          <input className="a-in" value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name, unit or role…" aria-label="Search members" />
        </div>
      </div>
      <div className="a-tbl-wrap">
        <table className="a-tbl">
          <tbody>
            <tr><th>Resident</th><th>Unit</th><th>Role</th><th>Warnings</th><th>Status</th><th /></tr>
            {list.map(u => {
              const limited = u.status === 'Restricted' || u.status === 'Suspended';
              return (
                <tr key={u.n}>
                  <td><span className="who-cell"><Avatar name={u.n} size={30} /><span className="cell-t">{u.n}</span></span></td>
                  <td data-l="Unit" className="num">{u.unit}</td>
                  <td data-l="Role">{u.role}</td>
                  <td data-l="Warnings" className="num">{u.warns > 0 ? <b style={{ color: 'var(--warn)' }}>{u.warns}</b> : 0}</td>
                  <td data-l="Status"><Pill tone={userTone(u.status)} dot>{u.status}</Pill></td>
                  <td data-l="" style={{ textAlign: 'right' }}>
                    {limited
                      ? <button className="a-btn ghost sm" onClick={() => actions.reactivateUser(u.n)}>Reactivate</button>
                      : <button className="a-btn ghost sm" onClick={() => actions.restrictUser(u.n)}>Restrict 24h</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!list.length && <Empty icon={UserMinus} title="No members match" body={`Nobody matches “${q}”.`} />}
      </div>
      <div className="flow-note">Real build: invite & approve flows, block/unit mapping, family members, role assignment (committee, moderator, vendor) and CSV import — reusing the owner-onboarding model the platform already has.</div>
    </>
  );
}
