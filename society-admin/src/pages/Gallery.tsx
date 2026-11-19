import { confirmBox } from '../lib/dialog';
import { ArrowLeft, Check, Eye, EyeSlash, Images, PencilSimple, Plus, Star, Trash, UploadSimple } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useToast } from '../components/toast-context';
import { Empty, PageHead, Pill, Stat } from '../components/ui';
import { api, API_URL, ApiError, LIVE, upload } from '../lib/api';
import { association } from '../lib/live';

/* Community moments: photo albums the office shares with residents. An album appears on the home
   screen of the resident app once it is shown and has at least one photo. Connected mode only. */

const A = () => `/v1/admin/${association()}/gallery`;
type Photo = { id: string; path: string; caption: string };
type Album = { id: string; title: string; description: string; eventDate: string; published: boolean; createdBy: string; createdAt: string; count: number; cover: string | null; coverPhotoId: string | null; photos: Photo[] };
type Draft = { title: string; description: string; eventDate: string };
const src = (path: string) => API_URL + path;
const pad = (n: number) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const longDay = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const small = { fontSize: 12, color: 'var(--ink3)' } as const;
const MAX_MB = 8;

export function Gallery() {
  const toast = useToast();
  const [list, setList] = useState<Album[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [edit, setEdit] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  const fail = useCallback((e: unknown) => toast(e instanceof ApiError ? e.message : 'Something went wrong.', undefined, 'warn'), [toast]);

  const load = useCallback(() => { if (LIVE) api<Album[]>('GET', A()).then(setList).catch(fail); }, [fail]);
  useEffect(load, [load]);
  /** put the album the server just answered with into the list */
  const keep = (a: Album) => setList(l => (l ?? []).map(x => (x.id === a.id ? a : x)));

  const open = list?.find(a => a.id === openId) ?? null;

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft || busy) return;
    setBusy(true);
    try {
      const a = await api<Album>('POST', A(), { ...draft, title: draft.title.trim(), description: draft.description.trim() });
      setList(l => [a, ...(l ?? [])]); setDraft(null); setOpenId(a.id);
      toast('Album created', 'Add photos to it. Residents see it once it has at least one.');
    } catch (err) { fail(err); }
    setBusy(false);
  };

  /** upload each chosen file, then add them all to the album; one bad file does not stop the rest */
  const addFiles = async (files: FileList | null) => {
    if (!open || !files?.length || busy) return;
    const chosen = [...files];
    setBusy(true);
    const urls: string[] = [], skipped: string[] = [];
    for (const [i, f] of chosen.entries()) {
      setProgress(`Uploading ${i + 1} of ${chosen.length}…`);
      if (!f.type.startsWith('image/')) { skipped.push(`${f.name} is not a photo`); continue; }
      if (f.size > MAX_MB * 1024 * 1024) { skipped.push(`${f.name} is larger than ${MAX_MB} MB`); continue; }
      try { urls.push(await upload(f)); } catch (err) { skipped.push(`${f.name}: ${err instanceof ApiError ? err.message : 'upload failed'}`); }
    }
    try {
      // the server takes 30 at a time
      let now: Album | null = null;
      for (let i = 0; i < urls.length; i += 30) now = await api<Album>('POST', `${A()}/${open.id}/photos`, { photos: urls.slice(i, i + 30) });
      if (now) keep(now);
      if (urls.length) toast(`${urls.length} photo${urls.length === 1 ? '' : 's'} added`, open.published ? 'Residents can see them in the app now.' : 'The album is hidden, so residents can’t see them yet.');
      if (skipped.length) toast(`${skipped.length} file${skipped.length === 1 ? ' was' : 's were'} not added`, skipped.slice(0, 2).join(' · '), 'warn');
    } catch (err) { fail(err); }
    setProgress(''); setBusy(false);
    if (picker.current) picker.current.value = '';
  };

  const save = async (patch: Partial<Draft> & { published?: boolean; coverPhotoId?: string }, said: string, sub?: string) => {
    if (!open) return;
    try { keep(await api<Album>('PUT', `${A()}/${open.id}`, patch)); toast(said, sub); return true; } catch (err) { fail(err); return false; }
  };
  const saveDetails = async (e: FormEvent) => {
    e.preventDefault();
    if (!edit) return;
    if (await save({ title: edit.title.trim(), description: edit.description.trim(), eventDate: edit.eventDate }, 'Album updated')) setEdit(null);
  };
  const removeAlbum = async (a: Album) => {
    if (!(await confirmBox(`Delete “${a.title}”?${a.count ? ` Its ${a.count} photo${a.count === 1 ? '' : 's'} will be deleted with it.` : ''} This cannot be undone.`))) return;
    try { await api('DELETE', `${A()}/${a.id}`); setList(l => (l ?? []).filter(x => x.id !== a.id)); setOpenId(null); toast('Album deleted', 'It has been removed from the app.'); } catch (err) { fail(err); }
  };
  const removePhoto = async (p: Photo) => {
    if (!open || !(await confirmBox('Remove this photo from the album?'))) return;
    try { keep(await api<Album>('DELETE', `${A()}/${open.id}/photos/${p.id}`)); toast('Photo removed'); } catch (err) { fail(err); }
  };
  const caption = async (p: Photo, text: string) => {
    if (!open || text.trim() === p.caption) return;
    try { keep(await api<Album>('PUT', `${A()}/${open.id}/photos/${p.id}`, { caption: text.trim() })); } catch (err) { fail(err); }
  };

  if (!LIVE) return <><PageHead title="Gallery" sub="Share photos of society events with residents" /><Empty icon={Images} title="Available when connected" body="Albums and photos are kept on the server, so this page works only in the connected console." /></>;

  /* ---------- one album ---------- */
  if (open) {
    return (
      <>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
          <button className="a-btn ghost" onClick={() => { setOpenId(null); setEdit(null); }}><ArrowLeft size={15} />All albums</button>
          <span style={{ flex: 1 }} />
          <button className="a-btn ghost" onClick={() => setEdit(edit ? null : { title: open.title, description: open.description, eventDate: open.eventDate })}><PencilSimple size={15} />Edit details</button>
          <button className="a-btn ghost" onClick={() => save({ published: !open.published }, open.published ? 'Album hidden' : 'Album shown', open.published ? 'Residents no longer see it in the app.' : open.count ? 'Residents can see it in the app now.' : 'It appears in the app once it has a photo.')}>
            {open.published ? <><EyeSlash size={15} />Hide from residents</> : <><Eye size={15} />Show to residents</>}
          </button>
          <button className="a-btn ghost danger" style={{ marginLeft: 0 }} onClick={() => removeAlbum(open)}><Trash size={15} />Delete album</button>
        </div>

        <div className="card" style={{ marginBottom: 12 }}>
          {edit ? (
            <form onSubmit={saveDetails} style={{ display: 'grid', gap: 10 }}>
              <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                <label>Album name<input className="a-in" value={edit.title} maxLength={60} onChange={e => setEdit({ ...edit, title: e.target.value })} autoFocus /></label>
                <label>Date of the event<input className="a-in" type="date" value={edit.eventDate} max={today()} onChange={e => setEdit({ ...edit, eventDate: e.target.value })} /></label>
              </div>
              <label>A line about it (optional)<input className="a-in" value={edit.description} maxLength={300} onChange={e => setEdit({ ...edit, description: e.target.value })} /></label>
              <div style={{ display: 'flex', gap: 8 }}><button className="a-btn" disabled={edit.title.trim().length < 3 || !edit.eventDate}><Check size={15} />Save</button><button type="button" className="a-btn ghost" onClick={() => setEdit(null)}>Cancel</button></div>
            </form>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <b style={{ fontSize: 17 }}>{open.title}</b>
                <Pill tone={!open.published ? 'dim' : open.count ? 'good' : 'warn'}>{!open.published ? 'Hidden' : open.count ? 'Visible to residents' : 'Not visible yet — add a photo'}</Pill>
              </div>
              <div style={{ ...small, marginTop: 5 }}>{longDay(open.eventDate)} · {open.count} photo{open.count === 1 ? '' : 's'} · created by {open.createdBy || 'the office'}</div>
              {open.description && <div style={{ fontSize: 13, color: 'var(--ink2)', marginTop: 8 }}>{open.description}</div>}
            </>
          )}
        </div>

        <div className="card">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
            <b>Photos</b>
            <span style={small}>JPEG, PNG or WebP, up to {MAX_MB} MB each. You can choose several at once.</span>
            <span style={{ flex: 1 }} />
            {progress && <span style={small}>{progress}</span>}
            <input ref={picker} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={e => void addFiles(e.target.files)} />
            <button className="a-btn" disabled={busy} onClick={() => picker.current?.click()}><UploadSimple size={15} />{busy ? 'Uploading…' : 'Add photos'}</button>
          </div>
          {open.photos.length === 0 ? <Empty icon={Images} title="No photos yet" body="Add the first photos. The album appears in the resident app as soon as it has one." /> : (
            <div className="gal-grid">
              {open.photos.map(p => {
                const isCover = p.id === open.coverPhotoId;
                return (
                  <figure key={p.id} className={'gal-photo' + (isCover ? ' cover' : '')}>
                    <a href={src(p.path)} target="_blank" rel="noreferrer"><img src={src(p.path)} alt={p.caption || open.title} loading="lazy" /></a>
                    {isCover && <span className="gal-badge"><Star size={11} weight="fill" />Cover</span>}
                    <figcaption>
                      <input className="a-in" defaultValue={p.caption} maxLength={120} placeholder="Add a caption" aria-label="Caption" onBlur={e => void caption(p, e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
                      <div className="gal-acts">
                        {!isCover && <button className="a-btn ghost xs" onClick={() => save({ coverPhotoId: p.id }, 'Cover photo changed', 'This photo now represents the album in the app.')}><Star size={12} />Make cover</button>}
                        <button className="a-btn ghost xs danger" onClick={() => removePhoto(p)}><Trash size={12} />Remove</button>
                      </div>
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          )}
        </div>
      </>
    );
  }

  /* ---------- all albums ---------- */
  const rows = list ?? [], shown = rows.filter(a => a.published && a.count > 0);
  return (
    <>
      <PageHead title="Gallery" sub="Share photos of society events. Albums appear under “Community moments” on the home screen of the resident app."
        actions={!draft && <button className="a-btn" onClick={() => setDraft({ title: '', description: '', eventDate: today() })}><Plus size={15} />New album</button>} />

      <div className="stats">
        <Stat icon={Images} label="Albums" value={rows.length} />
        <Stat label="Visible to residents" value={shown.length} tone={shown.length ? 'good' : undefined} />
        <Stat label="Hidden or empty" value={rows.length - shown.length} tone={rows.length > shown.length ? 'warn' : undefined} />
        <Stat label="Photos shared" value={shown.reduce((n, a) => n + a.count, 0)} />
      </div>

      {draft && (
        <form onSubmit={create} className="card" style={{ display: 'grid', gap: 10, marginBottom: 12 }}>
          <b>New album</b>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <label>Album name<input className="a-in" value={draft.title} maxLength={60} onChange={e => setDraft({ ...draft, title: e.target.value })} placeholder="e.g. Diwali evening at the clubhouse" autoFocus /></label>
            <label>Date of the event<input className="a-in" type="date" value={draft.eventDate} max={today()} onChange={e => setDraft({ ...draft, eventDate: e.target.value })} /></label>
          </div>
          <label>A line about it (optional)<input className="a-in" value={draft.description} maxLength={300} onChange={e => setDraft({ ...draft, description: e.target.value })} placeholder="Who organised it, what happened" /></label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button className="a-btn" disabled={busy || draft.title.trim().length < 3 || !draft.eventDate}><Plus size={15} />Create and add photos</button>
            <button type="button" className="a-btn ghost" onClick={() => setDraft(null)}>Cancel</button>
            <span style={small}>Residents are notified once, when the album first has photos.</span>
          </div>
        </form>
      )}

      {list && rows.length === 0 && !draft ? <Empty icon={Images} title="No albums yet" body="Create an album after an event and add its photos. Until then, the Community moments section stays hidden in the resident app." /> : (
        <div className="gal-albums">
          {rows.map(a => (
            <button key={a.id} className="gal-album" onClick={() => setOpenId(a.id)}>
              <span className="gal-cover">
                {a.cover ? <img src={src(a.cover)} alt="" loading="lazy" /> : <Images size={30} />}
                <span className="gal-count"><Images size={12} />{a.count}</span>
              </span>
              <span className="gal-meta">
                <b>{a.title}</b>
                <span>{longDay(a.eventDate)}</span>
                <Pill tone={!a.published ? 'dim' : a.count ? 'good' : 'warn'}>{!a.published ? 'Hidden' : a.count ? 'Visible to residents' : 'Empty — not visible'}</Pill>
              </span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
