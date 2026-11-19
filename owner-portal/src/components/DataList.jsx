import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ChevronsUpDown, Download, Search, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { useSearchParams } from 'react-router';

/* One list, done properly, for every table in the portal: a search box, dropdown filters with
   removable chips, sortable column headings, a serial-number column, paging, and a CSV export.
   The list's state lives in the address bar (so it survives a refresh, the back button and a shared
   link) unless `local` is set — for a table that shares its page with another one. */

const SIZES = [10, 25, 50, 100];
const uniq = list => [...new Set(list.filter(v => v !== undefined && v !== null && v !== ''))].sort((a, b) => String(a).localeCompare(String(b)));

function useListState(local, defaults) {
  const [params, setParams] = useSearchParams();
  const [mine, setMine] = useState({});
  const read = get => Object.fromEntries(Object.keys(defaults).map(k => [k, get(k) ?? defaults[k]]));
  const cur = read(k => (local ? mine[k] : params.get(k)));
  /** change some settings; anything but a page change goes back to page 1 */
  const set = patch => {
    const apply = now => ({ ...now, ...('page' in patch ? {} : { page: '1' }), ...patch });
    if (local) { setMine(prev => apply({ ...defaults, ...prev })); return; }
    setParams(prev => {
      const next = apply(read(k => prev.get(k))), out = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(next)) { if (v === defaults[k]) out.delete(k); else out.set(k, v); }
      return out;
    }, { replace: true });
  };
  return [cur, set];
}

