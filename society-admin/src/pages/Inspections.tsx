import { confirmBox } from '../lib/dialog';
import { ArrowLeft, Camera, ClipboardText, DownloadSimple, Printer, Sparkle, X } from '@phosphor-icons/react';
import { TableCard } from '../components/TableCard';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useToast } from '../components/toast-context';
import { Empty, PageHead, Pill, Stat } from '../components/ui';
import { accessToken, api, ApiError, API_URL, LIVE, upload } from '../lib/api';
import { association } from '../lib/live';

/* Inspections: a checklist walked through room by room with ratings, notes and photos; findings
   written from them; a report to print or share; and work orders raised from what was found.
   The property manager does the same walkthrough on the phone. Connected mode only. */

const A = () => `/v1/admin/${association()}`;
type Counts = { total: number; rated: number; Good: number; Fair: number; Poor: number; Damaged: number; Missing: number; findings: number; critical: number; high: number; workOrders: number };
type Head = { id: string; ref: string; type: string; template: string; scope: 'unit' | 'common'; where: string; unit: string | null; status: 'In progress' | 'Submitted'; inspector: string; startedAt: string; submittedAt: string | null;
  counts: Counts; shareOwner: boolean; shareTenant: boolean; ack: { name: string; role: string; note: string; at: string } | null };
type Item = { id: string; item: string; photoRequired: boolean; condition: string | null; note: string; photos: string[]; checkedAt: string | null; finding: string; severity: string | null; recommendation: string | null; category: string | null;
  findingBy: 'ai' | 'rules' | null; workOrder: { ref: string; status: string; vendor: string | null; costEstimate: number | null; approval: string } | null };
type Full = Head & { summary: string; summaryBy: 'ai' | 'rules' | null; sections: { name: string; items: Item[] }[]; missing: string[];
  comparison: { ref: string; date: string; worse: number; better: number; changes: { section: string; item: string; before: string; after: string; worse: boolean; beforePhoto: string | null; afterPhoto: string | null }[] } | null };
type Template = { key: string; name: string; about: string; scope: 'unit' | 'common'; builtIn: boolean; sections: { name: string; items: { name: string; photo: boolean }[] }[] };
type Options = { types: string[]; conditions: string[]; places: string[]; templates: Template[]; units: { id: string; code: string; label: string }[]; aiConnected: boolean };
const COND_TONE: Record<string, 'good' | 'warn' | 'bad' | 'acc' | 'dim'> = { Good: 'good', Fair: 'warn', Poor: 'bad', Damaged: 'bad', Missing: 'bad' };
const SEV_TONE: Record<string, 'good' | 'warn' | 'bad' | 'acc' | 'dim'> = { Low: 'dim', Medium: 'warn', High: 'bad', Critical: 'bad' };
const small = { fontSize: 12, color: 'var(--ink3)' } as const;
const grid = { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', alignItems: 'end' } as const;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const thumb = { width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--line)' } as const;

