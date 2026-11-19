import { confirmBox } from '../lib/dialog';
import { AddressBook, ArrowDown, ArrowUp, DownloadSimple, type Icon as IconType, PencilSimple, Phone, Plus, Siren, Trash, UsersThree, Wrench } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';
import { useToast } from '../components/toast-context';
import { Avatar, Empty, PageHead, PanelHead, Stat } from '../components/ui';
import { ApiError, LIVE } from '../lib/api';
import { addContactLive, directoryLive, editContactLive, importVendorsLive, moveContactLive, removeContactLive, type DirContact, type DirGroup } from '../lib/live';

const GROUPS: { key: DirGroup; title: string; sub: string; icon: IconType; tone: 'acc' | 'bad' | 'good'; role: string; name: string }[] = [
  { key: 'committee', title: 'Managing committee', sub: 'Who residents can reach on the committee', icon: UsersThree, tone: 'acc', role: 'e.g. President, Secretary', name: 'e.g. Col. Vikram Nair' },
  { key: 'emergency', title: 'Emergency', sub: 'Also the numbers on the app’s Emergency screen — keep security first', icon: Siren, tone: 'bad', role: 'e.g. Main gate, 24×7', name: 'e.g. Security Office' },
  { key: 'vendors', title: 'Approved vendors', sub: 'Trusted services residents may call directly', icon: Wrench, tone: 'good', role: 'e.g. Plumbing · approved', name: 'e.g. Sunrise Plumbing Co.' },
];
const BLANK = { group: 'committee' as DirGroup, name: '', role: '', phone: '' };

