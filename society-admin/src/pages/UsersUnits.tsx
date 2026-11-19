import { confirmBox, promptBox } from '../lib/dialog';
import { ArrowLeft, ArrowRight, ArrowsDownUp, Buildings, House, IdentificationCard, Phone, Prohibit, SealCheck, ShieldWarning, Ticket, Trash, UserCheck, UserMinus, UserPlus, UsersThree, ArrowCounterClockwise, ClockCountdown } from '@phosphor-icons/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { AddFlats } from '../components/AddFlats';
import { TableCard } from '../components/TableCard';
import { useToast } from '../components/toast-context';
import { Avatar, Drawer, Empty, Facts, IconTile, PageHead, Pill, Stat, IconBtn } from '../components/ui';
import { ApiError, LIVE } from '../lib/api';
import { statusTone, userTone } from '../lib/format';
import { addResidentLive, deleteResidentLive, flatsLive, membersLive, removeFlatLive, removeResidentLive, saveTowerOrderLive, towerOrderLive, verifyMemberLive, type Flat, type Member } from '../lib/live';
import { useStore } from '../store/context';
import { useSociety } from '../lib/access';
import { isOpen, type User } from '../store/data';

/* Everyone who lives here and every flat they live in. The list of residents carries each person's
   standing; the list of flats carries who is in it and how it is occupied. Either opens a side panel
   with the full record: household, phone numbers, the issues raised and any moderation history. */

type Person = { key: string; name: string; unit: string; phone: string | null; role: 'Owner' | 'Tenant' | 'Family'; status: User['status']; warns: number; pending: boolean; memberId?: string; userId?: string };
/* Two pages share this file because they share the records and the side panels:
     Residents — the people, divided by how they live here (owners, tenants, family) and those awaiting verification;
     Flats & units — the towers and flats, where flats are added and residents registered. */
type View = 'residents' | 'flats';
type Tab = 'all' | 'Owner' | 'Tenant' | 'Family' | 'pending';
const OCC_TONE = { 'Owner-occupied': 'acc', Rented: 'good', Vacant: 'warn' } as const;
const OCC_COLOR = { 'Owner-occupied': 'var(--acc)', Rented: 'var(--good)', Vacant: '#F59E0B' } as const;
const OCCUPANCIES = ['Owner-occupied', 'Rented', 'Vacant'] as const;
const rupees = (n: number) => '₹' + n.toLocaleString('en-IN');
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const towerOf = (code: string) => { const m = /^T(\d+)/i.exec(code); return m ? 'Tower ' + m[1] : 'Other'; };
const byTower = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

