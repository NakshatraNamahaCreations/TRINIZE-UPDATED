import { confirmBox } from '../lib/dialog';
import { CalendarBlank, CalendarCheck, CalendarPlus, ChartBar, Check, Clock, Hourglass, Lightbulb, LockSimple, MapPin, PencilSimple, Plus, Trash, UsersThree } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useToast } from '../components/toast-context';
import { Empty, IconTile, PageHead, PanelHead, Pill, Stat } from '../components/ui';
import { ApiError, LIVE } from '../lib/api';
import { decideIdeaLive, ideasLive, type Idea } from '../lib/live';
import { useStore } from '../store/context';
import type { CommunityEvent, Poll } from '../store/data';

/* Events with their RSVPs, polls with their tallies, and the event ideas residents send in.
   Capacity and one-vote-per-flat are enforced by the server; this page publishes and closes. */

type Tab = 'events' | 'polls' | 'ideas';
const pad = (n: number) => String(n).padStart(2, '0');
/** a Date as the value a datetime-local input wants, in the browser's own time zone */
const localInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const inDays = (n: number, hour: number) => { const d = new Date(); d.setDate(d.getDate() + n); d.setHours(hour, 0, 0, 0); return localInput(d); };
const length = (mins: number) => (mins < 60 ? `${mins} min` : mins % 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins / 60}h`);
const dateTime = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
function until(iso: string) {
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / 864e5);
  return days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;
}

function EventCard({ e, editing, onEdit, onDelete }: { e: CommunityEvent; editing: boolean; onEdit: () => void; onDelete: () => void }) {
  const pct = Math.min(100, Math.round((e.going / e.cap) * 100));
  const left = Math.max(0, e.cap - e.going);
  const full = left === 0;
  return (
    <div className={'ecard' + (editing ? ' editing' : '')}>
      <div className="ecard-h">
        <IconTile icon={full ? Hourglass : CalendarBlank} tone={full ? 'bad' : pct >= 85 ? 'warn' : 'acc'} size={38} />
        <div className="e-t"><b>{e.title}</b><span style={{ fontSize: 11.5, color: 'var(--ink3)' }}>{e.at ? 'Starts ' + until(e.at) : 'Upcoming'}</span></div>
        <Pill tone={full ? 'bad' : pct >= 85 ? 'warn' : 'good'}>{full ? 'Full' : pct >= 85 ? 'Filling fast' : 'Open'}</Pill>
      </div>
      <div className="ecard-meta">
        <span><Clock size={14} />{e.when}{e.mins ? ' · ' + length(e.mins) : ''}</span>
        <span><MapPin size={14} />{e.where}</span>
      </div>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 5 }}>
          <span style={{ color: 'var(--ink2)' }}>RSVPs</span><b className="num">{e.going} / {e.cap} · {pct}%</b>
        </div>
        <div className="prog"><i style={{ width: pct + '%', background: full ? 'var(--bad)' : pct >= 85 ? 'var(--warn)' : 'var(--acc)' }} /></div>
      </div>
      <div className="ecard-foot num">
        <span>{full ? 'No seats left' : `${left} seat${left === 1 ? '' : 's'} left`}</span>
        <span>{e.wait ? `${e.wait} on the waitlist` : 'No waitlist'}</span>
      </div>
      <div className="ecard-acts">
        <button className="a-btn ghost sm" onClick={onEdit}><PencilSimple size={13} />Edit</button>
        <button className="a-btn ghost sm danger" onClick={onDelete}><Trash size={13} />Delete</button>
      </div>
    </div>
  );
}

function PollCard({ p, editing, onClose, onEdit, onDelete }: { p: Poll; editing: boolean; onClose: () => void; onEdit: () => void; onDelete: () => void }) {
  const total = p.opts.reduce((a, o) => a + o.v, 0);
  const top = Math.max(...p.opts.map(o => o.v));
  const leaders = p.opts.filter(o => o.v === top);
  return (
    <div className={'ecard' + (editing ? ' editing' : '')}>
      <div className="ecard-h">
        <IconTile icon={p.closed ? LockSimple : ChartBar} tone={p.closed ? 'dim' : 'acc'} size={38} />
        <div className="e-t"><b>{p.q}</b><span style={{ fontSize: 11.5, color: 'var(--ink3)' }}>{p.elig}</span></div>
        <Pill tone={p.closed ? 'dim' : 'good'} dot>{p.closed ? 'Closed' : 'Active'}</Pill>
      </div>
      <div>
        {p.opts.map(o => {
          const pct = total ? Math.round((o.v / total) * 100) : 0;
          return (
            <div key={o.t} className={'pollrow' + (total > 0 && o.v === top ? ' lead' : '')}>
              <span className="o">{o.t}</span>
              <div className="track"><i style={{ width: pct + '%' }} /></div>
              <span className="v num">{pct}% · {o.v}</span>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink2)' }}>
        {total === 0 ? 'No votes yet.' : leaders.length > 1 ? `Tied between ${leaders.map(o => `“${o.t}”`).join(' and ')}.` : <>{p.closed ? 'Result: ' : 'Leading: '}<b style={{ color: 'var(--ink)' }}>{leaders[0].t}</b> with {Math.round((top / total) * 100)}%.</>}
      </div>
      <div className="ecard-foot">
        <span className="num">{total} vote{total === 1 ? '' : 's'}{p.closesAt ? ` · ${p.closed ? 'closed' : 'closes'} ${dateTime(p.closesAt)}` : ''}</span>
      </div>
      <div className="ecard-acts">
        {!p.closed && <button className="a-btn ghost sm" onClick={onEdit}><PencilSimple size={13} />Edit</button>}
        {!p.closed && <button className="a-btn ghost sm" onClick={onClose}><LockSimple size={13} />Close poll</button>}
        <button className="a-btn ghost sm danger" onClick={onDelete}><Trash size={13} />Delete</button>
      </div>
    </div>
  );
}

export function EventsPolls() {
  const { state, actions } = useStore();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('events');
  // the earliest time the date pickers accept: when the page was opened
  const [now] = useState(() => localInput(new Date()));
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [ev, setEv] = useState({ title: '', description: '', location: '', startsAt: inDays(7, 18), minutes: 90, capacity: 50 });
  const [poll, setPoll] = useState({ question: '', options: ['', ''], owners: false, closesAt: inDays(7, 20) });
  /** the event or poll the form below is changing; null while it is making a new one */
  const [editEv, setEditEv] = useState<string | null>(null);
  const [editPoll, setEditPoll] = useState<string | null>(null);
  const evForm = useRef<HTMLFormElement>(null), pollForm = useRef<HTMLFormElement>(null);

  const fail = useCallback((e: unknown) => toast(e instanceof ApiError ? e.message : 'That didn’t go through.', undefined, 'warn'), [toast]);
  const loadIdeas = useCallback(() => { if (LIVE) ideasLive().then(setIdeas).catch(fail); }, [fail]);
  useEffect(loadIdeas, [loadIdeas]);

  const active = state.polls.filter(p => !p.closed);
  const votes = state.polls.reduce((a, p) => a + p.opts.reduce((x, o) => x + o.v, 0), 0);
  const going = state.events.reduce((a, e) => a + e.going, 0);
  const nearlyFull = state.events.filter(e => e.going / e.cap >= 0.85).length;
  const waiting = ideas.filter(i => i.status === 'pending');

  const publishEvent = (e: FormEvent) => {
    e.preventDefault();
    if (actions.createEvent({ ...ev, title: ev.title.trim(), description: ev.description.trim(), location: ev.location.trim() }, editEv ?? undefined)) stopEditEvent();
  };
  const stopEditEvent = () => { setEditEv(null); setEv({ title: '', description: '', location: '', startsAt: inDays(7, 18), minutes: 90, capacity: 50 }); };
  const startEditEvent = (e: CommunityEvent) => {
    setEditEv(e.id);
    setEv({ title: e.title, description: e.desc ?? '', location: e.where, startsAt: e.at ? localInput(new Date(e.at)) : inDays(7, 18), minutes: e.mins ?? 90, capacity: e.cap });
    evForm.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const deleteEvent = async (e: CommunityEvent) => {
    if (!(await confirmBox(`Delete “${e.title}”?${e.going ? ` ${e.going} ${e.going === 1 ? 'person has' : 'people have'} said they are coming and will be told it is cancelled.` : ''} This cannot be undone.`))) return;
    if (editEv === e.id) stopEditEvent();
    actions.deleteEvent(e.id);
  };
  const openPoll = (e: FormEvent) => {
    e.preventDefault();
    if (actions.createPoll({ ...poll, question: poll.question.trim(), options: poll.options.map(o => o.trim()).filter(Boolean) }, editPoll ?? undefined)) stopEditPoll();
  };
  const stopEditPoll = () => { setEditPoll(null); setPoll({ question: '', options: ['', ''], owners: false, closesAt: inDays(7, 20) }); };
  const startEditPoll = (p: Poll) => {
    setEditPoll(p.id);
    setPoll({ question: p.q, options: p.opts.map(o => o.t), owners: p.owners ?? /^Owners/.test(p.elig), closesAt: p.closesAt ? localInput(new Date(p.closesAt)) : inDays(7, 20) });
    pollForm.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const deletePoll = async (p: Poll) => {
    const n = p.opts.reduce((a, o) => a + o.v, 0);
    if (!(await confirmBox(`Delete “${p.q}”?${n ? ` Its ${n} vote${n === 1 ? '' : 's'} will be deleted with it.` : ''} This cannot be undone.`))) return;
    if (editPoll === p.id) stopEditPoll();
    actions.deletePoll(p.id);
  };
  const editedPoll = state.polls.find(p => p.id === editPoll);
  /** once votes are in, what people voted on cannot change */
  const fixed = !!editedPoll && editedPoll.opts.some(o => o.v > 0);
  const closePoll = async (p: Poll) => { if ((await confirmBox(`Close “${p.q}”? Voting stops and the result becomes final.`))) actions.closePoll(p.id); };
  const setOption = (i: number, v: string) => setPoll(c => ({ ...c, options: c.options.map((o, k) => (k === i ? v : o)) }));
  const decide = (i: Idea, decision: 'approved' | 'declined') =>
    decideIdeaLive(i.id, decision).then(() => { toast(decision === 'approved' ? 'Idea approved' : 'Idea declined', `${i.by ?? 'The resident'} has been told.`); loadIdeas(); actions.refresh(); }).catch(fail);
  /** an approved idea becomes the starting point of a new event */
  const draftFrom = (i: Idea) => { setEv(c => ({ ...c, title: i.title, location: i.where, description: i.note })); setTab('events'); toast('Copied into the new event form', 'Set the date, time and capacity, then publish.'); };

  return (
    <>
      <PageHead title="Events & polls" sub="Publish events and polls, watch RSVPs and votes arrive, and answer the event ideas residents send in. Capacity and one vote per flat are enforced by the system, not the screen." />
      <div className="stats">
        <Stat icon={CalendarCheck} label="Upcoming events" value={state.events.length} />
        <Stat icon={UsersThree} label="RSVPs" value={going} tone="good" />
        <Stat icon={Hourglass} label="Nearly full" value={nearlyFull} tone={nearlyFull ? 'warn' : undefined} />
        <Stat icon={ChartBar} label="Active polls" value={active.length} />
        <Stat icon={ChartBar} label="Votes cast" value={votes} />
        <Stat icon={Lightbulb} label="Ideas to answer" value={waiting.length} tone={waiting.length ? 'warn' : undefined} />
      </div>
      <div className="filters">
        {([['events', `Events · ${state.events.length}`], ['polls', `Polls · ${state.polls.length}`], ['ideas', `Residents’ ideas · ${waiting.length}`]] as [Tab, string][]).map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'events' && (
        <>
          {state.events.length
            ? <div className="cards">{state.events.map(e => <EventCard key={e.id} e={e} editing={editEv === e.id} onEdit={() => startEditEvent(e)} onDelete={() => deleteEvent(e)} />)}</div>
            : <div className="panel"><Empty icon={CalendarBlank} title="No upcoming events" body="Publish one below — residents are notified and can RSVP in the app." /></div>}
          <form className={'panel' + (editEv ? ' editing' : '')} onSubmit={publishEvent} ref={evForm}>
            <PanelHead icon={editEv ? PencilSimple : CalendarPlus} title={editEv ? 'Edit event' : 'New event'} sub={editEv ? 'If the time or place changes, everyone who RSVP’d is told' : 'Publishes to the resident app and notifies every resident'} tone="good" />
            <div className="form-grid">
              <label className="full">Title<input className="a-in" value={ev.title} maxLength={80} onChange={e => setEv({ ...ev, title: e.target.value })} placeholder="e.g. Diwali evening at the clubhouse" /></label>
              <label className="full">Details (optional)<textarea className="a-in" value={ev.description} maxLength={600} onChange={e => setEv({ ...ev, description: e.target.value })} placeholder="What to expect, what to bring…" /></label>
              <label>Where<input className="a-in" value={ev.location} maxLength={80} onChange={e => setEv({ ...ev, location: e.target.value })} placeholder="Community Hall" /></label>
              <label>Starts<input className="a-in" type="datetime-local" value={ev.startsAt} min={editEv ? undefined : now} onChange={e => setEv({ ...ev, startsAt: e.target.value })} /></label>
              <label>Length
                <select className="a-in" value={ev.minutes} onChange={e => setEv({ ...ev, minutes: Number(e.target.value) })}>
                  {[30, 45, 60, 90, 120, 180, 240, 360, 480].map(m => <option key={m} value={m}>{length(m)}</option>)}
                </select>
              </label>
              <label>Capacity<input className="a-in" type="number" min={1} max={100000} value={ev.capacity || ''} onChange={e => setEv({ ...ev, capacity: Number(e.target.value) })} /></label>
            </div>
            <div className="d-actions" style={{ marginTop: 12 }}><button className="a-btn" type="submit">{editEv ? <><Check size={14} />Save changes</> : <><Plus size={14} />Publish event</>}</button>{editEv && <button className="a-btn ghost" type="button" onClick={stopEditEvent}>Cancel</button>}</div>
            <div className="flow-note">Once capacity is reached, further RSVPs go to a waitlist and move up automatically when someone drops out.</div>
          </form>
        </>
      )}

      {tab === 'polls' && (
        <>
          {state.polls.length
            ? <div className="cards">{state.polls.map(p => <PollCard key={p.id} p={p} editing={editPoll === p.id} onClose={() => closePoll(p)} onEdit={() => startEditPoll(p)} onDelete={() => deletePoll(p)} />)}</div>
            : <div className="panel"><Empty icon={ChartBar} title="No polls yet" body="Open one below — residents vote in the app, one vote per flat." /></div>}
          <form className={'panel' + (editPoll ? ' editing' : '')} onSubmit={openPoll} ref={pollForm}>
            <PanelHead icon={editPoll ? PencilSimple : ChartBar} title={editPoll ? 'Edit poll' : 'New poll'} sub={editPoll ? 'Residents see the change in the app straight away' : 'Opens for voting straight away and notifies every resident'} />
            {fixed && <div className="flow-note" style={{ marginTop: 0, marginBottom: 12 }}>Votes have already been cast, so the question, the options and who can vote are fixed. You can change when voting closes. To ask something different, delete this poll and open a new one.</div>}
            <div className="form-grid">
              <label className="full">Question<input className="a-in" value={poll.question} maxLength={200} disabled={fixed} onChange={e => setPoll({ ...poll, question: e.target.value })} placeholder="e.g. Should the gym open at 5:00 AM?" /></label>
              {poll.options.map((o, i) => (
                <label key={i} className="fld">Option {i + 1}
                  <span style={{ display: 'flex', gap: 6 }}>
                    <input className="a-in" value={o} maxLength={80} disabled={fixed} onChange={e => setOption(i, e.target.value)} placeholder={i === 0 ? 'Yes' : i === 1 ? 'No' : 'Another choice'} />
                    {poll.options.length > 2 && !fixed && <button type="button" className="a-btn ghost sm" onClick={() => setPoll(c => ({ ...c, options: c.options.filter((_, k) => k !== i) }))} aria-label={`Remove option ${i + 1}`}><Trash size={14} /></button>}
                  </span>
                </label>
              ))}
              {poll.options.length < 6 && !fixed && <button type="button" className="a-btn soft" onClick={() => setPoll(c => ({ ...c, options: [...c.options, ''] }))}><Plus size={14} />Add option</button>}
              <label>Who can vote
                <select className="a-in" value={poll.owners ? 'owners' : 'all'} disabled={fixed} onChange={e => setPoll({ ...poll, owners: e.target.value === 'owners' })}>
                  <option value="all">All residents</option><option value="owners">Owners only</option>
                </select>
              </label>
              <label>Voting closes<input className="a-in" type="datetime-local" value={poll.closesAt} min={now} onChange={e => setPoll({ ...poll, closesAt: e.target.value })} /></label>
            </div>
            <div className="d-actions" style={{ marginTop: 12 }}><button className="a-btn" type="submit">{editPoll ? <><Check size={14} />Save changes</> : <><Plus size={14} />Open poll</>}</button>{editPoll && <button className="a-btn ghost" type="button" onClick={stopEditPoll}>Cancel</button>}</div>
            <div className="flow-note">Each flat gets one vote, whoever casts it. A poll closes on its own at the closing time, or earlier with <b>Close poll</b>.</div>
          </form>
        </>
      )}

      {tab === 'ideas' && (!LIVE
        ? <div className="panel"><Empty icon={Lightbulb} title="Connect the console to the API" body="Event ideas are sent from the resident app and kept on the server." /></div>
        : ideas.length ? (
          <div className="cards">
            {ideas.map(i => (
              <div key={i.id} className="ecard">
                <div className="ecard-h">
                  <IconTile icon={Lightbulb} tone={i.status === 'pending' ? 'warn' : i.status === 'approved' ? 'good' : 'dim'} size={38} />
                  <div className="e-t"><b>{i.title}</b><span style={{ fontSize: 11.5, color: 'var(--ink3)' }}>{i.by ?? 'Former resident'} · sent {dateTime(i.createdAt)}</span></div>
                  <Pill tone={i.status === 'pending' ? 'warn' : i.status === 'approved' ? 'good' : 'dim'}>{i.status === 'pending' ? 'To answer' : i.status === 'approved' ? 'Approved' : 'Declined'}</Pill>
                </div>
                <div className="ecard-meta"><span><Clock size={14} />{i.when}</span><span><MapPin size={14} />{i.where}</span></div>
                {i.note && <div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>{i.note}</div>}
                <div className="ecard-foot">
                  {i.status === 'pending'
                    ? <span style={{ display: 'flex', gap: 6 }}><button className="a-btn sm" onClick={() => decide(i, 'approved')}>Approve</button><button className="a-btn ghost sm" onClick={() => decide(i, 'declined')}>Decline</button></span>
                    : <span>The resident was told.</span>}
                  {i.status !== 'declined' && <button className="a-btn ghost sm" onClick={() => draftFrom(i)}><CalendarPlus size={13} />Make it an event</button>}
                </div>
              </div>
            ))}
          </div>
        ) : <div className="panel"><Empty icon={Lightbulb} title="No ideas yet" body="Residents can suggest an event from the app. Suggestions arrive here for the committee to approve or decline." /></div>)}
    </>
  );
}
