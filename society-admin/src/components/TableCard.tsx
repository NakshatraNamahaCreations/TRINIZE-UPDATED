import { CaretDoubleLeft, CaretDoubleRight, CaretLeft, CaretRight, DownloadSimple, MagnifyingGlass, X } from '@phosphor-icons/react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { downloadCsv } from '../lib/format';

/* What every list in the console gets: a search box, dropdown filters with removable chips, a sort
   menu, a serial number, paging, and (where asked for) a spreadsheet export. The table itself stays
   where it is — it is handed the rows for the current page and a function for the serial number.

   Two ways to feed it:
     rows    the whole list is already here; searching, filtering, sorting and paging happen in the browser.
             Right for short lists that cannot grow much (guards, vendors, the team).
     remote  the server does all of it. The table sends the page number, page size, search text, the
             chosen filters and the sort, and is sent back that one page and the total. Right for
             anything that grows with the society: flats, visitors, bills. */

export type TableFilter<T> = { key: string; label: string; /** browser mode: the value of this filter for a row */ get?: (row: T) => string | null | undefined; /** the choices; required when the server filters */ options?: string[] };
export type TableSort<T> = { label: string; /** browser mode */ by?: (row: T) => string | number; dir?: 'asc' | 'desc'; /** server mode: the name the server knows this order by */ key?: string };
/** what the table asks the server for */
export type PageQuery = { page: number; limit: number; q: string; sort: string; filters: Record<string, string> };
export type PageResult<T> = { items: T[]; total: number };
const SIZES = [10, 25, 50, 100];
const uniq = (list: (string | null | undefined)[]) => [...new Set(list.filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b));

