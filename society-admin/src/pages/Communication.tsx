import { confirmBox } from '../lib/dialog';
import { ChatsCircle, CheckCircle, Clock, Envelope, PaperPlaneTilt, PushPin, WarningCircle } from '@phosphor-icons/react';
import { TableCard } from '../components/TableCard';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useToast } from '../components/toast-context';
import { Empty, PageHead, Pill, Stat } from '../components/ui';
import { ApiError, LIVE } from '../lib/api';
import {
  attach, audienceInfo, board, cancel, CHANNEL_NAME, CHANNELS, conversations, countAudience, create, message, messages, polish, reply, report,
  sendNow, setStatus, startConversation, thread, time, TYPES,
  type Audience, type AudienceInfo, type Channel, type Conversation, type Delivery, type Draft, type Filter, type Message, type MessageType, type Report, type Thread,
} from '../lib/comms';

type Tab = 'messages' | 'compose' | 'inbox';
type Fail = (e: unknown) => void;
const STATUS_TONE = { Draft: 'dim', Scheduled: 'acc', Sent: 'good', Cancelled: 'dim' } as const;
const DELIVERY_TONE = { Delivered: 'good', Sent: 'good', Logged: 'warn', Skipped: 'dim', Failed: 'bad' } as const;
const TOPICS = ['General', 'Rent & dues', 'Maintenance', 'Documents', 'Complaint'];
const grid = { display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', alignItems: 'end' } as const;
const small = { fontSize: 12, color: 'var(--ink3)' } as const;
/** a date-time input's value (local) as an ISO instant */
const iso = (local: string) => (local ? new Date(local).toISOString() : null);

/* ------------------------------------------------------------------ compose */
function Compose({ fail, onSent }: { fail: Fail; onSent: () => void }) {
  const toast = useToast();
  const [info, setInfo] = useState<AudienceInfo | null>(null);
  const [type, setType] = useState<MessageType>('Notice');
  const [priority, setPriority] = useState<Draft['priority']>('Normal');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [tone, setTone] = useState('Clear');
  const [channels, setChannels] = useState<Channel[]>(['portal', 'push']);
  const [kind, setKind] = useState<Audience['kind']>('all');
  const [towers, setTowers] = useState<string[]>([]);
  const [role, setRole] = useState<'Owner' | 'Tenant' | 'Family'>('Owner');
  const [picked, setPicked] = useState<string[]>([]); // flat ids or resident ids, by kind
  const [find, setFind] = useState('');
  /* how many people the chosen audience reaches — kept with the audience it answers */
  const [reach, setReach] = useState<{ key: string; residents: number; withEmail: number; withPhone: number; label: string } | null>(null);
  const [file, setFile] = useState<{ url: string; name: string } | null>(null);
  const [pinned, setPinned] = useState(false);
  const [ack, setAck] = useState(false);
  const [promo, setPromo] = useState(false);
  const [starts, setStarts] = useState('');
  const [expires, setExpires] = useState('');
  const [when, setWhen] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { audienceInfo().then(setInfo).catch(fail); }, [fail]);

  const audience: Audience | null = kind === 'all' ? { kind } : kind === 'towers' ? (towers.length ? { kind, towers } : null) : kind === 'role' ? { kind, role }
    : kind === 'units' ? (picked.length ? { kind, unitIds: picked } : null) : (picked.length ? { kind, userIds: picked } : null);
  const key = JSON.stringify(audience);
  useEffect(() => {
    const a = JSON.parse(key) as Audience | null;
    if (!a) return;
    countAudience(a).then(r => setReach({ key, ...r })).catch(() => {});
  }, [key]);
  const shown = audience && reach?.key === key ? reach : null;

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);
  const tidy = () => {
    if (body.trim().length < 5) { toast('Write a rough version first.', undefined, 'warn'); return; }
    polish(body.trim(), tone).then(r => { setBody(r.text); toast('Rewritten', r.by === 'ai' ? 'By the AI model — read it before sending.' : 'By the built-in rules (no AI key on the server).'); }).catch(fail);
  };
  const pickFile = (f: File | undefined) => {
    if (!f) return;
    attach(f).then(url => setFile({ url, name: f.name })).catch(fail);
  };

  const submit = (action: Draft['action']) => async (e?: FormEvent) => {
    e?.preventDefault();
    if (title.trim().length < 3 || body.trim().length < 3) { toast('Give the message a subject and a body.', undefined, 'warn'); return; }
    if (!channels.length) { toast('Choose at least one channel.', undefined, 'warn'); return; }
    if (!audience) { toast('Choose who should receive it.', undefined, 'warn'); return; }
    if (action === 'schedule' && !when) { toast('Choose when to send it.', undefined, 'warn'); return; }
    if (action === 'send' && type === 'Emergency' && !(await confirmBox(`Send this emergency alert to ${shown?.residents ?? 'all'} residents now?`))) return;
    setBusy(true);
    create({ type, title: title.trim(), body: body.trim(), priority, channels, audience, attachmentUrl: file?.url, attachmentName: file?.name, promotional: promo, requiresAck: ack,
      startsAt: iso(starts), expiresAt: iso(expires), pinned, action, scheduledAt: action === 'schedule' ? iso(when) : null })
      .then(m => {
        toast(action === 'send' ? `${m.ref} sent to ${m.stats.recipients} residents` : action === 'schedule' ? `${m.ref} scheduled` : `${m.ref} saved as a draft`,
          action === 'send' && m.stats.failed + m.stats.skipped + m.stats.logged ? 'Some copies did not go out — open the message to see why.' : undefined);
        setTitle(''); setBody(''); setFile(null); setPinned(false); setAck(false); setPromo(false); setStarts(''); setExpires(''); setWhen('');
        onSent();
      }).catch(fail).finally(() => setBusy(false));
  };

  const needle = find.trim().toLowerCase();
  const onBoard = channels.includes('portal');
  return (
    <form onSubmit={submit('send')} style={{ display: 'grid', gap: 14 }}>
      <div className="card" style={grid}>
        <label>Type<select className="a-in" value={type} onChange={e => { const v = e.target.value as MessageType; setType(v); if (v === 'Emergency') setPriority('Emergency'); if (v === 'Offer') setPromo(true); }}>{TYPES.map(t => <option key={t}>{t}</option>)}</select></label>
        <label>Priority<select className="a-in" value={priority} onChange={e => setPriority(e.target.value as Draft['priority'])}>{['Normal', 'Important', 'Emergency'].map(p => <option key={p}>{p}</option>)}</select></label>
        <label style={{ gridColumn: '1 / -1' }}>Subject<input className="a-in" value={title} onChange={e => setTitle(e.target.value)} maxLength={120} placeholder="What it is about, in a few words" /></label>
        <label style={{ gridColumn: '1 / -1' }}>Message<textarea className="a-in" rows={6} value={body} onChange={e => setBody(e.target.value)} maxLength={4000} placeholder="Write the message. Replace anything in [brackets] before sending." /></label>
        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select className="a-in" style={{ width: 130 }} value={tone} onChange={e => setTone(e.target.value)} aria-label="Tone">{['Clear', 'Friendly', 'Formal', 'Urgent'].map(t => <option key={t}>{t}</option>)}</select>
          <button type="button" className="a-btn ghost" onClick={tidy}>Rewrite in this tone</button>
          <label className="a-btn ghost" style={{ cursor: 'pointer' }}>{file ? 'Replace attachment' : 'Attach a PDF or image'}<input type="file" accept="application/pdf,image/*" hidden onChange={e => pickFile(e.target.files?.[0])} /></label>
          {file && <span style={small}><a href={file.url} target="_blank" rel="noreferrer">{file.name}</a> · <button type="button" onClick={() => setFile(null)} style={{ color: 'var(--bad)' }}>remove</button></span>}
          {/\[[^\]]+\]/.test(title + body) && <span style={{ fontSize: 12, color: 'var(--warn)' }}>There is still text in [brackets] to fill in.</span>}
        </div>
      </div>

      <div className="card">
        <b>Who receives it</b>
        <div style={{ ...grid, marginTop: 8 }}>
          <label>Audience<select className="a-in" value={kind} onChange={e => { setKind(e.target.value as Audience['kind']); setPicked([]); setFind(''); }}>
            <option value="all">All residents</option><option value="towers">By block / tower</option><option value="role">Owners or tenants</option><option value="units">Chosen flats</option><option value="residents">Chosen residents</option>
          </select></label>
          {kind === 'role' && <label>Who<select className="a-in" value={role} onChange={e => setRole(e.target.value as typeof role)}>{(info?.roles ?? []).map(r => <option key={r.role} value={r.role}>{r.role === 'Family' ? 'Family members' : r.role + 's'} ({r.residents})</option>)}</select></label>}
          {(kind === 'units' || kind === 'residents') && <label>Find<input className="a-in" value={find} onChange={e => setFind(e.target.value)} placeholder={kind === 'units' ? 'Flat number' : 'Name or flat'} /></label>}
        </div>
        {kind === 'towers' && <div className="pick">{(info?.towers ?? []).map(t => <label key={t.name}><input type="checkbox" checked={towers.includes(t.name)} onChange={() => setTowers(toggle(towers, t.name))} /> {t.name} <span style={small}>({t.residents})</span></label>)}</div>}
        {kind === 'units' && <div className="pick">{(info?.units ?? []).filter(u => !needle || u.code.toLowerCase().includes(needle)).slice(0, 80).map(u => <label key={u.id}><input type="checkbox" checked={picked.includes(u.id)} onChange={() => setPicked(toggle(picked, u.id))} /> {u.code} <span style={small}>({u.residents})</span></label>)}</div>}
        {kind === 'residents' && <div className="pick">{(info?.residents ?? []).filter(r => !needle || (r.name + ' ' + r.unit).toLowerCase().includes(needle)).slice(0, 80).map(r => <label key={r.id}><input type="checkbox" checked={picked.includes(r.id)} onChange={() => setPicked(toggle(picked, r.id))} /> {r.name} <span style={small}>{r.unit}</span></label>)}</div>}
        <div style={{ marginTop: 10, fontSize: 13 }}>
          {shown ? <><b>{shown.residents}</b> resident{shown.residents === 1 ? '' : 's'} · {shown.label} <span style={small}>· {shown.withPhone} with a mobile number, {shown.withEmail} with an email</span></> : <span style={small}>Choose at least one to see who it reaches.</span>}
        </div>
      </div>

      <div className="card">
        <b>How it is sent</b>
        <div className="pick" style={{ marginTop: 8 }}>
          {CHANNELS.map(([k, name, note]) => <label key={k} title={note}><input type="checkbox" checked={channels.includes(k)} onChange={() => setChannels(toggle(channels, k))} /> {name} <span style={small}>— {note}</span></label>)}
        </div>
        {onBoard && (
          <div style={{ ...grid, marginTop: 12 }}>
            <label>Show on the notice board from<input className="a-in" type="datetime-local" value={starts} onChange={e => setStarts(e.target.value)} /><span style={small}>Empty: as soon as it is sent</span></label>
            <label>Take it down on<input className="a-in" type="datetime-local" value={expires} onChange={e => setExpires(e.target.value)} /><span style={small}>Empty: stays until you remove it</span></label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={pinned} onChange={e => setPinned(e.target.checked)} /> Pin to the top</label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} /> Ask residents to acknowledge</label>
          </div>
        )}
        <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 10 }}><input type="checkbox" checked={promo} onChange={e => setPromo(e.target.checked)} /> Promotional — skip residents who switched offers off</label>
      </div>

      <div className="card" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="a-btn" type="submit" disabled={busy}>{busy ? 'Sending…' : 'Send now'}</button>
        <input className="a-in" style={{ width: 220 }} type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} aria-label="Send later at" />
        <button className="a-btn ghost" type="button" disabled={busy} onClick={() => submit('schedule')()}>Schedule</button>
        <button className="a-btn ghost" type="button" disabled={busy} onClick={() => submit('draft')()}>Save as draft</button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ dashboard */
