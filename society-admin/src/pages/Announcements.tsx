import { Megaphone, PaperPlaneTilt, PencilSimpleLine, UsersThree, WarningCircle } from '@phosphor-icons/react';
import { useState } from 'react';
import { IconTile, PageHead, PanelHead, Pill } from '../components/ui';
import { useStore } from '../store/context';

const AUDIENCES = ['All residents', 'Towers 4 & 5', 'Committee only'];

export function Announcements() {
  const { state, actions } = useStore();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [aud, setAud] = useState(AUDIENCES[0]);
  const [pri, setPri] = useState<'Normal' | 'High'>('Normal');

  const publish = () => {
    if (actions.publishAnnouncement({ title: title.trim(), body: body.trim(), aud, pri })) {
      setTitle(''); setBody(''); setPri('Normal');
    }
  };

  return (
    <>
      <PageHead title="Announcements" sub="Published notices reach the resident home screen and send a privacy-safe push. High-priority notices can require acknowledgement." />
      <div className="grid2">
        <div>
          <div className="a-tbl-wrap">
            <table className="a-tbl compact">
              <tbody>
                <tr><th>Announcement</th><th>Audience</th><th>Read</th></tr>
                {state.announcements.map(a => (
                  <tr key={a.id}>
                    <td>
                      <span className="who-cell">
                        <IconTile icon={a.pri === 'High' ? WarningCircle : Megaphone} tone={a.pri === 'High' ? 'bad' : 'acc'} />
                        <span>
                          <b style={{ color: 'var(--ink)' }}>{a.title}</b>
                          <span className="cell-m" style={{ display: 'block' }}>{a.by} · {a.when}{a.pri === 'High' && <> · <Pill tone="bad">High</Pill></>}</span>
                        </span>
                      </span>
                    </td>
                    <td data-l="Audience"><span className="aud"><UsersThree size={15} />{a.aud}</span></td>
                    <td data-l="Read">
                      <span className="readbar"><span className="prog"><i style={{ width: a.read + '%', background: a.read < 50 ? 'var(--warn)' : 'var(--acc)' }} /></span><b className="num">{a.read}%</b></span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="panel">
          <PanelHead icon={PencilSimpleLine} title="New announcement" sub="Publishes instantly to the resident app" />
          <input className="a-in" value={title} onChange={e => setTitle(e.target.value)} placeholder="Title" style={{ marginBottom: 8 }} aria-label="Title" />
          <textarea className="a-in" value={body} onChange={e => setBody(e.target.value)} placeholder="Message…" style={{ marginBottom: 8 }} aria-label="Message" />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <select className="a-in" value={aud} onChange={e => setAud(e.target.value)} aria-label="Audience">
              {AUDIENCES.map(o => <option key={o}>{o}</option>)}
            </select>
            <select className="a-in" value={pri} onChange={e => setPri(e.target.value as 'Normal' | 'High')} aria-label="Priority">
              <option>Normal</option><option>High</option>
            </select>
          </div>
          <button className="a-btn" onClick={publish}><PaperPlaneTilt size={14} />Publish</button>
          <div className="flow-note">Real build: schedule, expiry, attachments, acknowledgement tracking and per-block targeting.</div>
        </div>
      </div>
    </>
  );
}