/** The residents' Directory, kept by the office: the committee, the emergency numbers and the approved vendors. */
export function Directory() {
  const toast = useToast();
  const [list, setList] = useState<DirContact[] | null>(null);
  const [form, setForm] = useState(BLANK);
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fail = useCallback((e: unknown) => toast(e instanceof ApiError ? e.message : 'That didn’t go through. Please try again.', undefined, 'warn'), [toast]);
  const load = useCallback(() => { if (LIVE) directoryLive().then(setList).catch(fail); }, [fail]);
  useEffect(load, [load]);

  if (!LIVE) return (
    <>
      <PageHead title="Directory" sub="The contacts residents see in the app: the committee, emergency numbers and approved vendors." />
      <div className="panel"><Empty icon={AddressBook} title="Available when connected to the server" body="The demo console shows a built-in directory. Connect it to the Trinize API to manage your own." /></div>
    </>
  );

  const all = list ?? [];
  const editing = all.find(c => c.id === editId);
  const set = (patch: Partial<typeof BLANK>) => setForm(f => ({ ...f, ...patch }));
  const clear = (group: DirGroup = form.group) => { setForm({ ...BLANK, group }); setEditId(null); };
  const ok = form.name.trim().length >= 2 && /^[0-9+() -]{3,24}$/.test(form.phone.trim());
  const meta = GROUPS.find(g => g.key === form.group)!;

  const save = () => {
    const c = { name: form.name.trim(), role: form.role.trim(), phone: form.phone.trim() };
    setBusy(true);
    (editing ? editContactLive(editing.id, c) : addContactLive({ group: form.group, ...c }))
      .then(() => { toast(editing ? `${c.name} updated` : `${c.name} added to ${meta.title}`, 'Residents see it in the app’s Directory straight away.'); clear(); load(); })
      .catch(fail).finally(() => setBusy(false));
  };
  const startEdit = (c: DirContact) => { setEditId(c.id); setForm({ group: c.group, name: c.name, role: c.role, phone: c.phone }); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  const remove = async (c: DirContact) => {
    if (!(await confirmBox(`Remove ${c.name} from the Directory? Residents will no longer see this contact.`))) return;
    removeContactLive(c.id).then(() => { toast(`${c.name} removed`); if (editId === c.id) clear(); load(); }).catch(fail);
  };
  const move = (c: DirContact, dir: 'up' | 'down') => moveContactLive(c.id, dir).then(setList).catch(fail);
  const pullVendors = () => importVendorsLive().then(r => { setList(r.contacts); toast(r.added ? `${r.added} vendor${r.added === 1 ? '' : 's'} added` : 'Nothing new to add', r.added ? 'Copied from your Maintenance vendor list.' : 'Every active vendor with a phone number is already listed.'); }).catch(fail);

  const hasSecurity = all.some(c => c.group === 'emergency' && !/^1\d\d$/.test(c.phone.trim()));
  return (
    <>
      <PageHead title="Directory" sub="The contacts residents see in the app, and the numbers on its Emergency screen. Changes show for residents straight away." />
      <div className="stats">
        {GROUPS.map(g => <Stat key={g.key} icon={g.icon} label={g.title} value={all.filter(c => c.group === g.key).length} tone={g.key === 'emergency' && list && !hasSecurity ? 'warn' : undefined} />)}
      </div>
      {list && !hasSecurity && <div className="plan-strip"><Siren size={16} weight="fill" /><span><b>No security office number yet.</b> Only the public helplines are listed under Emergency. Add your security desk so residents can call it from the Emergency screen.</span></div>}

      <div className="panel" style={{ marginBottom: 14 }}>
        <PanelHead icon={editing ? PencilSimple : Plus} title={editing ? 'Edit ' + editing.name : 'Add a contact'} sub={editing ? 'Saved changes show in the app straight away' : 'Choose where it belongs, then fill in the name and number'} />
        <div className="form-grid">
          <label className="fld">Group<select className="a-in" value={form.group} disabled={!!editing} onChange={e => set({ group: e.target.value as DirGroup })}>{GROUPS.map(g => <option key={g.key} value={g.key}>{g.title}</option>)}</select></label>
          <label className="fld">Name<input className="a-in" value={form.name} maxLength={80} onChange={e => set({ name: e.target.value })} placeholder={meta.name} /></label>
          <label className="fld">Role or note<input className="a-in" value={form.role} maxLength={60} onChange={e => set({ role: e.target.value })} placeholder={meta.role} /></label>
          <label className="fld">Phone<input className="a-in num" value={form.phone} maxLength={24} onChange={e => set({ phone: e.target.value })} placeholder="+91 98450 12345" /></label>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="a-btn" disabled={!ok || busy} onClick={save}>{editing ? 'Save changes' : <><Plus size={14} />Add to the Directory</>}</button>
          {editing && <button className="a-btn ghost" onClick={() => clear()}>Cancel</button>}
        </div>
      </div>

      <div className="grid3">
        {GROUPS.map(g => {
          const rows = all.filter(c => c.group === g.key);
          return (
            <div key={g.key} className="panel">
              <PanelHead icon={g.icon} tone={g.tone} title={g.title} sub={g.sub} />
              {rows.length ? (
                <ul className="mini">{rows.map((c, i) => (
                  <li key={c.id} className="dir-row">
                    <Avatar name={c.name} size={30} />
                    <span className="m-t"><b>{c.name}</b><span style={{ display: 'block' }}>{c.role || '—'}</span><span className="num" style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}><Phone size={12} />{c.phone}</span></span>
                    <span className="dir-act">
                      <button className="a-btn ghost xs" disabled={i === 0} onClick={() => move(c, 'up')} aria-label={`Move ${c.name} up`} title="Move up"><ArrowUp size={13} /></button>
                      <button className="a-btn ghost xs" disabled={i === rows.length - 1} onClick={() => move(c, 'down')} aria-label={`Move ${c.name} down`} title="Move down"><ArrowDown size={13} /></button>
                      <button className="a-btn ghost xs" onClick={() => startEdit(c)} aria-label={`Edit ${c.name}`} title="Edit"><PencilSimple size={13} /></button>
                      <button className="a-btn ghost xs danger" onClick={() => remove(c)} aria-label={`Remove ${c.name}`} title="Remove"><Trash size={13} /></button>
                    </span>
                  </li>
                ))}</ul>
              ) : <div className="d-none">{list ? 'Nobody listed yet.' : 'Loading…'}</div>}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                <button className="a-btn soft sm" onClick={() => { clear(g.key); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><Plus size={13} />Add</button>
                {g.key === 'vendors' && <button className="a-btn ghost sm" onClick={pullVendors} title="Copy the active vendors from Maintenance that are not listed yet"><DownloadSimple size={13} />Add from Maintenance vendors</button>}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
