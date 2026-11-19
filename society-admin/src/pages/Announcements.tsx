import { confirmBox } from '../lib/dialog';
import { CheckCircle, Eye, Megaphone, PaperPlaneTilt, PencilSimple, PencilSimpleLine, SealCheck, Trash, UsersThree, WarningCircle } from '@phosphor-icons/react';
import { useCallback, useState } from 'react';
import { TableCard } from '../components/TableCard';
import { Drawer, Empty, Facts, IconTile, PageHead, PanelHead, Pill, Stat, IconBtn } from '../components/ui';
import { useStore } from '../store/context';
import type { Announcement } from '../store/data';

const AUDIENCES = ['All residents', 'Towers 4 & 5', 'Committee only'];
const TITLE_MAX = 120, BODY_MAX = 4000;

/** "61%" in the demo; connected to the API, the residents who acknowledged and their share */
const reach = (a: Announcement) => (a.acks === undefined ? `${a.read}% read` : `${a.acks} acknowledged · ${a.read}%`);
/** connected, the only reach the server counts is acknowledgements — a notice that never asked for one has nothing to show */
const tracked = (a: Announcement) => a.acks === undefined || a.ack || a.acks > 0;

export function Announcements() {
  const { state, actions } = useStore();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [aud, setAud] = useState(AUDIENCES[0]);
  const [pri, setPri] = useState<'Normal' | 'High'>('Normal');
  const [openId, setOpenId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const close = useCallback(() => setOpenId(null), []);

  const list = state.announcements;
  const shown = list.find(a => a.id === openId);
  const measured = list.filter(tracked);
  const avg = Math.round(measured.reduce((a, x) => a + x.read, 0) / Math.max(1, measured.length));
  const low = measured.filter(a => a.read < 50);
  const live = list.some(a => a.acks !== undefined);

  const editing = list.find(a => a.id === editId);
  const clear = () => { setTitle(''); setBody(''); setPri('Normal'); setAud(AUDIENCES[0]); setEditId(null); };
  const publish = () => {
    const ok = editing
      ? actions.editAnnouncement(editing.id, { title: title.trim(), body: body.trim(), pri })
      : actions.publishAnnouncement({ title: title.trim(), body: body.trim(), aud, pri });
    if (ok) clear();
  };
  const startEdit = (a: Announcement) => { setEditId(a.id); setTitle(a.title); setBody(a.body); setPri(a.pri); setAud(a.aud); setOpenId(null); };
  const remove = async (a: Announcement) => {
    if (!(await confirmBox(`Delete “${a.title}”? It is removed from the resident app${a.acks ? `, along with its ${a.acks} acknowledgement${a.acks === 1 ? '' : 's'}` : ''}. This cannot be undone.`))) return;
    if (editId === a.id) clear();
    setOpenId(null);
    actions.deleteAnnouncement(a.id);
  };

  return (
    <>
      <PageHead title="Announcements" sub="Published notices reach the resident home screen with an in-app notification. High-priority notices ask every resident to acknowledge them — open a notice to see how far it has reached." />
      <div className="stats">
        <Stat icon={Megaphone} label="Published" value={list.length} />
        <Stat icon={WarningCircle} label="High priority" value={list.filter(a => a.pri === 'High').length} tone={list.some(a => a.pri === 'High') ? 'bad' : undefined} />
        <Stat icon={SealCheck} label="Need acknowledgement" value={list.filter(a => a.ack).length} />
        <Stat icon={Eye} label={live ? 'Avg acknowledged' : 'Avg read rate'} value={avg + '%'} tone={avg >= 50 ? 'good' : 'warn'} />
        <Stat icon={CheckCircle} label="Below 50% reach" value={low.length} tone={low.length ? 'warn' : undefined} />
      </div>
      <div className="grid2">
        <TableCard rows={list} noun="announcement" search={a => [a.id, a.title, a.body, a.by, a.aud]} placeholder="Search notices by title, text or author"
          filters={[{ key: 'pri', label: 'Priority', get: a => a.pri, options: ['High', 'Normal'] }, { key: 'aud', label: 'Audience', get: a => a.aud }]}
          sorts={[{ label: 'Lowest reach first', by: a => a.read }, { label: 'Highest reach first', by: a => a.read, dir: 'desc' }]}
          csv={{ name: 'announcements', head: ['Ref', 'Title', 'Message', 'Priority', 'Audience', 'Published by', 'Published', 'Needs acknowledgement', live ? 'Acknowledged %' : 'Read %'], row: a => [a.id, a.title, a.body, a.pri, a.aud, a.by, a.when, a.ack ? 'Yes' : 'No', a.read] }}>{(page, sl) => (<div className="a-tbl-wrap">
          <table className="a-tbl compact">
            <tbody>
              <tr><th className="sl">Sl. no.</th><th>Announcement</th><th>Audience</th><th>{live ? 'Acknowledged' : 'Read'}</th><th>Manage</th></tr>
              {page.map((a, rowNo) => (
                <tr key={a.id} className="rowbtn" tabIndex={0} onClick={() => setOpenId(a.id)} onKeyDown={e => { if (e.key === 'Enter') setOpenId(a.id); }}>
                  <td className="sl num">{sl(rowNo)}</td>
                  <td style={{ whiteSpace: 'normal' }}>
                    <span className="who-cell">
                      <IconTile icon={a.pri === 'High' ? WarningCircle : Megaphone} tone={a.pri === 'High' ? 'bad' : 'acc'} />
                      <span>
                        <span className="cell-t">{a.title}</span>
                        <span className="cell-m" style={{ display: 'block' }}><span className="num">{a.id}</span> · {a.by} · {a.when}{a.pri === 'High' && <> · <Pill tone="bad">High</Pill></>}{a.ack && <> · <Pill tone="dim">Ack required</Pill></>}</span>
                      </span>
                    </span>
                  </td>
                  <td data-l="Audience"><span className="aud"><UsersThree size={15} />{a.aud}</span></td>
                  <td data-l={live ? 'Acknowledged' : 'Read'}>
                    {tracked(a)
                      ? <span className="readbar"><span className="prog"><i style={{ width: a.read + '%', background: a.read < 50 ? 'var(--warn)' : 'var(--acc)' }} /></span><b className="num">{a.read}%</b></span>
                      : <span className="cell-m">Not asked</span>}
                  </td>
                  <td data-l="Manage" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
                    <span style={{ display: 'flex', gap: 6 }}>
                      <IconBtn icon={PencilSimple} label="Edit" onClick={() => startEdit(a)} />
                      <IconBtn icon={Trash} label="Delete" tone="danger" onClick={() => remove(a)} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!list.length && <Empty icon={Megaphone} title="Nothing published yet" body="Write the first notice on the right." />}
        </div>)}</TableCard>

        <div className="panel">
          <PanelHead icon={PencilSimpleLine} title={editing ? 'Edit ' + editing.id : 'New announcement'} sub={editing ? 'Residents see the new wording — nobody is notified again' : 'Publishes instantly to the resident app'} />
          <label style={{ marginBottom: 8 }}>Title<input className="a-in" value={title} maxLength={TITLE_MAX} onChange={e => setTitle(e.target.value)} placeholder="e.g. Water supply maintenance — Wed 2 Sep" /></label>
          <label>Message<textarea className="a-in" value={body} maxLength={BODY_MAX} onChange={e => setBody(e.target.value)} placeholder="What is happening, when, and what residents should do…" style={{ minHeight: 110 }} /></label>
          <div className="count num">{body.length.toLocaleString('en-IN')} / {BODY_MAX.toLocaleString('en-IN')}</div>
          <div className="form-grid" style={{ margin: '4px 0 0' }}>
            <label>Audience<select className="a-in" value={aud} disabled={!!editing} title={editing ? 'The audience of a published notice cannot be changed' : undefined} onChange={e => setAud(e.target.value)}>{(editing && !AUDIENCES.includes(aud) ? [aud, ...AUDIENCES] : AUDIENCES).map(o => <option key={o}>{o}</option>)}</select></label>
            <label>Priority<select className="a-in" value={pri} onChange={e => setPri(e.target.value as 'Normal' | 'High')}><option>Normal</option><option>High</option></select></label>
          </div>
          {(title || body) && (
            <div className="preview">
              <div className="lbl">How residents will see it</div>
              <div className="who-cell" style={{ alignItems: 'flex-start' }}>
                <IconTile icon={pri === 'High' ? WarningCircle : Megaphone} tone={pri === 'High' ? 'bad' : 'acc'} />
                <span style={{ minWidth: 0 }}><b>{title || 'Title'}</b><p>{body || 'Your message…'}</p></span>
              </div>
            </div>
          )}
          <div className="flow-note" style={{ margin: '10px 0' }}>
            {pri === 'High' ? <><b>High priority:</b> residents are asked to acknowledge it, and you can track who has.</> : <>Normal notices appear on the home screen without asking for an acknowledgement.</>}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="a-btn" onClick={publish} disabled={title.trim().length < 3 || body.trim().length < 3}><PaperPlaneTilt size={14} />{editing ? 'Save changes' : 'Publish to ' + aud.toLowerCase()}</button>
            {editing && <button className="a-btn ghost" onClick={clear}>Cancel</button>}
          </div>
          <div className="flow-note">For scheduled notices, attachments, email, and targeting by tower or flat, use <b>Communication</b>.</div>
        </div>
      </div>

      {shown && (
        <Drawer label={shown.title} onClose={close}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Pill tone={shown.pri === 'High' ? 'bad' : 'acc'}>{shown.pri} priority</Pill>
            {shown.ack && <Pill tone="dim">Acknowledgement required</Pill>}
          </div>
          <h2>{shown.title}</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="a-btn ghost sm" onClick={() => startEdit(shown)}><PencilSimple size={13} />Edit</button>
            <button className="a-btn ghost sm danger" onClick={() => remove(shown)}><Trash size={13} />Delete</button>
          </div>
          <div className="num" style={{ fontSize: 12, color: 'var(--ink3)' }}>{shown.id} · published {shown.when}</div>
          <div className="d-body">{shown.body}</div>
          <Facts items={{
            'Published by': shown.by,
            Audience: shown.aud,
            Published: shown.when,
            [live ? 'Acknowledged' : 'Read']: tracked(shown) ? <span className="num">{reach(shown)}</span> : 'Not asked',
          }} />
          {tracked(shown) ? (
            <>
              <h3 className="d-h"><Eye size={17} />Reach</h3>
              <div className="prog" style={{ height: 10 }}><i style={{ width: shown.read + '%', background: shown.read < 50 ? 'var(--warn)' : 'var(--good)' }} /></div>
              <div style={{ fontSize: 12.5, color: 'var(--ink2)', marginTop: 8 }}>
                {shown.read >= 80 ? 'Most residents have seen this.' : shown.read >= 50 ? 'More than half of the residents have seen this.' : shown.ack ? 'Fewer than half have acknowledged it — consider a reminder from Communication.' : 'Fewer than half have seen it so far.'}
              </div>
              <div className="flow-note">{live ? 'The share is the residents who acknowledged the notice, out of all residents on the app.' : 'Read rates update as residents open the notice in the app.'}</div>
            </>
          ) : <div className="flow-note">This notice did not ask for an acknowledgement, so there is no reach to measure. Publish as <b>High</b> priority to track who has seen a notice.</div>}
        </Drawer>
      )}
    </>
  );
}
