import { Buildings, Plus } from '@phosphor-icons/react';
import { useState, type FormEvent } from 'react';
import { ApiError } from '../lib/api';
import { addFlatsLive, type NewFlat } from '../lib/live';
import { useToast } from './toast-context';
import { PanelHead } from './ui';

/* Setting up the society's homes: a whole tower floor by floor, a run of numbered plots, or one flat.
   The list is worked out here and shown before it is sent; a number the society already has is skipped. */

type Mode = 'tower' | 'plots' | 'one';
const OCCUPANCIES: NewFlat['occupancy'][] = ['Vacant', 'Owner-occupied', 'Rented'];
const TYPES = ['', '1BHK', '2BHK', '3BHK', '4BHK', 'Studio', 'Villa', 'Plot', 'Shop'];
const MAX = 2000;
const int = (v: string) => Number(v.replace(/\D/g, '')) || 0;

export function AddFlats({ existing, onAdded }: { existing: string[]; onAdded: () => void }) {
  const toast = useToast();
  const [mode, setMode] = useState<Mode>('tower');
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ name: '', prefix: '', floorFrom: '1', floorTo: '10', perFloor: '4', from: '1', to: '50', code: '', flatType: '', area: '', occupancy: 'Vacant' as NewFlat['occupancy'] });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF(c => ({ ...c, [k]: e.target.value }));

  const name = f.name.trim(), prefix = f.prefix.trim().toUpperCase();
  const common = { area: int(f.area), flatType: f.flatType, occupancy: f.occupancy };
  const list: NewFlat[] = [];
  if (mode === 'tower' && name && prefix) {
    const a = int(f.floorFrom), b = int(f.floorTo), per = int(f.perFloor);
    for (let floor = a; floor <= b && list.length <= MAX; floor++) {
      for (let n = 1; n <= per && list.length <= MAX; n++) {
        const no = `${floor}${String(n).padStart(2, '0')}`;
        list.push({ code: `${prefix}-${no}`, tower: name, label: `${name}, Flat ${no}`, ...common });
      }
    }
  } else if (mode === 'plots' && name && prefix) {
    const a = int(f.from), b = int(f.to), width = Math.max(3, String(b).length);
    for (let n = a; n <= b && list.length <= MAX; n++) list.push({ code: `${prefix}-${String(n).padStart(width, '0')}`, tower: name, label: `${name}, Plot ${n}`, ...common });
  } else if (mode === 'one' && name && f.code.trim()) {
    list.push({ code: f.code.trim().toUpperCase(), tower: name, label: `${name}, ${f.code.trim().toUpperCase()}`, ...common });
  }
  const have = new Set(existing.map(c => c.toUpperCase()));
  const dupes = list.filter(u => have.has(u.code)).length;
  const fresh = list.length - dupes;
  const tooMany = list.length > MAX;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!list.length) { toast(mode === 'one' ? 'Enter the flat number and its tower or block.' : 'Enter a name, a short code and a valid range.', undefined, 'warn'); return; }
    if (tooMany) { toast(`Add at most ${MAX.toLocaleString('en-IN')} at a time.`, undefined, 'warn'); return; }
    if (!fresh) { toast('The society already has all of these.', undefined, 'warn'); return; }
    setBusy(true);
    addFlatsLive(list)
      .then(r => { toast(`${r.added} ${r.added === 1 ? 'flat' : 'flats'} added`, r.skipped ? `${r.skipped} already existed and were left as they are.` : 'Owners and tenants can now be registered against them.'); onAdded(); if (mode === 'one') setF(c => ({ ...c, code: '' })); })
      .catch(err => toast(err instanceof ApiError ? err.message : 'That didn’t go through.', undefined, 'warn'))
      .finally(() => setBusy(false));
  };

  return (
    <form className="panel" onSubmit={submit} style={{ marginTop: 14 }}>
      <PanelHead icon={Buildings} title="Add flats" sub="Set up a whole tower, a run of numbered plots, or a single flat" tone="good" />
      <div className="filters">
        {([['tower', 'A tower, floor by floor'], ['plots', 'Numbered plots or villas'], ['one', 'One flat']] as [Mode, string][]).map(([k, l]) => (
          <button key={k} type="button" className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>{l}</button>
        ))}
      </div>
      <div className="form-grid">
        <label>{mode === 'plots' ? 'Block or phase' : 'Tower or block'}<input className="a-in" value={f.name} maxLength={40} onChange={set('name')} placeholder={mode === 'plots' ? 'Phase 1' : 'Tower 1'} /></label>
        {mode !== 'one' && <label>Short code<input className="a-in" value={f.prefix} maxLength={8} onChange={set('prefix')} placeholder={mode === 'plots' ? 'P' : 'T1'} /></label>}
        {mode === 'tower' && <>
          <label>First floor<input className="a-in" inputMode="numeric" value={f.floorFrom} onChange={set('floorFrom')} /></label>
          <label>Last floor<input className="a-in" inputMode="numeric" value={f.floorTo} onChange={set('floorTo')} /></label>
          <label>Flats on each floor<input className="a-in" inputMode="numeric" value={f.perFloor} onChange={set('perFloor')} /></label>
        </>}
        {mode === 'plots' && <>
          <label>From number<input className="a-in" inputMode="numeric" value={f.from} onChange={set('from')} /></label>
          <label>To number<input className="a-in" inputMode="numeric" value={f.to} onChange={set('to')} /></label>
        </>}
        {mode === 'one' && <label>Flat number<input className="a-in" value={f.code} maxLength={20} onChange={set('code')} placeholder="T1-1203" /></label>}
        <label>Type<select className="a-in" value={f.flatType} onChange={set('flatType')}>{TYPES.map(t => <option key={t} value={t}>{t || 'Not set'}</option>)}</select></label>
        <label>Area (sq ft)<input className="a-in" inputMode="numeric" value={f.area} onChange={set('area')} placeholder="Optional" /></label>
        <label>Occupied by<select className="a-in" value={f.occupancy} onChange={e => setF(c => ({ ...c, occupancy: e.target.value as NewFlat['occupancy'] }))}>{OCCUPANCIES.map(o => <option key={o}>{o}</option>)}</select></label>
      </div>
      <div className="preview num">
        {list.length
          ? <>{tooMany ? <b style={{ color: 'var(--bad)' }}>More than {MAX.toLocaleString('en-IN')} — narrow the range.</b> : <b>{fresh.toLocaleString('en-IN')} to add{list.length > 1 ? ` · ${list[0].code} to ${list[list.length - 1].code}` : ` · ${list[0].code}`}</b>}
            {dupes > 0 && <p>{dupes.toLocaleString('en-IN')} of these already exist and will be skipped.</p>}</>
          : <p style={{ margin: 0 }}>{mode === 'tower' ? 'Flats are numbered floor then position: floor 11, fourth flat in tower T1 becomes T1-1104.' : mode === 'plots' ? 'Plots are numbered in order: P-001, P-002, P-003…' : 'Enter the number exactly as residents know it.'}</p>}
      </div>
      <button className="a-btn" type="submit" disabled={busy || !fresh || tooMany}><Plus size={14} />{fresh > 1 ? `Add ${fresh.toLocaleString('en-IN')} flats` : 'Add flat'}</button>
      <div className="flow-note">Type, area and who occupies a flat apply to everything added in one go — add a tower’s 2BHKs and 3BHKs separately if they differ. Occupancy and rent are changed later from <b>Owners</b>.</div>
    </form>
  );
}