export function TableCard<T>({ rows = [], remote, reloadKey, empty, search, placeholder = 'Search', filters = [], sorts = [], pageSize = 10, noun = 'row', csv, style, children }: {
  rows?: T[];
  /** fetch one page from the server; when given, `rows` is not used */
  remote?: (q: PageQuery) => Promise<PageResult<T>>;
  /** server mode: change this to read the current page again (after a save, or on a timer) */
  reloadKey?: unknown;
  /** server mode: what to show when there is nothing at all, with no search or filter in the way */
  empty?: ReactNode;
  /** browser mode: the text a search should look in, for one row. Server mode: pass `true` to show the box. */
  search?: ((row: T) => unknown[]) | true;
  placeholder?: string;
  filters?: TableFilter<T>[];
  sorts?: TableSort<T>[];
  pageSize?: number;
  /** what one row is called: "bill", "vendor" */
  noun?: string;
  csv?: { name: string; head: string[]; row: (row: T) => (string | number)[] };
  style?: CSSProperties;
  /** the table: `page` is the rows to draw, `sl(n)` the serial number of the nth of them */
  children: (page: T[], sl: (n: number) => number) => ReactNode;
}) {
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [sort, setSort] = useState(-1);
  const [size, setSize] = useState(pageSize);
  const [at, setAt] = useState(1);

  /* ---- server mode: one page at a time ---- */
  const [got, setGot] = useState<{ items: T[]; total: number; page: number } | null>(null);
  const [failed, setFailed] = useState('');
  const [exporting, setExporting] = useState(false);
  // typing does not send a request per letter: the search goes out when the typing pauses
  const [asked, setAsked] = useState('');
  useEffect(() => { const h = setTimeout(() => setAsked(text.trim()), 300); return () => clearTimeout(h); }, [text]);
  const fetcher = useRef(remote);
  useEffect(() => { fetcher.current = remote; });
  const isRemote = !!remote;
  const chosen = JSON.stringify(picked), sortKey = sorts[sort]?.key ?? '';
  useEffect(() => {
    if (!isRemote) return;
    let live = true;
    fetcher.current!({ page: at, limit: size, q: asked, sort: sortKey, filters: JSON.parse(chosen) as Record<string, string> })
      // a page past the end (rows were removed, or a filter narrowed the list) steps back to the last one there is
      .then(r => { if (!live) return; const last = Math.max(1, Math.ceil(r.total / size)); if (at > last) setAt(last); else { setGot({ ...r, page: at }); setFailed(''); } })
      .catch(e => { if (live) setFailed(e instanceof Error ? e.message : 'The list could not be loaded.'); });
    return () => { live = false; };
  }, [isRemote, at, size, asked, sortKey, chosen, reloadKey]);

  const term = text.trim().toLowerCase();
  const all = rows.length;
  let total: number, shown: T[], page: number, foundAll: T[] | null = null;
  if (isRemote) {
    total = got?.total ?? 0; shown = got?.items ?? []; page = got?.page ?? at;
  } else {
    const look = typeof search === 'function' ? search : null;
    const found = rows.filter(r => (!term || !look || look(r).some(v => String(v ?? '').toLowerCase().includes(term))) && filters.every(f => !picked[f.key] || (f.get?.(r) ?? '') === picked[f.key]));
    const s = sorts[sort];
    if (s?.by) {
      const by = s.by, sign = s.dir === 'desc' ? -1 : 1;
      found.sort((x, y) => { const a = by(x), b = by(y); return (a < b ? -1 : a > b ? 1 : 0) * sign; });
    }
    total = found.length;
    page = Math.min(Math.max(1, Math.ceil(total / size)), at);
    shown = found.slice((page - 1) * size, page * size);
    foundAll = found;
  }
  const pages = Math.max(1, Math.ceil(total / size));
  const from = (page - 1) * size;

  const chips = [...(term ? [['q', 'Search', `“${text.trim()}”`] as const] : []), ...filters.filter(f => picked[f.key]).map(f => [f.key, f.label, picked[f.key]!] as const)];
  const narrowed = chips.length > 0;
  const drop = (key: string) => { if (key === 'q') setText(''); else setPicked(p => ({ ...p, [key]: '' })); setAt(1); };
  const clear = () => { setText(''); setPicked({}); setAt(1); };
  const many = /[^aeiou]y$/.test(noun) ? noun.slice(0, -1) + 'ies' : noun + 's';
  const count = (n: number) => `${n.toLocaleString('en-IN')} ${n === 1 ? noun : many}`;
  const tools = !!search || filters.length > 0 || sorts.length > 0 || !!csv;

  /** the spreadsheet has every matching row, not only the page on screen: in server mode they are read a hundred at a time */
  const exportCsv = async () => {
    if (!csv) return;
    let list: T[] = foundAll ?? [];
    if (isRemote) {
      setExporting(true);
      try {
        list = [];
        for (let p = 1; p <= 500; p++) {
          const r = await fetcher.current!({ page: p, limit: 100, q: asked, sort: sortKey, filters: picked });
          list.push(...r.items);
          if (list.length >= r.total || !r.items.length) break;
        }
      } catch (e) { setFailed(e instanceof Error ? e.message : 'The export could not be made.'); setExporting(false); return; }
      setExporting(false);
    }
    downloadCsv(csv.name + '.csv', [['Sl. no.', ...csv.head], ...list.map((r, i) => [i + 1, ...csv.row(r)])]);
  };

  const nothingAtAll = isRemote ? !!got && total === 0 && !narrowed : false;
  return (
    <div className="tbl-card" style={style} aria-busy={isRemote && !got ? true : undefined}>
      {tools && (
        <div className="tbl-bar no-print">
          {search && (
            <label className="tbl-search"><MagnifyingGlass size={15} />
              <input value={text} onChange={e => { setText(e.target.value); setAt(1); }} placeholder={placeholder} aria-label={placeholder} />
              {text && <button type="button" onClick={() => drop('q')} aria-label="Clear search"><X size={13} /></button>}
            </label>
          )}
          {filters.map(f => (
            <label key={f.key} className={'tbl-flt' + (picked[f.key] ? ' on' : '')}><span>{f.label}</span>
              <select value={picked[f.key] ?? ''} onChange={e => { setPicked(p => ({ ...p, [f.key]: e.target.value })); setAt(1); }} aria-label={f.label}>
                <option value="">All</option>{(f.options ?? uniq(rows.map(r => f.get?.(r)))).map(o => <option key={o}>{o}</option>)}
              </select>
            </label>
          ))}
          {sorts.length > 0 && (
            <label className={'tbl-flt' + (sort >= 0 ? ' on' : '')}><span>Sort</span>
              <select value={sort} onChange={e => { setSort(Number(e.target.value)); setAt(1); }} aria-label="Sort by">
                <option value={-1}>As listed</option>{sorts.map((x, i) => <option key={x.label} value={i}>{x.label}</option>)}
              </select>
            </label>
          )}
          {csv && <button type="button" className="a-btn ghost tbl-export" disabled={!total || exporting} onClick={exportCsv}><DownloadSimple size={15} />{exporting ? 'Preparing…' : 'Export'}</button>}
        </div>
      )}
      <div className="tbl-info no-print">
        <span>{isRemote ? (!got ? 'Loading…' : narrowed ? `${count(total)} found` : count(total)) : total === all ? count(total) : `${total.toLocaleString('en-IN')} of ${count(all)} match`}</span>
        {chips.map(([k, label, v]) => <button key={k} type="button" className="tbl-chip" onClick={() => drop(k)} aria-label={`Remove filter ${label}`}>{label}: <b>{v}</b><X size={11} /></button>)}
        {chips.length > 0 && <button type="button" className="tbl-clear" onClick={clear}>Clear all</button>}
      </div>

      {failed ? <div className="tbl-none" role="alert">{failed}</div>
        : nothingAtAll && empty ? empty
        : (isRemote ? !!got && total === 0 : all > 0 && total === 0)
          ? <div className="tbl-none">{narrowed ? 'Nothing matches these filters.' : `No ${many} yet.`}{narrowed && <><br /><button type="button" className="a-btn ghost" style={{ marginTop: 10 }} onClick={clear}>Clear filters</button></>}</div>
          : children(shown, n => from + n + 1)}

      {total > 0 && (
        <div className="tbl-pager no-print">
          <span>Showing <b>{from + 1}–{from + shown.length}</b> of <b>{total.toLocaleString('en-IN')}</b></span>
          <label>Rows per page<select value={size} onChange={e => { setSize(Number(e.target.value)); setAt(1); }} aria-label="Rows per page">{(SIZES.includes(pageSize) ? SIZES : [pageSize, ...SIZES]).map(x => <option key={x}>{x}</option>)}</select></label>
          <span className="spacer" />
          <div className="tbl-pg">
            <button type="button" onClick={() => setAt(1)} disabled={page === 1} aria-label="First page"><CaretDoubleLeft size={14} /></button>
            <button type="button" onClick={() => setAt(page - 1)} disabled={page === 1} aria-label="Previous page"><CaretLeft size={14} /></button>
            <span>Page <b>{page}</b> of <b>{pages}</b></span>
            <button type="button" onClick={() => setAt(page + 1)} disabled={page === pages} aria-label="Next page"><CaretRight size={14} /></button>
            <button type="button" onClick={() => setAt(pages)} disabled={page === pages} aria-label="Last page"><CaretDoubleRight size={14} /></button>
          </div>
        </div>
      )}
    </div>
  );
}