export function Inspections() {
  const toast = useToast();
  const [opt, setOpt] = useState<Options | null>(null);
  const [list, setList] = useState<Head[]>([]);
  const [open, setOpen] = useState<Full | null>(null);
  const [busy, setBusy] = useState(false);
  const [start, setStart] = useState({ type: 'Monthly', template: 'flat', unitId: '', place: '' });
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [estimates, setEstimates] = useState<Record<string, string>>({});
  const [making, setMaking] = useState(false);
  const [tpl, setTpl] = useState({ name: '', scope: 'common' as 'unit' | 'common', text: '' });

  const fail = useCallback((e: unknown) => toast(e instanceof ApiError ? e.message : 'That didn’t go through.', undefined, 'warn'), [toast]);
  const load = useCallback(() => { if (LIVE) api<Head[]>('GET', `${A()}/inspections`).then(setList).catch(fail); }, [fail]);
  const loadOptions = useCallback(() => { if (LIVE) api<Options>('GET', `${A()}/inspections/options`).then(setOpt).catch(fail); }, [fail]);
  useEffect(() => { load(); loadOptions(); }, [load, loadOptions]);

  if (!LIVE) {
    return (
      <>
        <PageHead title="Inspections" sub="Checklists, photos, findings and reports." />
        <Empty icon={ClipboardText} title="Connect the console to the API" body="Inspections are kept on the server. Set VITE_API_URL to use them." />
      </>
    );
  }

  const show = (id: string) => api<Full>('GET', `${A()}/inspections/${id}`).then(f => { setOpen(f); setPicked({}); setEstimates({}); }).catch(fail);
  const run = async (p: Promise<Full>, msg?: string) => { setBusy(true); try { const f = await p; setOpen(f); if (msg) toast(msg, f.ref); load(); } catch (e) { fail(e); } setBusy(false); };
  const chosen = opt?.templates.find(t => t.key === start.template);
  const begin = (e: FormEvent) => {
    e.preventDefault();
    void run(api<Full>('POST', `${A()}/inspections`, { type: start.type, template: start.template, ...(chosen?.scope === 'unit' ? { unitId: start.unitId || undefined } : { place: start.place }) }), 'Inspection started');
  };
  const setItem = (it: Item, patch: Partial<Pick<Item, 'condition' | 'note' | 'photos'>>) => { if (open) void run(api<Full>('PUT', `${A()}/inspections/${open.id}/items/${it.id}`, patch)); };
  const addPhotos = async (it: Item, files: FileList | null) => {
    if (!files?.length || !open) return;
    setBusy(true);
    try {
      const urls: string[] = [];
      for (const f of [...files].slice(0, 8 - it.photos.length)) urls.push(await upload(f));
      setOpen(await api<Full>('PUT', `${A()}/inspections/${open.id}/items/${it.id}`, { photos: [...it.photos, ...urls] }));
    } catch (e) { fail(e); }
    setBusy(false);
  };
  const raise = () => {
    if (!open) return;
    const items = Object.keys(picked).filter(k => picked[k]).map(id => ({ id, ...(Number(estimates[id]) > 0 ? { estimate: Math.round(Number(estimates[id])) } : {}) }));
    if (!items.length) return;
    setBusy(true);
    api<{ created: string[]; inspection: Full }>('POST', `${A()}/inspections/${open.id}/work-orders`, { items })
      .then(r => { setOpen(r.inspection); setPicked({}); toast(r.created.length ? `${r.created.length} work order${r.created.length === 1 ? '' : 's'} raised` : 'Nothing to raise', r.created.join(', ')); load(); })
      .catch(fail).finally(() => setBusy(false));
  };
  const download = async () => {
    if (!open) return;
    try {
      const res = await fetch(`${API_URL}${A()}/inspections/${open.id}/report.csv`, { headers: { authorization: 'Bearer ' + accessToken() } });
      if (!res.ok) throw new Error();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(await res.blob()); a.download = `${open.ref}.csv`; a.click();
      URL.revokeObjectURL(a.href);
    } catch { toast('The download didn’t start', 'Try again.', 'warn'); }
  };
  /** "Pool: Water clarity*, Life buoy" per line; a star marks a photo that must be taken */
  const saveTemplate = (e: FormEvent) => {
    e.preventDefault();
    const sections = tpl.text.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
      const [name, rest = ''] = l.split(':');
      return { name: (name ?? '').trim(), items: rest.split(',').map(x => x.trim()).filter(Boolean).map(x => ({ name: x.replace(/\*+$/, '').trim(), photo: x.endsWith('*') })) };
    });
    api<Template>('POST', `${A()}/inspections/templates`, { name: tpl.name.trim(), scope: tpl.scope, sections })
      .then(t => { toast('Checklist saved', t.name); setMaking(false); setTpl({ name: '', scope: 'common', text: '' }); loadOptions(); }).catch(fail);
  };

  /* ---------- one inspection ---------- */
  if (open) {
    const done = open.status === 'Submitted';
    const findings = open.sections.flatMap(s => s.items.filter(i => i.finding && i.severity).map(i => ({ ...i, section: s.name })));
    const raisable = findings.filter(f => !f.workOrder);
    const nPicked = Object.values(picked).filter(Boolean).length;
    return (
      <>
        <div className="toolbar no-print" style={{ gap: 8 }}>
          <button className="a-btn ghost" onClick={() => { setOpen(null); load(); }}><ArrowLeft size={15} />All inspections</button>
          <span style={{ flex: 1 }} />
          {done && <button className="a-btn ghost" onClick={() => window.print()}><Printer size={15} />Print / save as PDF</button>}
          {done && <button className="a-btn ghost" onClick={download}><DownloadSimple size={15} />Spreadsheet</button>}
        </div>
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 19, fontWeight: 800 }}>{open.ref} · {open.type} inspection</h2><Pill tone={done ? 'good' : 'acc'}>{open.status}</Pill>
          </div>
          <div style={{ fontSize: 13.5, marginTop: 4 }}>{open.where} · {open.template} · Inspector: {open.inspector}</div>
          <div style={small}>Started {when(open.startedAt)}{done ? ` · Submitted ${when(open.submittedAt)}` : ''} · {open.counts.rated} of {open.counts.total} items rated</div>
          {done && (
            <>
              <p style={{ fontSize: 14, lineHeight: 1.55, margin: '12px 0 4px' }}>{open.summary}</p>
              <div style={small}>{open.summaryBy === 'ai' ? 'Summary and findings written by the AI model from the photos, ratings and notes.' : 'Summary and findings written by the built-in rules from the ratings and notes.'}</div>
              <div className="stats" style={{ marginTop: 12, marginBottom: 0 }}>
                <Stat label="Good" value={open.counts.Good} tone="good" /><Stat label="Fair" value={open.counts.Fair} tone={open.counts.Fair ? 'warn' : undefined} />
                <Stat label="Poor / damaged / missing" value={open.counts.Poor + open.counts.Damaged + open.counts.Missing} tone={open.counts.Poor + open.counts.Damaged + open.counts.Missing ? 'bad' : undefined} />
                <Stat label="Findings" value={open.counts.findings} /><Stat label="Work orders" value={open.counts.workOrders} />
              </div>
              {open.ack && <div style={{ fontSize: 13.5, marginTop: 10 }}><Pill tone="good">Acknowledged</Pill> {open.ack.name} ({open.ack.role}) · {when(open.ack.at)}{open.ack.note ? ` · “${open.ack.note}”` : ''}</div>}
            </>
          )}
        </div>

        {!done && open.missing.length > 0 && (
          <div className="card no-print" style={{ marginBottom: 12, borderColor: 'var(--warn)' }}>
            <b>{open.missing.length} thing{open.missing.length === 1 ? '' : 's'} still missing before this can be submitted</b>
            <ul style={{ margin: '6px 0 0 18px', fontSize: 13 }}>{open.missing.slice(0, 8).map(m => <li key={m}>{m}</li>)}{open.missing.length > 8 && <li>…and {open.missing.length - 8} more</li>}</ul>
          </div>
        )}

        {done && open.scope === 'unit' && (
          <div className="card no-print" style={{ marginBottom: 12, display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            <b>Share the report in the app</b>
            <label className="chk"><input type="checkbox" checked={open.shareOwner} onChange={e => run(api<Full>('PUT', `${A()}/inspections/${open.id}/share`, { owner: e.target.checked, tenant: open.shareTenant }), e.target.checked ? 'Shared with the owner' : 'No longer shared with the owner')} />With the flat’s owner</label>
            <label className="chk"><input type="checkbox" checked={open.shareTenant} onChange={e => run(api<Full>('PUT', `${A()}/inspections/${open.id}/share`, { owner: open.shareOwner, tenant: e.target.checked }), e.target.checked ? 'Shared with the residents' : 'No longer shared with the residents')} />With the tenant and family</label>
            <span style={small}>They are told at once, and can acknowledge the report from their phone.</span>
          </div>
        )}

        {done && open.comparison && (
          <div className="card" style={{ marginBottom: 12 }}>
            <b>Compared with the move-in inspection {open.comparison.ref}</b>
            <div style={small}>{new Date(open.comparison.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} · {open.comparison.worse} item{open.comparison.worse === 1 ? '' : 's'} worse, {open.comparison.better} better</div>
            {open.comparison.changes.length > 0 && (
              <div className="a-tbl-wrap" style={{ marginTop: 8 }}><table className="a-tbl"><thead><tr><th>Where</th><th>Item</th><th>At move-in</th><th>Now</th><th>Photos</th></tr></thead>
                <tbody>{open.comparison.changes.map((c, i) => (
                  <tr key={i}><td>{c.section}</td><td className="cell-t">{c.item}</td><td><Pill tone={COND_TONE[c.before] ?? 'dim'}>{c.before}</Pill></td><td><Pill tone={COND_TONE[c.after] ?? 'dim'}>{c.after}</Pill></td>
                    <td><div style={{ display: 'flex', gap: 6 }}>{c.beforePhoto && <a href={c.beforePhoto} target="_blank" rel="noreferrer"><img src={c.beforePhoto} alt="At move-in" style={{ ...thumb, width: 44, height: 44 }} /></a>}{c.afterPhoto && <a href={c.afterPhoto} target="_blank" rel="noreferrer"><img src={c.afterPhoto} alt="Now" style={{ ...thumb, width: 44, height: 44 }} /></a>}</div></td></tr>
                ))}</tbody></table></div>
            )}
          </div>
        )}

        {done && findings.length > 0 && (
          <div className="card" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <b>Findings</b><span style={small}>{raisable.length ? 'Tick the ones to fix; an estimate above the society’s limit goes for approval as usual.' : 'Every finding has a work order.'}</span><span style={{ flex: 1 }} />
              {raisable.length > 0 && <button className="a-btn ghost no-print" onClick={() => setPicked(Object.fromEntries(raisable.map(f => [f.id, true])))}>Select all</button>}
              {raisable.length > 0 && <button className="a-btn no-print" disabled={busy || !nPicked} onClick={raise}>Raise {nPicked || ''} work order{nPicked === 1 ? '' : 's'}</button>}
            </div>
            <div className="a-tbl-wrap" style={{ marginTop: 8 }}><table className="a-tbl"><thead><tr><th className="no-print" /><th>Where</th><th>Finding</th><th>Severity</th><th>Do</th><th>Trade</th><th>Work order</th></tr></thead>
              <tbody>{findings.map(f => (
                <tr key={f.id}>
                  <td className="no-print">{!f.workOrder && <input type="checkbox" aria-label={`Select ${f.item}`} checked={!!picked[f.id]} onChange={e => setPicked({ ...picked, [f.id]: e.target.checked })} />}</td>
                  <td><div className="cell-t">{f.item}</div><div className="cell-m">{f.section}</div></td>
                  <td style={{ maxWidth: 340 }}>{f.finding}<div className="cell-m">{f.findingBy === 'ai' ? 'AI, from the photos' : 'From the rating'}</div></td>
                  <td><Pill tone={SEV_TONE[f.severity ?? ''] ?? 'dim'}>{f.severity}</Pill></td><td>{f.recommendation}</td><td>{f.category}</td>
                  <td>{f.workOrder ? <><Link to={'/issues?q=' + f.workOrder.ref} className="cell-t">{f.workOrder.ref}</Link><div className="cell-m">{f.workOrder.status}{f.workOrder.vendor ? ' · ' + f.workOrder.vendor : ''}{f.workOrder.approval === 'pending' ? ' · estimate awaiting approval' : ''}</div></>
                    : picked[f.id] ? <input className="a-in no-print" style={{ width: 130 }} inputMode="numeric" placeholder="Estimate ₹ (optional)" aria-label={`Estimate for ${f.item}`} value={estimates[f.id] ?? ''} onChange={e => setEstimates({ ...estimates, [f.id]: e.target.value.replace(/\D/g, '') })} /> : '—'}</td>
                </tr>
              ))}</tbody></table></div>
          </div>
        )}

        {open.sections.map(sec => (
          <div key={sec.name} className="card" style={{ marginBottom: 12 }}>
            <b style={{ fontSize: 15 }}>{sec.name}</b>
            {sec.items.map(it => (
              <div key={it.id} style={{ borderTop: '1px solid var(--line)', padding: '10px 0', display: 'grid', gap: 6 }}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <b style={{ fontSize: 13.5, minWidth: 150 }}>{it.item}</b>
                  {it.photoRequired && !done && <span style={small}>photo required</span>}
                  {done ? <Pill tone={COND_TONE[it.condition ?? ''] ?? 'dim'}>{it.condition ?? 'Not rated'}</Pill> : (
                    <div className="filters" style={{ margin: 0 }}>{(opt?.conditions ?? []).map(c => <button key={c} type="button" className={it.condition === c ? 'on' : ''} disabled={busy} onClick={() => setItem(it, { condition: c })}>{c}</button>)}</div>
                  )}
                  <span style={{ flex: 1 }} />
                  {it.checkedAt && <span style={small}>{when(it.checkedAt)}</span>}
                </div>
                {done ? (it.note && <div style={{ fontSize: 13 }}>{it.note}</div>) : (
                  <input className="a-in" defaultValue={it.note} key={it.id + it.note} placeholder="Note (optional)" aria-label={`Note for ${it.item}`} maxLength={1000} onBlur={e => { if (e.target.value.trim() !== it.note) setItem(it, { note: e.target.value.trim() }); }} />
                )}
                {(it.photos.length > 0 || !done) && (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    {it.photos.map(p => (
                      <span key={p} style={{ position: 'relative' }}>
                        <a href={p} target="_blank" rel="noreferrer"><img src={p} alt={`${it.item} in ${sec.name}`} style={thumb} /></a>
                        {!done && <button type="button" aria-label="Remove photo" onClick={() => setItem(it, { photos: it.photos.filter(x => x !== p) })} style={{ position: 'absolute', top: -6, right: -6, background: '#fff', border: '1px solid var(--line)', borderRadius: 99, padding: 2, display: 'grid' }}><X size={11} /></button>}
                      </span>
                    ))}
                    {!done && it.photos.length < 8 && (
                      <label className="a-btn ghost" style={{ cursor: 'pointer' }}><Camera size={15} />Add photos
                        <input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={e => { void addPhotos(it, e.target.files); e.target.value = ''; }} />
                      </label>
                    )}
                  </div>
                )}
                {!done && it.finding && <div style={{ fontSize: 13, color: 'var(--ink2)' }}><Pill tone={SEV_TONE[it.severity ?? ''] ?? 'dim'}>{it.severity}</Pill> {it.finding} · {it.recommendation}</div>}
              </div>
            ))}
          </div>
        ))}

        {!done && (
          <div className="toolbar no-print" style={{ gap: 8 }}>
            <button className="a-btn ghost" disabled={busy} onClick={() => run(api<Full>('POST', `${A()}/inspections/${open.id}/analyse`), 'Findings written')}><Sparkle size={15} />Write the findings so far</button>
            <span style={{ flex: 1 }} />
            <span style={small}>{open.missing.length ? `${open.missing.length} still missing` : 'Everything is covered'}</span>
            <button className="a-btn" disabled={busy || open.missing.length > 0} onClick={async () => { if ((await confirmBox('Submit this inspection? It cannot be changed afterwards.'))) void run(api<Full>('POST', `${A()}/inspections/${open.id}/submit`), 'Inspection submitted'); }}>Submit and write the report</button>
          </div>
        )}
      </>
    );
  }

  /* ---------- the list ---------- */
  return (
    <>
      <PageHead title="Inspections" sub="Walk through a flat or the common areas with a checklist. Ratings, notes and photos become a standard report; anything wrong becomes a work order with the evidence attached." />
      <div className="stats">
        <Stat icon={ClipboardText} label="Inspections" value={list.length} />
        <Stat label="In progress" value={list.filter(l => l.status === 'In progress').length} tone={list.some(l => l.status === 'In progress') ? 'acc' : undefined} />
        <Stat label="Findings without a work order" value={list.reduce((n, l) => n + Math.max(0, l.counts.findings - l.counts.workOrders), 0)} tone={list.some(l => l.counts.findings > l.counts.workOrders) ? 'warn' : undefined} />
        <Stat label="Awaiting acknowledgement" value={list.filter(l => (l.shareOwner || l.shareTenant) && !l.ack).length} />
      </div>

      {opt && (
        <form onSubmit={begin} className="card" style={{ display: 'grid', gap: 10, marginBottom: 12 }}>
          <b>Start an inspection</b>
          <div style={grid}>
            <label>Checklist<select className="a-in" value={start.template} onChange={e => setStart({ ...start, template: e.target.value })}>{opt.templates.map(t => <option key={t.key} value={t.key}>{t.name}{t.builtIn ? '' : ' (yours)'}</option>)}</select></label>
            <label>Type<select className="a-in" value={start.type} onChange={e => setStart({ ...start, type: e.target.value })}>{opt.types.filter(t => chosen?.scope === 'unit' || !/^Move/.test(t)).map(t => <option key={t}>{t}</option>)}</select></label>
            {chosen?.scope === 'unit'
              ? <label>Flat<select className="a-in" value={start.unitId} onChange={e => setStart({ ...start, unitId: e.target.value })}><option value="">Choose a flat</option>{opt.units.map(u => <option key={u.id} value={u.id}>{u.code}</option>)}</select></label>
              : <label>Where<input className="a-in" value={start.place} onChange={e => setStart({ ...start, place: e.target.value })} placeholder="e.g. Tower 2 and basement" maxLength={80} /></label>}
            <button className="a-btn" disabled={busy || (chosen?.scope === 'unit' && !start.unitId)}>Start</button>
          </div>
          <div style={small}>
            {chosen ? `${chosen.about} · ${chosen.sections.length} areas, ${chosen.sections.reduce((n, s) => n + s.items.length, 0)} items, ${chosen.sections.reduce((n, s) => n + s.items.filter(i => i.photo).length, 0)} need a photo.` : ''}{' '}
            {opt.aiConnected ? 'An AI model will look at the photos and write the findings.' : 'No AI key is set, so findings are written from the ratings and notes by the built-in rules.'}{' '}
            <button type="button" style={{ color: 'var(--acc-ink)', fontWeight: 700 }} onClick={() => setMaking(m => !m)}>{making ? 'Close' : 'Make your own checklist'}</button>
            {chosen && !chosen.builtIn && <>{' · '}<button type="button" style={{ color: 'var(--bad)', fontWeight: 700 }} onClick={async () => { if ((await confirmBox(`Remove the checklist “${chosen.name}”? Past inspections keep their copy.`))) api('DELETE', `${A()}/inspections/templates/${chosen.key}`).then(() => { toast('Checklist removed', chosen.name); setStart(s => ({ ...s, template: 'flat' })); loadOptions(); }).catch(fail); }}>Remove this checklist</button></>}
          </div>
        </form>
      )}

      {making && (
        <form onSubmit={saveTemplate} className="card" style={{ display: 'grid', gap: 10, marginBottom: 12 }}>
          <b>Your own checklist</b>
          <div style={grid}>
            <label>Name<input className="a-in" value={tpl.name} onChange={e => setTpl({ ...tpl, name: e.target.value })} maxLength={60} /></label>
            <label>For<select className="a-in" value={tpl.scope} onChange={e => setTpl({ ...tpl, scope: e.target.value as 'unit' | 'common' })}><option value="common">Common areas</option><option value="unit">A flat</option></select></label>
          </div>
          <label>Areas and items — one area per line, items separated by commas, a star after an item that must be photographed
            <textarea className="a-in" rows={5} value={tpl.text} onChange={e => setTpl({ ...tpl, text: e.target.value })} placeholder={'Pool: Water clarity*, Life buoy, Shower area\nPump room: Pumps*, Chlorine store'} />
          </label>
          <div><button className="a-btn" disabled={tpl.name.trim().length < 3 || !tpl.text.includes(':')}>Save checklist</button></div>
        </form>
      )}

      {!list.length ? <Empty icon={ClipboardText} title="No inspections yet" body="Start one above, or have the property manager start one from the app." /> : (
        <TableCard rows={list} noun="inspection" search={l => [l.ref, l.type, l.where, l.unit, l.inspector, l.template]} placeholder="Search by number, flat or place, or inspector"
          filters={[{ key: 'type', label: 'Type', get: l => l.type }, { key: 'status', label: 'Status', get: l => l.status, options: ['In progress', 'Submitted'] }, { key: 'who', label: 'Inspector', get: l => l.inspector }, { key: 'ack', label: 'Report', get: l => (l.ack ? 'Acknowledged' : l.shareOwner || l.shareTenant ? 'Shared, not acknowledged' : 'Not shared'), options: ['Acknowledged', 'Shared, not acknowledged', 'Not shared'] }]}
          sorts={[{ label: 'Most findings', by: l => l.counts.findings, dir: 'desc' }, { label: 'Newest', by: l => l.startedAt, dir: 'desc' }]}>{(page, sl) => (<div className="a-tbl-wrap">
          <table className="a-tbl">
            <thead><tr><th className="sl">Sl. no.</th><th>Inspection</th><th>Where</th><th>Inspector</th><th>Progress</th><th>Findings</th><th>Shared</th><th>Status</th></tr></thead>
            <tbody>{page.map((l, rowNo) => (
              <tr key={l.id}><td className="sl num">{sl(rowNo)}</td>
                <td><button className="cell-t" onClick={() => show(l.id)}>{l.ref} · {l.type}</button><div className="cell-m">{when(l.startedAt)}</div></td>
                <td>{l.where}</td><td>{l.inspector}</td>
                <td>{l.counts.rated} of {l.counts.total} rated</td>
                <td>{l.counts.findings ? <>{l.counts.findings}{l.counts.critical + l.counts.high ? <div className="cell-m">{l.counts.critical + l.counts.high} high or critical</div> : null}<div className="cell-m">{l.counts.workOrders} work order{l.counts.workOrders === 1 ? '' : 's'}</div></> : '—'}</td>
                <td>{l.ack ? <Pill tone="good">Acknowledged</Pill> : l.shareOwner || l.shareTenant ? <Pill tone="warn">Shared, not acknowledged</Pill> : '—'}</td>
                <td><Pill tone={l.status === 'Submitted' ? 'good' : 'acc'}>{l.status}</Pill></td>
              </tr>
            ))}</tbody>
          </table>
        </div>)}</TableCard>
      )}
    </>
  );
}