export function UsersUnits({ view }: { view: View }) {
  const { state, actions } = useStore();
  const toast = useToast();
  const nav = useNavigate();
  const SOCIETY = { name: useSociety().name || 'your society' };
  const [tab, setTab] = useState<Tab>('all');
  const shown = view === 'flats' ? 'flats' : tab === 'pending' ? 'pending' : 'residents';
  const [liveFlats, setLiveFlats] = useState<Flat[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [tower, setTower] = useState('');
  /** the order the office put its towers in, and whether it is being rearranged just now */
  const [order, setOrder] = useState<string[]>([]);
  const [arranging, setArranging] = useState(false);
  const [personKey, setPersonKey] = useState<string | null>(null);
  const [flatCode, setFlatCode] = useState<string | null>(null);

  const fail = useCallback((e: unknown) => toast(e instanceof ApiError ? e.message : 'That didn’t go through.', undefined, 'warn'), [toast]);
  const load = useCallback(() => {
    if (!LIVE) return;
    flatsLive().then(setLiveFlats).catch(fail);
    towerOrderLive().then(setOrder).catch(() => {});
    membersLive().then(setMembers).catch(fail);
  }, [fail]);
  useEffect(load, [load]);

  /* residents: the server's member list when connected (it has pending members and family); the demo list otherwise.
     Standing always comes from the store, which is re-read after every change. */
  const people = useMemo<Person[]>(() => {
    if (!LIVE) return state.users.map(u => ({ key: u.n + '|' + u.unit, name: u.n, unit: u.unit, phone: null, role: u.role, status: u.status, warns: u.warns, pending: false }));
    return members.map(m => {
      const cur = state.users.find(u => u.n === m.name && u.unit === m.unit);
      const phone = liveFlats.find(f => f.code === m.unit)?.members.find(x => x.name === m.name)?.phone ?? null;
      return { key: m.memberId, name: m.name, unit: m.unit, phone, role: m.role, status: cur?.status ?? m.status, warns: cur?.warns ?? m.warnings, pending: m.memberStatus === 'pending', memberId: m.memberId, userId: m.userId };
    });
  }, [members, liveFlats, state.users]);

  /* flats: from the server when connected; in the demo, the flats the demo residents live in */
  const flats = useMemo<Flat[]>(() => {
    if (LIVE) return liveFlats;
    const codes = [...new Set(state.users.map(u => u.unit))].sort();
    return codes.map(code => {
      const inFlat = state.users.filter(u => u.unit === code);
      return { id: code, code, tower: towerOf(code), label: `${towerOf(code)}, Flat ${code.split('-')[1] ?? code}`, area: 0, flatType: '', occupancy: inFlat.some(u => u.role === 'Tenant') ? 'Rented' as const : 'Owner-occupied' as const, monthlyRent: 0, leaseEnd: null,
        members: inFlat.map(u => ({ memberId: u.n, name: u.n, phone: null, role: u.role, status: 'active' as const })) };
    });
  }, [liveFlats, state.users]);

  const active = people.filter(p => !p.pending);
  const pending = people.filter(p => p.pending);
  const count = (s: User['status']) => active.filter(p => p.status === s).length;
  const named = [...new Set(flats.map(f => f.tower))];
  // arranged towers first, in their order; one that has not been placed yet follows, by name
  const towers = [...order.filter(t => named.includes(t)), ...named.filter(t => !order.includes(t)).sort(byTower)];
  const moveTower = (t: string, by: -1 | 1) => {
    const i = towers.indexOf(t), j = i + by;
    if (i < 0 || j < 0 || j >= towers.length) return;
    const next = [...towers];
    [next[i], next[j]] = [next[j]!, next[i]!];
    const was = order;
    setOrder(next); // shown at once; put back if the server says no
    if (LIVE) saveTowerOrderLive(next).then(setOrder).catch(e => { setOrder(was); fail(e); });
  };
  const flatOf = (code: string) => flats.find(f => f.code === code);
  const issuesOn = (code: string) => state.issues.filter(i => i.unit === code);
  const shownFlats = tower ? flats.filter(f => f.tower === tower) : flats;

  const person = people.find(p => p.key === personKey);
  const flat = flatCode ? flatOf(flatCode) : undefined;
  const closePerson = useCallback(() => setPersonKey(null), []);
  const closeFlat = useCallback(() => setFlatCode(null), []);
  const openFlat = (code: string) => { setPersonKey(null); setFlatCode(code); };
  const openPerson = (name: string, unit: string) => { const p = people.find(x => x.name === name && x.unit === unit); if (p) { setFlatCode(null); setPersonKey(p.key); } };
  const goIssue = (id: string) => nav(`/issues?open=${id}`);

  /* registering a resident in the open flat */
  const [reg, setReg] = useState({ name: '', phone: '', role: 'Owner' as 'Owner' | 'Tenant' | 'Family' });
  const [saving, setSaving] = useState(false);
  /** the Residents page's own "Register a resident" panel, and the flat picked in it */
  const [regOpen, setRegOpen] = useState(false);
  const [regFlat, setRegFlat] = useState('');
  const closeReg = useCallback(() => setRegOpen(false), []);
  const regOk = reg.name.trim().length >= 2 && /^[6-9]\d{9}$/.test(reg.phone);
  const register = (f: Flat) => {
    if (!regOk || saving) return;
    setSaving(true);
    addResidentLive(f.id, { name: reg.name.trim(), phone: reg.phone, role: reg.role })
      .then(() => { toast(`${reg.name.trim()} registered in ${f.code}`, `They can sign in on the app with +91 ${reg.phone}.`); setReg({ name: '', phone: '', role: 'Family' }); setRegOpen(false); load(); actions.refresh(); })
      .catch(fail).finally(() => setSaving(false));
  };
  const removeResident = async (f: Flat, m: Flat['members'][number]) => {
    if (!(await confirmBox(`Remove ${m.name} from ${f.code}? They are signed out and can no longer open this flat in the app.`))) return;
    removeResidentLive(f.id, m.memberId).then(() => { toast(`${m.name} removed from ${f.code}`); load(); actions.refresh(); }).catch(fail);
  };

  const block = async (p: Person) => {
    if ((await confirmBox(`Block ${p.name}? They are signed out and cannot use the app at all until you unblock them. Their flat, bills and records stay as they are.`))) actions.blockUser(p.name);
  };
  /** no undo, so the admin types the resident's name before anything is erased */
  const deleteForever = async (p: Person) => {
    if (!p.userId) return;
    const typed = await promptBox(`Delete ${p.name} permanently?`, '', {
      body: `Their account, sign-in, posts, comments and chat history are erased and they are removed from ${p.unit}. Issues they raised are kept without their name. This cannot be undone.`,
      hint: `Type “${p.name}” to confirm.`, placeholder: p.name, match: p.name, danger: true, confirm: 'Delete permanently',
    });
    if (typed === null) return;
    deleteResidentLive(p.userId).then(() => { toast(`${p.name} deleted permanently`, 'Account erased · audit entry written'); setPersonKey(null); load(); actions.refresh(); }).catch(fail);
  };

  const roleN = (r: 'Owner' | 'Tenant' | 'Family') => active.filter(p => p.role === r).length;
  const listed = tab === 'all' || tab === 'pending' ? active : active.filter(p => p.role === tab);

  const removeFlat = async (f: Flat) => {
    if (!(await confirmBox(`Remove ${f.code}? Use this only for a flat added by mistake.`))) return;
    removeFlatLive(f.id).then(() => { toast(f.code + ' removed'); setFlatCode(null); load(); }).catch(fail);
  };
  const verify = (p: Person) => {
    if (!p.memberId) return;
    verifyMemberLive(p.memberId).then(() => { toast(p.name + ' verified', `They can now sign in to the app for ${p.unit}.`); load(); actions.refresh(); }).catch(fail);
  };

  return (
    <>
      {view === 'flats' ? (
        <>
          <PageHead title="Flats & units" sub={`Every tower and flat in ${SOCIETY.name}. Open a flat to see who lives there and to register its owner, tenant or family. Add new flats at the bottom of the page.`} />
          <div className="stats">
            <Stat icon={Buildings} label="Flats" value={flats.length} />
            <Stat icon={House} label="Owner-occupied" value={flats.filter(f => f.occupancy === 'Owner-occupied').length} tone="good" />
            <Stat icon={House} label="Rented" value={flats.filter(f => f.occupancy === 'Rented').length} />
            <Stat icon={House} label="Vacant" value={flats.filter(f => f.occupancy === 'Vacant').length} tone={flats.some(f => f.occupancy === 'Vacant') ? 'warn' : undefined} />
            <Stat icon={UsersThree} label="No one registered" value={flats.filter(f => !f.members.length).length} tone={flats.some(f => !f.members.length) ? 'warn' : undefined} />
          </div>
        </>
      ) : (
        <>
          <PageHead title="Residents" actions={LIVE ? <button className="a-btn" onClick={() => { setRegFlat(''); setReg({ name: '', phone: '', role: tab === 'Tenant' || tab === 'Family' ? tab : 'Owner' }); setRegOpen(true); }}><UserPlus size={15} />Register a resident</button> : undefined} sub={`Everyone who lives in ${SOCIETY.name}, divided by how they live here. Open a resident for the full record. Restrictions remove posting only; suspensions block posting and social actions; a block closes the whole app to them. Console staff are under Team & access.`} />
          <div className="stats">
            <Stat icon={UsersThree} label="Residents" value={active.length} />
            <Stat icon={House} label="Owners" value={roleN('Owner')} tone="good" />
            <Stat icon={House} label="Tenants" value={roleN('Tenant')} />
            <Stat icon={UsersThree} label="Family" value={roleN('Family')} />
            <Stat icon={SealCheck} label="Awaiting verification" value={pending.length} tone={pending.length ? 'warn' : undefined} />
            <Stat icon={Prohibit} label="Warned, restricted or blocked" value={count('Warned') + count('Restricted') + count('Suspended') + count('Blocked')} tone={count('Warned') + count('Restricted') + count('Suspended') + count('Blocked') ? 'bad' : undefined} />
          </div>
        </>
      )}

      {view === 'residents' && (
        <div className="filters">
          {([['all', `All · ${active.length}`], ['Owner', `Owners · ${roleN('Owner')}`], ['Tenant', `Tenants · ${roleN('Tenant')}`], ['Family', `Family · ${roleN('Family')}`], ['pending', `Awaiting verification · ${pending.length}`]] as [Tab, string][]).map(([k, l]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
      )}

      {shown === 'residents' && (
        <TableCard key={tab} rows={listed} noun={tab === 'all' ? 'resident' : tab.toLowerCase()} search={p => [p.name, p.unit, p.phone, p.role]} placeholder="Search by name, flat or phone"
          filters={[{ key: 'tower', label: 'Tower', get: p => flatOf(p.unit)?.tower ?? towerOf(p.unit) }, { key: 'status', label: 'Standing', get: p => p.status, options: ['Active', 'Warned', 'Restricted', 'Suspended', 'Blocked'] }]}
          sorts={[{ label: 'Name', by: p => p.name.toLowerCase() }, { label: 'Flat', by: p => p.unit }, { label: 'Most warnings', by: p => p.warns, dir: 'desc' }]}
          csv={{ name: 'residents', head: ['Resident', 'Flat', 'Tower', 'Phone', 'Role', 'Warnings', 'Standing'], row: p => [p.name, p.unit, flatOf(p.unit)?.tower ?? towerOf(p.unit), p.phone ?? '', p.role, p.warns, p.status] }}>{(page, sl) => (<div className="a-tbl-wrap">
          <table className="a-tbl">
            <tbody>
              <tr><th className="sl">Sl. no.</th><th>Resident</th><th>Flat</th><th>Role</th><th>Issues raised</th><th>Warnings</th><th>Standing</th><th /></tr>
              {page.map((p, rowNo) => {
                const blocked = p.status === 'Blocked';
                const limited = p.status === 'Restricted' || p.status === 'Suspended';
                const raised = state.issues.filter(i => i.by === p.name);
                return (
                  <tr key={p.key} className="rowbtn" tabIndex={0} onClick={() => setPersonKey(p.key)} onKeyDown={e => { if (e.key === 'Enter') setPersonKey(p.key); }}>
                    <td className="sl num">{sl(rowNo)}</td>
                    <td><span className="who-cell"><Avatar name={p.name} size={32} /><span><span className="cell-t">{p.name}</span><small className="num">{p.phone ? '+91 ' + p.phone : 'No phone on record'}</small></span></span></td>
                    <td data-l="Flat"><span className="num" style={{ color: 'var(--ink)', fontWeight: 600 }}>{p.unit}</span><div className="cell-m">{flatOf(p.unit)?.tower ?? towerOf(p.unit)}{flatOf(p.unit)?.flatType ? ' · ' + flatOf(p.unit)!.flatType : ''}</div></td>
                    <td data-l="Role"><Pill tone={p.role === 'Owner' ? 'acc' : 'dim'}>{p.role}</Pill></td>
                    <td data-l="Issues raised" className="num">{raised.length ? <>{raised.length} <span className="cell-m" style={{ display: 'inline' }}>· {raised.filter(isOpen).length} open</span></> : '—'}</td>
                    <td data-l="Warnings" className="num">{p.warns > 0 ? <b style={{ color: 'var(--warn)' }}>{p.warns}</b> : 0}</td>
                    <td data-l="Standing"><Pill tone={userTone(p.status)} dot>{p.status}</Pill></td>
                    <td data-l="" style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                      <span style={{ display: 'inline-flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                        {blocked
                          ? <IconBtn icon={ArrowCounterClockwise} label="Unblock" tone="good" onClick={() => actions.reactivateUser(p.name)} />
                          : <>
                            {limited
                              ? <IconBtn icon={ArrowCounterClockwise} label="Reactivate" tone="good" onClick={() => actions.reactivateUser(p.name)} />
                              : <IconBtn icon={ClockCountdown} label="Restrict 24h" onClick={() => actions.restrictUser(p.name)} />}
                            <IconBtn icon={Prohibit} label="Block" tone="danger" onClick={() => block(p)} />
                          </>}
                        {LIVE && p.userId && <IconBtn icon={Trash} label="Delete permanently" tone="danger" onClick={() => deleteForever(p)} />}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!listed.length && <Empty icon={UserMinus} title={tab === 'all' ? 'No residents yet' : `No ${tab === 'Family' ? 'family members' : tab.toLowerCase() + 's'} yet`} body="Use Register a resident, at the top of this page." />}
        </div>)}</TableCard>
      )}

      {shown === 'flats' && (
        <>
          {towers.length > 1 && (
            <div className="tower-bar">
              <span>{arranging ? 'Use the arrows to move a tower. The order is saved as you go.' : `${towers.length} towers and blocks`}</span>
              <button className={'a-btn sm' + (arranging ? '' : ' ghost')} onClick={() => setArranging(a => !a)}><ArrowsDownUp size={14} />{arranging ? 'Done' : 'Arrange'}</button>
            </div>
          )}
          <div className="towers">
            {towers.map((t, at) => {
              const inTower = flats.filter(f => f.tower === t);
              const n = (o: Flat['occupancy']) => inTower.filter(f => f.occupancy === o).length;
              if (arranging) return (
                <div key={t} className="tower arranging">
                  <div className="tower-h"><span className="tower-no num">{at + 1}</span><div><b>{t}</b><span className="num">{inTower.length} flat{inTower.length === 1 ? '' : 's'}</span></div></div>
                  <div className="tower-move">
                    <IconBtn icon={ArrowLeft} label={`Move ${t} earlier`} disabled={at === 0} onClick={() => moveTower(t, -1)} />
                    <IconBtn icon={ArrowRight} label={`Move ${t} later`} disabled={at === towers.length - 1} onClick={() => moveTower(t, 1)} />
                  </div>
                </div>
              );
              return (
                <button key={t} className={'tower' + (tower === t ? ' on' : '')} onClick={() => setTower(tower === t ? '' : t)} aria-pressed={tower === t}>
                  <div className="tower-h"><IconTile icon={Buildings} /><div><b>{t}</b><span className="num">{inTower.length} flat{inTower.length === 1 ? '' : 's'} · {inTower.reduce((a, f) => a + f.members.filter(m => m.status === 'active').length, 0)} on the app</span></div></div>
                  <div className="occbar">{OCCUPANCIES.filter(o => n(o) > 0).map(o => <i key={o} style={{ flex: n(o), background: OCC_COLOR[o] }} />)}</div>
                  <div className="occleg num">{OCCUPANCIES.map(o => <span key={o}><i style={{ background: OCC_COLOR[o] }} />{n(o)} {o === 'Owner-occupied' ? 'owner' : o.toLowerCase()}</span>)}</div>
                </button>
              );
            })}
          </div>
          <TableCard key={tower} rows={shownFlats} noun="flat" search={f => [f.code, f.tower, f.flatType, ...f.members.map(m => m.name)]} placeholder={tower ? `Search flats in ${tower}` : 'Search by flat number or resident'}
            filters={[{ key: 'occ', label: 'Occupied by', get: f => f.occupancy, options: [...OCCUPANCIES] }, { key: 'type', label: 'Type', get: f => f.flatType }]}
            sorts={[{ label: 'Flat', by: f => f.code }, { label: 'Most residents', by: f => f.members.length, dir: 'desc' }, { label: 'Largest area', by: f => f.area, dir: 'desc' }]}
            csv={{ name: 'flats', head: ['Flat', 'Tower', 'Type', 'Area (sq ft)', 'Occupied by', 'Residents', 'Monthly rent', 'Lease ends'], row: f => [f.code, f.tower, f.flatType, f.area || '', f.occupancy, f.members.map(m => `${m.name} (${m.role})`).join('; '), f.monthlyRent || '', f.leaseEnd ?? ''] }}>{(page, sl) => (<div className="a-tbl-wrap">
            <table className="a-tbl">
              <tbody>
                <tr><th className="sl">Sl. no.</th><th>Flat</th><th>Type</th><th>Occupied by</th><th>Residents</th><th>Open issues</th><th /></tr>
                {page.map((f, rowNo) => {
                  const open = issuesOn(f.code).filter(isOpen).length;
                  return (
                    <tr key={f.id} className="rowbtn" tabIndex={0} onClick={() => setFlatCode(f.code)} onKeyDown={e => { if (e.key === 'Enter') setFlatCode(f.code); }}>
                      <td className="sl num">{sl(rowNo)}</td>
                      <td><span className="who-cell"><IconTile icon={House} tone={f.occupancy === 'Vacant' ? 'warn' : 'acc'} /><span><span className="cell-t num">{f.code}</span><small>{f.label}</small></span></span></td>
                      <td data-l="Type">{f.flatType || '—'}{f.area > 0 && <div className="cell-m num">{f.area.toLocaleString('en-IN')} sq ft</div>}</td>
                      <td data-l="Occupied by"><Pill tone={OCC_TONE[f.occupancy]}>{f.occupancy}</Pill>{f.occupancy === 'Rented' && f.leaseEnd && <div className="cell-m">lease to {day(f.leaseEnd)}</div>}</td>
                      <td data-l="Residents">
                        {f.members.length
                          ? <span className="people">{f.members.slice(0, 4).map(m => <Avatar key={m.name} name={m.name} size={26} />)}<small>{f.members[0].name}{f.members.length > 1 ? ` +${f.members.length - 1}` : ''}</small></span>
                          : <span className="cell-m">Nobody on the app</span>}
                      </td>
                      <td data-l="Open issues" className="num">{open ? <b style={{ color: 'var(--warn)' }}>{open}</b> : '—'}</td>
                      <td data-l="" style={{ textAlign: 'right' }}><ArrowRight size={14} color="var(--ink3)" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!flats.length && <Empty icon={Buildings} title="No flats yet" body={LIVE ? 'Add the society’s flats or plots below — a whole tower at a time.' : 'Flats appear here once residents are added.'} />}
          </div>)}</TableCard>
          {LIVE && <AddFlats existing={flats.map(f => f.code)} onAdded={() => { load(); actions.refresh(); }} />}
        </>
      )}

      {shown === 'pending' && (pending.length ? (
        <div className="a-tbl-wrap">
          <table className="a-tbl">
            <tbody>
              <tr><th>Person</th><th>Flat</th><th>Added as</th><th /></tr>
              {pending.map(p => (
                <tr key={p.key}>
                  <td><span className="who-cell"><Avatar name={p.name} size={32} /><span><span className="cell-t">{p.name}</span><small className="num">{p.phone ? '+91 ' + p.phone : 'No phone on record'}</small></span></span></td>
                  <td data-l="Flat" className="num">{p.unit}<div className="cell-m">{flatOf(p.unit)?.members.filter(m => m.status === 'active' && m.role === 'Owner').map(m => m.name).join(', ') || 'No owner on the app'}</div></td>
                  <td data-l="Added as"><Pill tone="dim">{p.role}</Pill></td>
                  <td data-l="" style={{ textAlign: 'right' }}><IconBtn icon={SealCheck} label="Verify" tone="good" primary onClick={() => verify(p)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <div className="panel"><Empty icon={UserCheck} title="Nobody is waiting" body="When an owner adds a family member or tenant, they appear here until the office verifies them." /></div>)}

      {person && (() => {
        const f = flatOf(person.unit);
        const household = (f?.members ?? []).filter(m => m.name !== person.name);
        const raised = state.issues.filter(i => i.by === person.name);
        const flags = state.modqueue.filter(m => m.state === 'open' && m.by === person.name);
        const decided = state.resolvedMods.filter(m => m.by === person.name);
        const limited = person.status === 'Restricted' || person.status === 'Suspended' || person.status === 'Blocked';
        return (
          <Drawer label={person.name} onClose={closePerson}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', paddingRight: 30 }}>
              <Avatar name={person.name} size={54} />
              <div>
                <h2 style={{ margin: 0, padding: 0 }}>{person.name}</h2>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 5 }}>
                  <Pill tone={person.role === 'Owner' ? 'acc' : 'dim'}>{person.role}</Pill>
                  <Pill tone={userTone(person.status)} dot>{person.status}</Pill>
                  {person.pending && <Pill tone="warn">Awaiting verification</Pill>}
                </div>
              </div>
            </div>
            <Facts items={{
              Flat: <button className="num" style={{ color: 'var(--acc-ink)', fontWeight: 700 }} onClick={() => openFlat(person.unit)}>{person.unit}</button>,
              Tower: f?.tower ?? towerOf(person.unit),
              Phone: person.phone ? <span className="num">+91 {person.phone}</span> : 'Not on record',
              'Flat type': f?.flatType ? `${f.flatType}${f.area ? ` · ${f.area.toLocaleString('en-IN')} sq ft` : ''}` : '—',
              Warnings: <span className="num" style={person.warns ? { color: 'var(--warn)' } : undefined}>{person.warns}</span>,
              'Issues raised': <span className="num">{raised.length} · {raised.filter(isOpen).length} open</span>,
            }} />

            <h3 className="d-h"><UsersThree size={17} />Household</h3>
            {household.length ? (
              <ul className="mini">{household.map(m => (
                <li key={m.name}><button className="m-go" onClick={() => openPerson(m.name, person.unit)}><Avatar name={m.name} size={28} /><span className="m-t"><b>{m.name}</b><span className="num">{m.phone ? '+91 ' + m.phone : 'No phone on record'}</span></span></button>
                  <Pill tone={m.status === 'pending' ? 'warn' : 'dim'}>{m.status === 'pending' ? 'Pending' : m.role}</Pill></li>
              ))}</ul>
            ) : <div className="d-none">Nobody else is registered in this flat.</div>}

            <h3 className="d-h"><Ticket size={17} />Issues raised</h3>
            {raised.length ? (
              <ul className="mini">{raised.map(i => (
                <li key={i.id}><button className="m-go" onClick={() => goIssue(i.id)}><span className="m-t"><b>{i.title}</b><span className="num">{i.id} · {i.cat} · {i.when}</span></span></button><Pill tone={statusTone(i.status)} dot>{i.status}</Pill></li>
              ))}</ul>
            ) : <div className="d-none">No issues raised.</div>}

            <h3 className="d-h"><ShieldWarning size={17} />Moderation history</h3>
            {flags.length + decided.length ? (
              <ul className="mini">
                {flags.map(m => <li key={m.id}><button className="m-go" onClick={() => nav('/moderation')}><span className="m-t"><b>{m.cat} · {m.kind}</b><span>{m.id} · {m.when} · waiting for review</span></span></button><Pill tone="warn">Open</Pill></li>)}
                {decided.map(m => <li key={m.id}><span className="m-t"><b>{m.text}</b><span>{m.id} · {m.when}</span></span><Pill tone="dim">{m.action}</Pill></li>)}
              </ul>
            ) : <div className="d-none">Nothing has been flagged.</div>}

            <h3 className="d-h"><IdentificationCard size={17} />Standing</h3>
            <div className="d-actions">
              {LIVE && f && person.memberId && <button className="a-btn ghost" style={{ color: 'var(--bad)' }} onClick={() => { const m = f.members.find(x => x.memberId === person.memberId); if (m) { removeResident(f, m); closePerson(); } }}><UserMinus size={14} />Remove from {person.unit}</button>}
              {person.pending && <button className="a-btn" onClick={() => { verify(person); closePerson(); }}><SealCheck size={14} />Verify member</button>}
              {limited
                ? <button className="a-btn" onClick={() => actions.reactivateUser(person.name)}>{person.status === 'Blocked' ? 'Unblock' : 'Reactivate'}</button>
                : <>
                  <button className="a-btn ghost" onClick={() => actions.restrictUser(person.name)}>Restrict posting for 24h</button>
                  <button className="a-btn ghost" style={{ color: 'var(--bad)' }} onClick={async () => { if ((await confirmBox(`Suspend ${person.name}? They will not be able to post, comment, vote or RSVP until reactivated.`))) actions.suspendUser(person.name); }}>Suspend</button>
                </>}
              {person.status !== 'Blocked' && <button className="a-btn ghost" style={{ color: 'var(--bad)' }} onClick={() => block(person)}><Prohibit size={14} />Block from the app</button>}
              {LIVE && person.userId && <button className="a-btn ghost" style={{ color: 'var(--bad)' }} onClick={() => deleteForever(person)}><Trash size={14} />Delete permanently</button>}
            </div>
            <div className="flow-note">Every change of standing is written to the audit log. A restriction removes posting only; a suspension also blocks comments, votes and RSVPs. A block signs them out and closes the whole app to them until you unblock. Deleting erases the account for good.</div>
          </Drawer>
        );
      })()}

      {regOpen && (() => {
        const target = flatOf(regFlat.trim().toUpperCase());
        return (
          <Drawer label="Register a resident" onClose={closeReg}>
            <h2>Register a resident</h2>
            <div style={{ fontSize: 12.5, color: 'var(--ink3)' }}>Add an owner, tenant or family member to a flat. They sign in on the resident app with this mobile number and a one-time code — no approval step is needed, because the office is adding them.</div>
            <div className="reg" style={{ marginTop: 14 }}>
              <div className="form-grid">
                <label className="fld full">Flat
                  <input className="a-in num" list="reg-flats" value={regFlat} onChange={e => setRegFlat(e.target.value)} placeholder="Type or pick a flat, e.g. T4-1108" autoFocus />
                  <datalist id="reg-flats">{flats.map(x => <option key={x.id} value={x.code}>{x.tower}{x.members.length ? ` · ${x.members.length} registered` : ' · nobody registered'}</option>)}</datalist>
                </label>
                <label className="fld full">Full name<input className="a-in" value={reg.name} maxLength={80} onChange={e => setReg(r => ({ ...r, name: e.target.value }))} placeholder="e.g. Anita Sharma" /></label>
                <label className="fld">Mobile number<input className="a-in num" inputMode="numeric" value={reg.phone} onChange={e => setReg(r => ({ ...r, phone: e.target.value.replace(/\D/g, '').slice(0, 10) }))} placeholder="10-digit number" /></label>
                <label className="fld">Lives here as<select className="a-in" value={reg.role} onChange={e => setReg(r => ({ ...r, role: e.target.value as typeof reg.role }))}><option>Owner</option><option>Tenant</option><option>Family</option></select></label>
              </div>
              {regFlat.trim() && !target && <div style={{ fontSize: 12, color: 'var(--bad)', marginTop: 8 }}>No flat with that number. Add it first under <b>Flats &amp; units</b>.</div>}
              {target && <div style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 8 }}>{target.label}{target.members.length ? ` · already here: ${target.members.map(m => m.name).join(', ')}` : ' · nobody registered yet'}</div>}
              <button className="a-btn" style={{ marginTop: 12 }} disabled={!target || !regOk || saving} onClick={() => target && register(target)}><UserPlus size={14} />{target ? `Register in ${target.code}` : 'Register'}</button>
            </div>
            <div className="flow-note">One mobile number can belong to one flat only. To add many flats at once, use <b>Flats &amp; units</b>.</div>
          </Drawer>
        );
      })()}

      {flat && (() => {
        const onFlat = issuesOn(flat.code);
        return (
          <Drawer label={'Flat ' + flat.code} onClose={closeFlat}>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Pill tone={OCC_TONE[flat.occupancy]}>{flat.occupancy}</Pill>
              {flat.flatType && <Pill tone="dim">{flat.flatType}</Pill>}
            </div>
            <h2 className="num">{flat.code}</h2>
            <div style={{ fontSize: 12, color: 'var(--ink3)' }}>{flat.label}</div>
            <Facts items={{
              Tower: flat.tower,
              Area: flat.area ? <span className="num">{flat.area.toLocaleString('en-IN')} sq ft</span> : '—',
              Residents: <span className="num">{flat.members.filter(m => m.status === 'active').length}</span>,
              'Open issues': <span className="num">{onFlat.filter(isOpen).length} of {onFlat.length}</span>,
              ...(flat.occupancy === 'Rented' ? { 'Monthly rent': <span className="num">{flat.monthlyRent ? rupees(flat.monthlyRent) : '—'}</span>, 'Lease ends': day(flat.leaseEnd) } : {}),
            }} />

            <h3 className="d-h"><UsersThree size={17} />Who lives here</h3>
            {flat.members.length ? (
              <ul className="mini">{flat.members.map(m => (
                <li key={m.name}><button className="m-go" onClick={() => openPerson(m.name, flat.code)}><Avatar name={m.name} size={30} /><span className="m-t"><b>{m.name}</b><span className="num" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>{m.phone ? <><Phone size={12} />+91 {m.phone}</> : 'No phone on record'}</span></span></button>
                  <Pill tone={m.status === 'pending' ? 'warn' : m.role === 'Owner' ? 'acc' : 'dim'}>{m.status === 'pending' ? 'Pending' : m.role}</Pill>
                  {LIVE && <button className="a-btn ghost xs danger" onClick={() => removeResident(flat, m)} aria-label={`Remove ${m.name} from ${flat.code}`} title="Remove from this flat"><Trash size={13} /></button>}</li>
              ))}</ul>
            ) : <div className="d-none">Nobody is registered in this flat yet. Add the owner below — they can then sign in on the app.</div>}

            {LIVE && (
              <div className="reg">
                <div className="lbl">Register a resident in {flat.code}</div>
                <div className="form-grid">
                  <label className="fld">Full name<input className="a-in" value={reg.name} maxLength={80} onChange={e => setReg(r => ({ ...r, name: e.target.value }))} placeholder="e.g. Anita Sharma" /></label>
                  <label className="fld">Mobile number<input className="a-in num" inputMode="numeric" value={reg.phone} onChange={e => setReg(r => ({ ...r, phone: e.target.value.replace(/\D/g, '').slice(0, 10) }))} placeholder="10-digit number" /></label>
                  <label className="fld">Lives here as<select className="a-in" value={reg.role} onChange={e => setReg(r => ({ ...r, role: e.target.value as typeof reg.role }))}><option>Owner</option><option>Tenant</option><option>Family</option></select></label>
                </div>
                <button className="a-btn" style={{ marginTop: 10 }} disabled={!regOk || saving} onClick={() => register(flat)}><UsersThree size={14} />Register in {flat.code}</button>
                <div className="flow-note">They sign in on the resident app with this mobile number and a one-time code. No approval step is needed, because the office is adding them.</div>
              </div>
            )}

            <h3 className="d-h"><Ticket size={17} />Issues on this flat</h3>
            {onFlat.length ? (
              <ul className="mini">{onFlat.map(i => (
                <li key={i.id}><button className="m-go" onClick={() => goIssue(i.id)}><span className="m-t"><b>{i.title}</b><span className="num">{i.id} · {i.by} · {i.when}</span></span></button><Pill tone={statusTone(i.status)} dot>{i.status}</Pill></li>
              ))}</ul>
            ) : <div className="d-none">No issues have been raised from this flat.</div>}
            <div className="flow-note">Occupancy, rent and lease dates are changed from <b>Owners</b>. A new tenant is registered here, in this flat.</div>
            {LIVE && !flat.members.length && !onFlat.length && (
              <div className="d-actions" style={{ marginTop: 12 }}>
                <button className="a-btn ghost" style={{ color: 'var(--bad)' }} onClick={() => removeFlat(flat)}><Trash size={14} />Remove this flat</button>
              </div>
            )}
          </Drawer>
        );
      })()}
    </>
  );
}