function Detail({ id, fail, changed }: { id: string; fail: Fail; changed: () => void }) {
  const toast = useToast();
  const [m, setM] = useState<(Message & { deliveries: Delivery[] }) | null>(null);
  const load = useCallback(() => { message(id).then(setM).catch(fail); }, [id, fail]);
  useEffect(load, [load]);
  if (!m) return null;
  const act = (p: Promise<unknown>, done: string) => p.then(() => { toast(done, m.ref); load(); changed(); }).catch(fail);
  // one row per resident, a column per channel
  const people = [...new Map(m.deliveries.map(d => [d.userId, d])).values()];
  return (
    <div className="card" style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <b style={{ fontSize: 15 }}>{m.ref} · {m.title}</b>
        <Pill tone={m.expired ? 'dim' : STATUS_TONE[m.status]}>{m.expired ? 'Expired' : m.status}</Pill>
        {m.pinned && !m.expired && <Pill tone="warn">Pinned</Pill>}
      </div>
      <div style={{ ...small, marginTop: 4 }}>{m.type} · {m.priority} · by {m.byName} · to {m.audienceLabel}{m.sentAt ? ' · sent ' + time(m.sentAt) : m.scheduledAt ? ' · goes out ' + time(m.scheduledAt) : ''}{m.expiresAt ? ' · ' + (m.expired ? 'taken down ' : 'on the board until ') + time(m.expiresAt) : ''}</div>
      <p style={{ whiteSpace: 'pre-wrap', margin: '10px 0', fontSize: 13.5 }}>{m.body}</p>
      {m.attachmentUrl && <div style={{ fontSize: 13 }}><a href={m.attachmentUrl} target="_blank" rel="noreferrer">{m.attachmentName || 'Attachment'}</a></div>}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
        {(m.status === 'Draft' || m.status === 'Scheduled') && <button className="a-btn" onClick={() => act(sendNow(m.id), 'Sent')}>Send now</button>}
        {(m.status === 'Draft' || m.status === 'Scheduled') && <button className="a-btn ghost" onClick={() => act(cancel(m.id), m.status === 'Draft' ? 'Draft discarded' : 'Cancelled')}>{m.status === 'Draft' ? 'Discard' : 'Cancel sending'}</button>}
        {m.status === 'Sent' && m.announcementId && !m.expired && <>
          <button className="a-btn ghost" onClick={() => act(board(m.id, { pinned: !m.pinned }), m.pinned ? 'Unpinned' : 'Pinned to the top')}>{m.pinned ? 'Unpin' : 'Pin to the top'}</button>
          <button className="a-btn ghost" onClick={() => act(board(m.id, { expireNow: true }), 'Taken off the notice board')}>Take off the board</button>
        </>}
      </div>
      {m.status === 'Sent' && (
        <>
          <div className="stats" style={{ marginTop: 14 }}>
            <Stat icon={PaperPlaneTilt} label="Residents" value={m.stats.recipients} />
            {m.stats.onBoard > 0 && <Stat icon={CheckCircle} label="Read on the board" value={`${m.stats.read} of ${m.stats.onBoard}`} tone="good" />}
            {m.stats.logged > 0 && <Stat icon={Clock} label="Logged, not sent" value={m.stats.logged} tone="warn" />}
            {m.stats.skipped > 0 && <Stat icon={Clock} label="Skipped" value={m.stats.skipped} />}
            {m.stats.failed > 0 && <Stat icon={WarningCircle} label="Failed" value={m.stats.failed} tone="bad" />}
          </div>
          <div className="a-tbl-wrap">
            <table className="a-tbl compact">
              <tbody>
                <tr><th>Resident</th>{m.channels.map(c => <th key={c}>{CHANNEL_NAME[c]}</th>)}</tr>
                {people.map(p => (
                  <tr key={p.userId}>
                    <td><span className="cell-t">{p.name}</span> <span style={small}>{p.unit}</span></td>
                    {m.channels.map(c => {
                      const d = m.deliveries.find(x => x.userId === p.userId && x.channel === c);
                      return <td key={c} data-l={CHANNEL_NAME[c]}>{d ? <><Pill tone={DELIVERY_TONE[d.status]}>{d.readAt ? 'Read' : d.status}</Pill><div style={small}>{d.readAt ? time(d.readAt) : d.detail}</div></> : '—'}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Dashboard({ fail, version }: { fail: Fail; version: number }) {
  const [rows, setRows] = useState<Message[] | null>(null);
  const [filter, setFilter] = useState<Filter>({});
  const [open, setOpen] = useState<string | null>(null);
  const [bump, setBump] = useState(0);
  useEffect(() => { messages(filter).then(setRows).catch(fail); }, [filter, fail, version, bump]);
  const set = (k: keyof Filter) => (e: { target: { value: string } }) => setFilter(f => ({ ...f, [k]: e.target.value }));
  return (
    <>
      <div className="card" style={{ ...grid, marginBottom: 12 }}>
        <label>Search<input className="a-in" value={filter.q ?? ''} onChange={set('q')} placeholder="Subject, text or audience" /></label>
        <label>Status<select className="a-in" value={filter.status ?? ''} onChange={set('status')}><option value="">All</option>{['Sent', 'Scheduled', 'Draft', 'Failed', 'Expired', 'Cancelled'].map(s => <option key={s}>{s}</option>)}</select></label>
        <label>Channel<select className="a-in" value={filter.channel ?? ''} onChange={set('channel')}><option value="">All</option>{CHANNELS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
        <label>Type<select className="a-in" value={filter.type ?? ''} onChange={set('type')}><option value="">All</option>{TYPES.map(t => <option key={t}>{t}</option>)}</select></label>
      </div>
      {rows && !rows.length ? <Empty icon={Envelope} title="No messages here" body="Nothing matches these filters. Compose a message to send your first one." /> : (
        <TableCard rows={rows ?? []} noun="message">{(page, sl) => (<div className="a-tbl-wrap">
          <table className="a-tbl">
            <tbody>
              <tr><th className="sl">Sl. no.</th><th>Message</th><th>To</th><th>Channels</th><th>Status</th><th>Reached</th><th>When</th></tr>
              {page.map((m, rowNo) => (
                <tr key={m.id} onClick={() => setOpen(open === m.id ? null : m.id)} style={{ cursor: 'pointer', background: open === m.id ? 'var(--panel2)' : undefined }}><td className="sl num">{sl(rowNo)}</td>
                  <td><span className="cell-t">{m.title}</span><div style={small}>{m.ref} · {m.type}{m.priority !== 'Normal' ? ' · ' + m.priority : ''}{m.pinned && !m.expired ? ' · pinned' : ''}</div></td>
                  <td data-l="To">{m.audienceLabel}</td>
                  <td data-l="Channels">{m.channels.map(c => CHANNEL_NAME[c]).join(', ')}</td>
                  <td data-l="Status"><Pill tone={m.expired ? 'dim' : STATUS_TONE[m.status]}>{m.expired ? 'Expired' : m.status}</Pill>{m.stats.failed > 0 && <> <Pill tone="bad">{m.stats.failed} failed</Pill></>}</td>
                  <td data-l="Reached" className="num">{m.status === 'Sent' ? <>{m.stats.recipients}{m.stats.onBoard > 0 && <div style={small}>{m.stats.read} of {m.stats.onBoard} read</div>}</> : '—'}</td>
                  <td data-l="When" className="num">{time(m.sentAt ?? m.scheduledAt ?? m.createdAt)}{m.status === 'Scheduled' && <div style={small}>scheduled</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>)}</TableCard>
      )}
      {open && <Detail key={open} id={open} fail={fail} changed={() => setBump(n => n + 1)} />}
    </>
  );
}

/* ------------------------------------------------------------------ inbox */
function Inbox({ fail }: { fail: Fail }) {
  const toast = useToast();
  const [list, setList] = useState<Conversation[] | null>(null);
  const [open, setOpen] = useState<Thread | null>(null);
  const [text, setText] = useState('');
  const [info, setInfo] = useState<AudienceInfo | null>(null);
  const [fresh, setFresh] = useState<{ userId: string; subject: string; topic: string; text: string } | null>(null);

  const load = useCallback(() => { conversations().then(setList).catch(fail); }, [fail]);
  const openId = open?.id;
  useEffect(() => {
    load();
    const h = setInterval(() => { if (document.visibilityState !== 'visible') return; load(); if (openId) thread(openId).then(setOpen).catch(() => {}); }, 12000);
    return () => clearInterval(h);
  }, [load, openId]);

  const show = (id: string) => thread(id).then(t => { setOpen(t); setFresh(null); load(); }).catch(fail);
  const send = (e: FormEvent) => {
    e.preventDefault();
    if (!open || !text.trim()) return;
    reply(open.id, text.trim()).then(t => { setOpen(t); setText(''); load(); }).catch(fail);
  };
  const begin = () => { setOpen(null); setFresh({ userId: '', subject: '', topic: 'General', text: '' }); if (!info) audienceInfo().then(setInfo).catch(fail); };
  const start = (e: FormEvent) => {
    e.preventDefault();
    if (!fresh) return;
    if (!fresh.userId || fresh.subject.trim().length < 3 || !fresh.text.trim()) { toast('Choose the resident, and give a subject and a message.', undefined, 'warn'); return; }
    startConversation({ ...fresh, subject: fresh.subject.trim(), text: fresh.text.trim() }).then(t => { setFresh(null); setOpen(t); load(); }).catch(fail);
  };

  return (
    <div className="grid2" style={{ gridTemplateColumns: 'minmax(260px, 1fr) 1.6fr' }}>
      <div>
        <button className="a-btn" onClick={begin} style={{ marginBottom: 10 }}>Message a resident</button>
        {list && !list.length && <Empty icon={ChatsCircle} title="No conversations yet" body="Residents write to the office from the app; you can also write first." />}
        <div style={{ display: 'grid', gap: 6 }}>
          {(list ?? []).map(c => (
            <button key={c.id} onClick={() => show(c.id)} className="card" style={{ textAlign: 'left', borderColor: open?.id === c.id ? 'var(--acc)' : undefined, padding: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><b style={{ fontSize: 13 }}>{c.resident} <span style={small}>{c.unit}</span></b>{c.unread > 0 ? <Pill tone="acc">{c.unread} new</Pill> : c.status === 'Closed' ? <Pill tone="dim">Closed</Pill> : null}</div>
              <div style={{ fontSize: 13, fontWeight: c.unread ? 700 : 500 }}>{c.subject}</div>
              <div style={{ ...small, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.lastFrom === 'staff' ? 'You: ' : ''}{c.preview}</div>
              <div style={small}>{c.topic} · {time(c.lastMessageAt)}</div>
            </button>
          ))}
        </div>
      </div>
      <div>
        {fresh && (
          <form onSubmit={start} className="card" style={{ display: 'grid', gap: 8 }}>
            <b>New message to a resident</b>
            <label>Resident<select className="a-in" value={fresh.userId} onChange={e => setFresh({ ...fresh, userId: e.target.value })}><option value="">Choose…</option>{(info?.residents ?? []).map(r => <option key={r.id} value={r.id}>{r.name} · {r.unit}</option>)}</select></label>
            <label>About<select className="a-in" value={fresh.topic} onChange={e => setFresh({ ...fresh, topic: e.target.value })}>{TOPICS.map(t => <option key={t}>{t}</option>)}</select></label>
            <label>Subject<input className="a-in" value={fresh.subject} onChange={e => setFresh({ ...fresh, subject: e.target.value })} maxLength={120} /></label>
            <label>Message<textarea className="a-in" rows={4} value={fresh.text} onChange={e => setFresh({ ...fresh, text: e.target.value })} maxLength={4000} /></label>
            <div style={{ display: 'flex', gap: 6 }}><button className="a-btn" type="submit">Send</button><button className="a-btn ghost" type="button" onClick={() => setFresh(null)}>Cancel</button></div>
          </form>
        )}
        {open && (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <div><b>{open.subject}</b><div style={small}>{open.resident} · {open.unit} · {open.topic}</div></div>
              <button className="a-btn ghost" onClick={() => setStatus(open.id, open.status === 'Open' ? 'Closed' : 'Open').then(t => { setOpen(t); load(); }).catch(fail)}>{open.status === 'Open' ? 'Close conversation' : 'Reopen'}</button>
            </div>
            <div style={{ display: 'grid', gap: 6, margin: '12px 0', maxHeight: 380, overflowY: 'auto' }}>
              {open.messages.map(m => (
                <div key={m.id} style={{ justifySelf: m.from === 'staff' ? 'end' : 'start', maxWidth: '84%', background: m.from === 'staff' ? 'var(--acc)' : 'var(--panel2)', color: m.from === 'staff' ? '#fff' : 'var(--ink)', borderRadius: 12, padding: '7px 11px', fontSize: 13 }}>
                  {m.from !== 'staff' && <div style={{ fontSize: 11.5, fontWeight: 700, opacity: 0.8 }}>{m.by}</div>}
                  <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
                  {m.attachmentUrl && <a href={m.attachmentUrl} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'underline' }}>Attachment</a>}
                  <div style={{ fontSize: 11, opacity: 0.75, textAlign: 'right' }}>{time(m.at)}{m.from === 'staff' && m.readAt ? ' · seen' : ''}</div>
                </div>
              ))}
            </div>
            <form onSubmit={send} style={{ display: 'flex', gap: 8 }}>
              <input className="a-in" style={{ flex: 1 }} value={text} onChange={e => setText(e.target.value)} placeholder="Reply to the resident…" aria-label="Reply to the resident" maxLength={4000} />
              <button className="a-btn" type="submit">Send</button>
            </form>
          </div>
        )}
        {!open && !fresh && list && list.length > 0 && <Empty icon={ChatsCircle} title="Choose a conversation" body="Opening one marks the resident’s messages as read." />}
      </div>
    </div>
  );
}

/** One place for everything the office sends, and everything residents write back. Connected mode only. */
export function Communication() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('messages');
  const [r, setR] = useState<Report | null>(null);
  const [unread, setUnread] = useState(0);
  const [version, setVersion] = useState(0);
  const fail = useCallback((e: unknown) => toast(e instanceof ApiError ? e.message : 'That didn’t go through.', undefined, 'warn'), [toast]);
  useEffect(() => {
    if (!LIVE) return;
    report(30).then(setR).catch(fail);
    conversations('Open').then(l => setUnread(l.reduce((n, c) => n + c.unread, 0))).catch(() => {});
  }, [fail, version, tab]);

  if (!LIVE) {
    return (
      <>
        <PageHead title="Communication" sub="Messages and conversations." />
        <Empty icon={Envelope} title="Connect the console to the API" body="Messages and their delivery records come from the server. Set VITE_API_URL to use them." />
      </>
    );
  }
  const logged = r?.byChannel.reduce((n, c) => n + c.logged, 0) ?? 0, failed = r?.byChannel.reduce((n, c) => n + c.failed, 0) ?? 0;
  return (
    <>
      <PageHead title="Communication" sub="Choose who, choose how, send — then see what reached whom and who read it. Every message stays on record." />
      <div className="stats">
        <Stat icon={PaperPlaneTilt} label="Sent (30 days)" value={r?.totals.sent ?? 0} />
        <Stat icon={Clock} label="Scheduled" value={r?.totals.scheduled ?? 0} tone={r?.totals.scheduled ? 'acc' : undefined} />
        <Stat icon={CheckCircle} label="Notice-board read rate" value={r?.readRate == null ? '—' : r.readRate + '%'} tone="good" />
        <Stat icon={WarningCircle} label="Failed copies" value={failed} tone={failed ? 'bad' : undefined} />
        <Stat icon={PushPin} label="Logged, not delivered" value={logged} tone={logged ? 'warn' : undefined} />
        <Stat icon={ChatsCircle} label="Unread from residents" value={unread} tone={unread ? 'warn' : undefined} />
      </div>
      <div className="toolbar" style={{ gap: 6 }}>
        {([['messages', 'Messages'], ['compose', 'Compose'], ['inbox', `Inbox${unread ? ` (${unread})` : ''}`]] as [Tab, string][]).map(([k, l]) => (
          <button key={k} className={'a-btn' + (tab === k ? '' : ' ghost')} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'messages' && <Dashboard fail={fail} version={version} />}
      {tab === 'compose' && <Compose fail={fail} onSent={() => { setVersion(v => v + 1); setTab('messages'); }} />}
      {tab === 'inbox' && <Inbox fail={fail} />}
    </>
  );
}