function download(name, head, lines) {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const blob = new Blob(['﻿' + [head, ...lines].map(l => l.map(q).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob); link.download = name + '.csv'; link.click();
  URL.revokeObjectURL(link.href);
}

/**
 * columns: [{ key, label, right?, sort?: row => value, dir?: 'asc' | 'desc', cell: (row, n) => node }]
 * filters: [{ key, label, get: row => value, options?: string[] }]   (options default to the values present)
 * search:  row => the strings a search should look in
 * csv:     { name, head: string[], row: row => values[] }
 */
export function DataList({ rows, columns, filters = [], search, searchPlaceholder = 'Search', defaultSort, rowKey, onRow, rowStyle, noun = 'row', csv, local = false, pageSize = 10, minWidth, actions, emptyAll, title, sub }) {
  const defaults = { q: '', sort: defaultSort?.key ?? '', dir: defaultSort?.dir ?? 'asc', page: '1', size: String(pageSize), ...Object.fromEntries(filters.map(f => [f.key, ''])) };
  const [p, set] = useListState(local, defaults);

  // The box answers from its own state — typing never waits on the address bar — and the address
  // bar catches up a moment after the last keystroke.
  const [text, setText] = useState(p.q);
  const timer = useRef(null);
  const type = value => { setText(value); clearTimeout(timer.current); timer.current = setTimeout(() => set({ q: value.trim() }), 250); };
  const apply = patch => { if ('q' in patch) { clearTimeout(timer.current); setText(patch.q); } set(patch); };

  const term = text.trim().toLowerCase();
  const found = rows.filter(r => (!term || !search || search(r).some(v => String(v ?? '').toLowerCase().includes(term))) && filters.every(f => !p[f.key] || String(f.get(r)) === p[f.key]));
  const col = columns.find(c => c.key === p.sort && c.sort);
  if (col) {
    const sign = p.dir === 'desc' ? -1 : 1;
    found.sort((x, y) => { const a = col.sort(x), b = col.sort(y); return (a < b ? -1 : a > b ? 1 : 0) * sign; });
  }
  const sizes = SIZES.includes(pageSize) ? SIZES : [pageSize, ...SIZES].sort((a, b) => a - b);
  const size = sizes.includes(Number(p.size)) ? Number(p.size) : pageSize;
  const pages = Math.max(1, Math.ceil(found.length / size));
  const page = Math.min(pages, Math.max(1, Number(p.page) || 1));
  const from = (page - 1) * size, shown = found.slice(from, from + size);

  const chips = [['q', 'Search', term && `“${text.trim()}”`], ...filters.map(f => [f.key, f.label, p[f.key]])].filter(c => c[2]);
  const clear = () => apply({ q: '', ...Object.fromEntries(filters.map(f => [f.key, ''])) });
  const sortBy = c => set(p.sort === c.key ? { dir: p.dir === 'asc' ? 'desc' : 'asc' } : { sort: c.key, dir: c.dir ?? 'asc' });
  const plural = n => `${n.toLocaleString('en-IN')} ${noun}${n === 1 ? '' : 's'}`;

  return (
    <div className="list-card">
      {title && <div className="list-title"><h3>{title}</h3>{sub && <span>{sub}</span>}</div>}
      <div className="list-bar">
        {search && (
          <label className="tb-search"><Search size={15} />
            <input value={text} onChange={e => type(e.target.value)} placeholder={searchPlaceholder} aria-label={searchPlaceholder} />
            {text && <button onClick={() => apply({ q: '' })} aria-label="Clear search"><X size={14} /></button>}
          </label>
        )}
        {filters.map(f => (
          <label key={f.key} className={'flt' + (p[f.key] ? ' on' : '')}><span>{f.label}</span>
            <select value={p[f.key]} onChange={e => set({ [f.key]: e.target.value })} aria-label={f.label}>
              <option value="">All</option>{(f.options ?? uniq(rows.map(f.get))).map(o => <option key={o}>{o}</option>)}
            </select>
          </label>
        ))}
        {(csv || actions) && <span className="bar-end">
          {csv && <button className="btn ghost sm" onClick={() => download(csv.name, ['Sl. no.', ...csv.head], found.map((r, i) => [i + 1, ...csv.row(r)]))} disabled={!found.length}><Download size={14} /> Export</button>}
          {actions}
        </span>}
      </div>
      <div className="list-info">
        <span>{found.length === rows.length ? plural(found.length) : `${found.length.toLocaleString('en-IN')} of ${plural(rows.length)} match`}</span>
        {chips.map(([k, label, v]) => <button key={k} className="chip" onClick={() => apply({ [k]: '' })} aria-label={`Remove filter ${label}`}>{label}: <b>{v}</b><X size={12} /></button>)}
        {chips.length > 0 && <button className="clear" onClick={clear}>Clear all</button>}
      </div>

      {!shown.length ? (
        <div className="empty">
          {rows.length ? <>Nothing matches these filters.<br /><button className="btn ghost sm" style={{ marginTop: 10 }} onClick={clear}>Clear filters</button></> : emptyAll ?? `No ${noun}s yet.`}
        </div>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl" style={minWidth ? { minWidth } : undefined}>
            <thead><tr>
              <th className="sl">Sl. no.</th>
              {columns.map(c => (
                <th key={c.key} className={c.right ? 'r' : ''} aria-sort={c.sort ? (p.sort === c.key ? (p.dir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}>
                  {c.sort ? (
                    <button className={'th-sort' + (p.sort === c.key ? ' on' : '')} onClick={() => sortBy(c)}>{c.label}{p.sort === c.key ? (p.dir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ChevronsUpDown size={12} />}</button>
                  ) : c.label}
                </th>
              ))}
            </tr></thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={rowKey(r)} className={onRow ? 'rowbtn' : ''} onClick={onRow ? () => onRow(r) : undefined} style={rowStyle?.(r)}>
                  <td className="sl num">{from + i + 1}</td>
                  {columns.map(c => <td key={c.key} className={(c.right ? 'r ' : '') + (c.className ?? '')} onClick={c.stop ? e => e.stopPropagation() : undefined}>{c.cell(r, from + i)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {found.length > 0 && (
        <div className="pager">
          <span>Showing <b>{from + 1}–{from + shown.length}</b> of <b>{found.length.toLocaleString('en-IN')}</b></span>
          <label>Rows per page<select value={size} onChange={e => set({ size: e.target.value })} aria-label="Rows per page">{sizes.map(s => <option key={s}>{s}</option>)}</select></label>
          <span className="spacer" />
          <div className="pg-btns">
            <button onClick={() => set({ page: '1' })} disabled={page === 1} aria-label="First page"><ChevronsLeft size={15} /></button>
            <button onClick={() => set({ page: String(page - 1) })} disabled={page === 1} aria-label="Previous page"><ChevronLeft size={15} /></button>
            <span>Page <b>{page}</b> of <b>{pages}</b></span>
            <button onClick={() => set({ page: String(page + 1) })} disabled={page === pages} aria-label="Next page"><ChevronRight size={15} /></button>
            <button onClick={() => set({ page: String(pages) })} disabled={page === pages} aria-label="Last page"><ChevronsRight size={15} /></button>
          </div>
        </div>
      )}
    </div>
  );
}
