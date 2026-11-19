import { confirmBox, promptBox } from '../lib/dialog';
import { Key, LockKey, PencilSimple, ShieldCheck, Trash, UserGear, UserPlus, UsersThree } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';
import { TableCard } from '../components/TableCard';
import { useToast } from '../components/toast-context';
import { Avatar, Empty, PageHead, PanelHead, Pill, Stat, IconBtn } from '../components/ui';
import { useAccess, type SectionInfo } from '../lib/access';
import { ApiError, LIVE } from '../lib/api';
import { addTeamLive, editTeamLive, removeTeamLive, teamLive, teamPasswordLive, type TeamMember } from '../lib/live';

const BLANK = { name: '', email: '', password: '', title: '', full: false, permissions: [] as string[] };
const ROLE_NAME: Record<string, string> = { committee: 'Committee (view)', moderator: 'Moderator', auditor: 'Auditor (books, read-only)' };
const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

function accessLine(m: TeamMember, sections: SectionInfo[]) {
  if (m.access === 'full') return 'Every section of the console';
  if (m.access === 'role') return 'Built-in role — edit to choose sections';
  return m.permissions.map(k => sections.find(s => s.key === k)?.name ?? k).join(', ');
}

export function Team() {
  const toast = useToast();
  const { access } = useAccess();
  const sections = access?.sections ?? [];
  const groups = [...new Set(sections.map(s => s.group))];
  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [form, setForm] = useState(BLANK);
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = useCallback((e: unknown) => toast(e instanceof ApiError ? e.message : 'That didn’t go through. Please try again.', undefined, 'warn'), [toast]);
  const load = useCallback(() => { if (LIVE) teamLive().then(setTeam).catch(fail); }, [fail]);
  useEffect(load, [load]);

  if (!LIVE) return (
    <>
      <PageHead title="Team & access" sub="Who can sign in to this console, and which sections each person may use." />
      <div className="panel"><Empty icon={UserGear} title="Available when connected to the server" body="The demo console has a single built-in admin. Connect it to the Trinize API to add your team." /></div>
    </>
  );

  const list = team ?? [];
  const editing = list.find(m => m.id === editId);
  const set = (patch: Partial<typeof BLANK>) => setForm(f => ({ ...f, ...patch }));
  const clear = () => { setForm(BLANK); setEditId(null); };
  const toggle = (keys: string[], on: boolean) => set({ permissions: on ? [...new Set([...form.permissions, ...keys])] : form.permissions.filter(k => !keys.includes(k)) });

  const startEdit = (m: TeamMember) => {
    setEditId(m.id);
    setForm({ name: m.name, email: m.email, password: '', title: m.title ?? '', full: m.access === 'full', permissions: m.access === 'full' ? [] : m.permissions });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const save = () => {
    const who = { name: form.name.trim(), title: form.title.trim(), full: form.full, permissions: form.full ? [] : form.permissions };
    setBusy(true);
    (editing ? editTeamLive(editing.id, who) : addTeamLive({ ...who, email: form.email.trim(), password: form.password }))
      .then(m => {
        toast(editing ? `${m.name} updated` : `${m.name} added to the team`, editing ? 'Their access changes straight away.' : `They sign in at this console with ${m.email} and the password you set.`);
        clear(); load();
      }).catch(fail).finally(() => setBusy(false));
  };
  const resetPassword = async (m: TeamMember) => {
    const password = await promptBox(`New password for ${m.name}`, '', { body: `At least 8 characters.${m.you ? '' : ' They will be signed out everywhere.'}`, type: 'password', confirm: 'Change password', required: true });
    if (password === null) return;
    if (password.length < 8) { toast('A password needs at least 8 characters.', undefined, 'warn'); return; }
    teamPasswordLive(m.id, password).then(() => toast('Password changed', `Give ${m.name} the new password yourself — it is not sent to them.`)).catch(fail);
  };
  const remove = async (m: TeamMember) => {
    if (!(await confirmBox(`Remove ${m.name} from the team? They are signed out at once and can no longer open this console.`))) return;
    removeTeamLive(m.id).then(() => { toast(`${m.name} removed`, 'Their console login no longer works.'); if (editId === m.id) clear(); load(); }).catch(fail);
  };

  const ready = form.name.trim().length >= 2 && (editing || (/^\S+@\S+\.\S+$/.test(form.email.trim()) && form.password.length >= 8)) && (form.full || form.permissions.length > 0);
  const lockedSelf = !!editing?.you;

  return (
    <>
      <PageHead title="Team & access" sub="Everyone who can sign in to this console. An admin has all of it; give anyone else only the sections they need — the rest stay hidden from them and closed on the server." />
      <div className="stats">
        <Stat icon={UsersThree} label="On the team" value={list.length} />
        <Stat icon={ShieldCheck} label="Full access" value={list.filter(m => m.access === 'full').length} tone="good" />
        <Stat icon={LockKey} label="Limited access" value={list.filter(m => m.access !== 'full').length} />
        <Stat icon={Key} label="Two-step sign-in on" value={list.filter(m => m.twoStep).length} />
      </div>
      <div className="grid2">
        <TableCard rows={list} noun="team member" search={m => [m.name, m.email, m.title, accessLine(m, sections)]} placeholder="Search the team by name, email or section"
          filters={[{ key: 'access', label: 'Access', get: m => (m.access === 'full' ? 'Full access' : 'Limited'), options: ['Full access', 'Limited'] }]}
          csv={{ name: 'team', head: ['Name', 'Email', 'Title', 'Access', 'Sections', 'Two-step sign-in', 'Added'], row: m => [m.name, m.email, m.title ?? '', m.access === 'full' ? 'Full' : 'Limited', accessLine(m, sections), m.twoStep ? 'On' : 'Off', day(m.since)] }}>{(page, sl) => (<div className="a-tbl-wrap">
          <table className="a-tbl compact">
            <tbody>
              <tr><th className="sl">Sl. no.</th><th>Person</th><th>Access</th><th>Manage</th></tr>
              {page.map((m, n) => (
                <tr key={m.id}>
                  <td className="sl num">{sl(n)}</td>
                  <td style={{ whiteSpace: 'normal' }}>
                    <span className="who-cell">
                      <Avatar name={m.name} size={34} />
                      <span>
                        <span className="cell-t">{m.name}{m.you && <> <Pill tone="dim">You</Pill></>}</span>
                        <span className="cell-m" style={{ display: 'block' }}>{m.email}{m.title && <> · {m.title}</>} · added {day(m.since)}</span>
                      </span>
                    </span>
                  </td>
                  <td data-l="Access" style={{ whiteSpace: 'normal', maxWidth: 300 }}>
                    {m.access === 'full' ? <Pill tone="good">Full access</Pill> : m.access === 'role' ? <Pill tone="warn">{ROLE_NAME[m.role] ?? m.role}</Pill> : <Pill tone="acc">{m.permissions.length} section{m.permissions.length === 1 ? '' : 's'}</Pill>}
                    <span className="cell-m" style={{ display: 'block', marginTop: 4 }}>{accessLine(m, sections)}</span>
                  </td>
                  <td data-l="Manage">
                    <span style={{ display: 'flex', gap: 6 }}>
                      <IconBtn icon={PencilSimple} label="Edit details and access" onClick={() => startEdit(m)} />
                      <IconBtn icon={Key} label="Set a new password" onClick={() => resetPassword(m)} />
                      {!m.you && <IconBtn icon={Trash} label="Remove from the team" tone="danger" onClick={() => remove(m)} />}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {team && !list.length && <Empty icon={UsersThree} title="Nobody on the team yet" body="Add the first person on the right." />}
        </div>)}</TableCard>

        <div className="panel">
          <PanelHead icon={editing ? PencilSimple : UserPlus} title={editing ? 'Edit ' + editing.name : 'Add a team member'} sub={editing ? 'Changes to access apply straight away' : 'They sign in to this console with the email and password you set'} />
          <div className="form-grid">
            <label className="fld">Full name<input className="a-in" value={form.name} maxLength={80} onChange={e => set({ name: e.target.value })} placeholder="e.g. Meera Nair" /></label>
            <label className="fld">Title<input className="a-in" value={form.title} maxLength={60} onChange={e => set({ title: e.target.value })} placeholder="e.g. Accountant, Front desk" /></label>
            <label className="fld">Email (their sign-in)<input className="a-in" type="email" value={form.email} disabled={!!editing} onChange={e => set({ email: e.target.value })} placeholder="name@society.in" autoComplete="off" /></label>
            {!editing && <label className="fld">Password<input className="a-in" type="text" value={form.password} maxLength={100} onChange={e => set({ password: e.target.value })} placeholder="At least 8 characters" autoComplete="off" /></label>}
          </div>

          <div className="lbl" style={{ margin: '16px 0 8px' }}>Access</div>
          {lockedSelf && <div className="flow-note" style={{ marginBottom: 10 }}>You can’t change your own access — another admin with full access has to do it.</div>}
          <div className="pick" style={{ maxHeight: 'none', marginTop: 0 }}>
            <label><input type="radio" name="access" checked={form.full} disabled={lockedSelf} onChange={() => set({ full: true })} /> <b>Full access (admin)</b> — everything, including this page</label>
            <label><input type="radio" name="access" checked={!form.full} disabled={lockedSelf} onChange={() => set({ full: false })} /> <b>Limited</b> — only the sections ticked below</label>
          </div>

          {!form.full && (
            <div className="perm">
              {groups.map(g => {
                const keys = sections.filter(s => s.group === g).map(s => s.key), all = keys.every(k => form.permissions.includes(k));
                return (
                  <div key={g} className="perm-grp">
                    <div className="perm-h"><span>{g}</span><button type="button" className="a-btn ghost xs" disabled={lockedSelf} onClick={() => toggle(keys, !all)}>{all ? 'Clear' : 'Select all'}</button></div>
                    <div className="pick" style={{ maxHeight: 'none', marginTop: 0 }}>
                      {sections.filter(s => s.group === g).map(s => (
                        <label key={s.key}><input type="checkbox" disabled={lockedSelf} checked={form.permissions.includes(s.key)} onChange={e => toggle([s.key], e.target.checked)} /> {s.name}</label>
                      ))}
                    </div>
                  </div>
                );
              })}
              <div className="flow-note">The dashboard and Help &amp; support are open to everyone on the team. The dashboard only shows figures from the sections a person has.</div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
            <button className="a-btn" onClick={save} disabled={!ready || busy}>{editing ? 'Save changes' : <><UserPlus size={14} />Add to the team</>}</button>
            {editing && <button className="a-btn ghost" onClick={clear}>Cancel</button>}
          </div>
          {!editing && <div className="flow-note">The password is not emailed. Share it with them yourself; they can change it after signing in.</div>}
        </div>
      </div>
    </>
  );
}
