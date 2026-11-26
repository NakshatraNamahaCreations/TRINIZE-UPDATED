import { produce, type Draft } from 'immer';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/auth-context';
import { useToast } from '../components/toast-context';
import { ApiError, LIVE } from '../lib/api';
import { aiSettingsLive, closePollLive, createEventLive, createPollLive, deleteAnnouncementLive, deleteEventLive, editAnnouncementLive, deletePollLive, editEventLive, editPollLive, eventWhen, fetchAll, internalNoteLive, moderateLive, moveIssueLive, publicUpdateLive, publishLive, standingLive, thresholdLive, type NewEvent, type NewPoll } from '../lib/live';
import { StoreCtx } from './context';
import { ADMIN, DEMO_RESIDENT, FLOW, initialState, type ModAction, type State, type Tone } from './data';

const KEY = 'trinize-society-admin:v1';

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as State;
  } catch { /* private mode / corrupt — fall back to demo data */ }
  return initialState();
}

/** the console before the server has answered: the same shape, with no records in it */
function blank(): State {
  const s = initialState();
  return { ...s, issues: [], announcements: [], events: [], polls: [], modqueue: [], resolvedMods: [], users: [], audit: [], gratitudes: 0, ai: { ...s.ai, docs: [] }, trend: { days: s.trend.days, created: s.trend.days.map(() => 0), resolved: s.trend.days.map(() => 0) } };
}

function audit(d: Draft<State>, what: string, who = ADMIN.name) {
  d.audit.unshift({ who, what, when: 'Just now' });
}

function useActions(update: (fn: (d: Draft<State>) => void) => void, ref: { current: State }, reset: () => void, sync: () => Promise<void>) {
  const toast = useToast();
  /** LIVE: run a server write, then re-read so the page shows exactly what the server holds */
  const send = (work: Promise<unknown>, done: () => void) => {
    work.then(async () => { await sync(); done(); })
      .catch(e => { toast(e instanceof ApiError ? e.message : 'That didn’t go through. Please try again.', undefined, 'warn'); void sync(); });
  };

  return useMemo(() => ({
    /** re-read from the server after a change made outside the store (the work-order panel, the Maintenance page) */
    refresh() {
      if (LIVE) void sync();
    },
    reset() {
      if (LIVE) { void sync(); toast('Refreshed from the server'); return; }
      reset();
      toast('Demo data restored', 'Every record is back to its starting state.');
    },

    /* ---- issues ---- */
    advanceIssue(id: string, { note, internal, vendor }: { note: string; internal: boolean; vendor?: string }) {
      const cur = ref.current.issues.find(x => x.id === id);
      const to = cur && FLOW[cur.status];
      if (!cur || !to) return;
      if (LIVE) {
        // an internal note is saved as a staff note; a public one travels with the status change
        const work = (internal && note ? internalNoteLive(id, note) : Promise.resolve())
          .then(() => moveIssueLive(id, to, internal ? undefined : note, to === 'Assigned' ? vendor || 'FixIt Electricals' : undefined));
        send(work, () => toast(id + ' → ' + to, 'Resident notified in the app · audit entry written'));
        return;
      }
      update(d => {
        const i = d.issues.find(x => x.id === id)!;
        if (internal && note) i.internal.push({ w: 'Just now', n: note });
        if (to === 'Assigned') i.vendor = vendor || 'FixIt Electricals';
        i.status = to;
        i.tl.push({ s: to, w: 'Just now', n: internal ? (to === 'Assigned' ? i.vendor + ' assigned' : '') : note || (to === 'Assigned' ? i.vendor + ' assigned' : '') });
        if (to === 'Resolved') {
          if (i.slaState === 'over') i.sla = 'Resolved · SLA was breached';
          else { i.sla = 'Met'; i.slaState = 'met'; }
          d.trend.resolved[d.trend.resolved.length - 1]++;
        }
        audit(d, to.toLowerCase() + ' ' + i.id + (to === 'Assigned' ? ' → ' + i.vendor : '') + (note && !internal ? ' · “' + note.slice(0, 60) + '”' : '') + (internal ? ' · internal note added' : ''));
      });
      toast(id + ' → ' + to, cur.by === DEMO_RESIDENT ? 'Resident notified (privacy-safe) · audit entry written' : 'Audit entry written');
    },
    addIssueNote(id: string, note: string, internal: boolean): boolean {
      if (!note) { toast('Write the update first.'); return false; }
      if (LIVE) {
        send(internal ? internalNoteLive(id, note) : publicUpdateLive(id, note),
          () => toast(internal ? 'Internal note added — resident cannot see it' : 'Update added — resident notified'));
        return true;
      }
      update(d => {
        const i = d.issues.find(x => x.id === id)!;
        if (internal) { i.internal.push({ w: 'Just now', n: note }); audit(d, 'internal note on ' + i.id); }
        else { i.tl.push({ s: i.status, w: 'Just now', n: note }); audit(d, 'update on ' + i.id + ' · “' + note.slice(0, 60) + '”'); }
      });
      toast(internal ? 'Internal note added — resident cannot see it' : 'Update added — resident notified');
      return true;
    },

    /* ---- moderation ---- */
    moderate(id: string, action: ModAction, reason: string, guidance: string): boolean {
      if (!reason) {
        toast('An internal reason is mandatory for every moderation action.', 'It is written to the audit log — the resident never sees it.', 'warn');
        return false;
      }
      if (LIVE) {
        send(moderateLive(id, action), () => toast(action + ' · ' + id, 'The author is told the outcome in the app · audit entry written'));
        return true;
      }
      update(d => {
        const m = d.modqueue.find(x => x.id === id)!;
        m.state = 'done';
        d.resolvedMods.unshift({ id: m.id, by: m.by, when: 'Just now', text: '“' + m.text.slice(0, 80) + (m.text.length > 80 ? '…' : '') + '”', action, admin: ADMIN.name });
        audit(d, action.toLowerCase() + ' · ' + m.id + ' (' + m.kind.toLowerCase() + ' by ' + m.by + ') · reason: “' + reason.slice(0, 50) + '”');
        if (action === 'Warned author') {
          const u = d.users.find(x => x.n === m.by);
          if (u) { u.warns++; if (u.status === 'Active') u.status = 'Warned'; }
        }
      });
      toast(action + ' · ' + id, 'Reason recorded · “' + guidance.slice(0, 48) + (guidance.length > 48 ? '…' : '') + '” sent to the resident · audit entry written');
      return true;
    },

    /* ---- announcements ---- */
    publishAnnouncement({ title, body, aud, pri }: { title: string; body: string; aud: string; pri: 'Normal' | 'High' }): boolean {
      if (!title || !body) { toast('Add a title and a message first.'); return false; }
      if (LIVE) {
        send(publishLive({ title, body, aud, pri }), () => toast('Published', 'On the resident home screen, with an in-app notification'));
        return true;
      }
      update(d => {
        d.announcements.unshift({ id: 'AN-' + d.anSeq++, title, body, pri, aud, when: 'Just now', by: ADMIN.name, ack: pri === 'High', read: 0 });
        audit(d, 'published announcement “' + title.slice(0, 50) + '” to ' + aud + ' · priority ' + pri);
      });
      toast('Published', aud === 'Committee only' ? 'Committee-only — it will not appear in the resident app' : 'On the resident home screen, with a privacy-safe push');
      return true;
    },
    /** correct a published notice — the wording changes in the app, nobody is notified a second time */
    editAnnouncement(id: string, { title, body, pri }: { title: string; body: string; pri: 'Normal' | 'High' }): boolean {
      if (title.length < 3 || body.length < 3) { toast('Add a title and a message first.'); return false; }
      const said = () => toast('Announcement updated', 'Residents see the new wording in the app.');
      if (LIVE) { send(editAnnouncementLive(id, { title, body, pri }), said); return true; }
      update(d => {
        const a = d.announcements.find(x => x.id === id);
        if (a) Object.assign(a, { title, body, pri, ack: pri === 'High' });
        audit(d, 'edited announcement ' + id + ' · “' + title.slice(0, 50) + '”');
      });
      said();
      return true;
    },
    deleteAnnouncement(id: string) {
      const a = ref.current.announcements.find(x => x.id === id);
      if (!a) return;
      const said = () => toast('Announcement deleted', 'It has been removed from the resident app.');
      if (LIVE) { send(deleteAnnouncementLive(id), said); return; }
      update(d => { d.announcements = d.announcements.filter(x => x.id !== id); audit(d, 'deleted announcement ' + id + ' · “' + a.title.slice(0, 50) + '”'); });
      said();
    },

    /* ---- events & polls ---- */
    /** publish a new event, or with `id` save changes to an existing one */
    createEvent(e: NewEvent, id?: string): boolean {
      const starts = new Date(e.startsAt);
      if (e.title.length < 3 || e.location.length < 2) { toast('Give the event a title and a place.', undefined, 'warn'); return false; }
      const was = id ? ref.current.events.find(x => x.id === id) : undefined;
      const sameStart = !!was?.at && new Date(was.at).getTime() === starts.getTime();
      if (Number.isNaN(starts.getTime()) || (!sameStart && starts.getTime() <= Date.now())) { toast('Pick a start time in the future.', undefined, 'warn'); return false; }
      if (was && e.capacity < was.going) { toast(`${was.going} people are already going, so the capacity can’t be lower than that.`, undefined, 'warn'); return false; }
      if (!(e.capacity >= 1) || !(e.minutes >= 15)) { toast('Capacity must be at least 1 and the event at least 15 minutes long.', undefined, 'warn'); return false; }
      if (LIVE) {
        if (id) send(editEventLive(id, { ...e, startsAt: starts.toISOString() }), () => toast('Event updated', sameStart && was?.where === e.location ? 'The app shows the new details.' : 'Everyone who RSVP’d was told about the new time or place.'));
        else send(createEventLive({ ...e, startsAt: starts.toISOString() }), () => toast('Event published', 'Residents were notified and can RSVP in the app'));
        return true;
      }
      if (id) {
        update(d => {
          Object.assign(d.events.find(x => x.id === id)!, { title: e.title, when: eventWhen(starts), where: e.location, cap: e.capacity, mins: e.minutes, at: starts.toISOString(), desc: e.description });
          d.events.sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''));
          audit(d, 'event edited · ' + e.title);
        });
        toast('Event updated', 'The app shows the new details.');
        return true;
      }
      update(d => {
        d.events.push({ id: 'E-' + Date.now(), title: e.title, when: eventWhen(starts), where: e.location, cap: e.capacity, going: 0, wait: 0, mins: e.minutes, at: starts.toISOString() });
        d.events.sort((a, b) => (a.at ?? '').localeCompare(b.at ?? ''));
        audit(d, 'event published · ' + e.title);
      });
      toast('Event published', 'Residents can RSVP in the app');
      return true;
    },
    deleteEvent(id: string) {
      const e = ref.current.events.find(x => x.id === id);
      if (!e) return;
      const said = () => toast('Event deleted', e.going ? 'Everyone who RSVP’d has been told it is cancelled.' : 'It has been removed from the app.');
      if (LIVE) { send(deleteEventLive(id), said); return; }
      update(d => { d.events = d.events.filter(x => x.id !== id); audit(d, 'event deleted · ' + e.title); });
      said();
    },
    /** open a new poll, or with `id` save changes to one that is still open */
    createPoll(p: NewPoll, id?: string): boolean {
      const closes = new Date(p.closesAt);
      if (p.question.length < 5) { toast('Write the question first.', undefined, 'warn'); return false; }
      if (p.options.length < 2) { toast('A poll needs at least two options.', undefined, 'warn'); return false; }
      if (new Set(p.options.map(o => o.toLowerCase())).size !== p.options.length) { toast('Two options are the same.', undefined, 'warn'); return false; }
      if (Number.isNaN(closes.getTime()) || closes.getTime() <= Date.now()) { toast('Pick a closing time in the future.', undefined, 'warn'); return false; }
      if (LIVE) {
        if (id) send(editPollLive(id, { ...p, closesAt: closes.toISOString() }), () => toast('Poll updated', 'Residents see the change in the app.'));
        else send(createPollLive({ ...p, closesAt: closes.toISOString() }), () => toast('Poll opened', 'Residents were notified · one vote per unit'));
        return true;
      }
      if (id) {
        update(d => {
          const was = d.polls.find(x => x.id === id)!;
          const voted = was.opts.some(o => o.v > 0);
          Object.assign(was, { closesAt: closes.toISOString() }, voted ? {} : { q: p.question, opts: p.options.map(t => ({ t, v: 0 })), owners: p.owners, elig: (p.owners ? 'Owners only' : 'All residents') + ' · one vote per unit' });
          audit(d, 'poll edited · ' + was.q);
        });
        toast('Poll updated', 'Residents see the change in the app.');
        return true;
      }
      update(d => {
        d.polls.unshift({ id: 'P-' + Date.now(), q: p.question, opts: p.options.map(t => ({ t, v: 0 })), elig: (p.owners ? 'Owners only' : 'All residents') + ' · one vote per unit', closesAt: closes.toISOString() });
        audit(d, 'poll opened · ' + p.question);
      });
      toast('Poll opened', 'One vote per unit');
      return true;
    },
    deletePoll(id: string) {
      const poll = ref.current.polls.find(x => x.id === id);
      if (!poll) return;
      const said = () => toast('Poll deleted', 'It and its votes are gone from the app.');
      if (LIVE) { send(deletePollLive(id), said); return; }
      update(d => { d.polls = d.polls.filter(x => x.id !== id); audit(d, 'poll deleted · ' + poll.q); });
      said();
    },
    closePoll(id: string) {
      const poll = ref.current.polls.find(x => x.id === id);
      if (!poll || poll.closed) return;
      if (LIVE) { send(closePollLive(id), () => toast('Poll closed', 'The result is final and visible to residents')); return; }
      update(d => {
        d.polls.find(x => x.id === id)!.closed = true;
        audit(d, 'poll closed · ' + poll.q);
      });
      toast('Poll closed', 'The result is final');
    },

    /* ---- users ---- */
    suspendUser(n: string) {
      if (LIVE) { send(standingLive(n, 'Suspended'), () => toast(n + ' suspended', 'Posting and social actions are blocked · audit entry written')); return; }
      update(d => {
        const u = d.users.find(x => x.n === n)!;
        u.status = 'Suspended';
        audit(d, 'suspended ' + u.n);
      });
      toast(n + ' suspended', 'Posting and social actions are blocked · audit entry written');
    },
    /** out of the app altogether, until unblocked */
    blockUser(n: string) {
      if (LIVE) { send(standingLive(n, 'Blocked'), () => toast(n + ' blocked', 'Signed out and cannot use the app until unblocked · audit entry written')); return; }
      update(d => {
        const u = d.users.find(x => x.n === n)!;
        u.status = 'Blocked';
        audit(d, 'blocked ' + u.n + ' from the app');
      });
      toast(n + ' blocked', 'Cannot use the app until unblocked · audit entry written');
    },
    restrictUser(n: string) {
      if (LIVE) { send(standingLive(n, 'Restricted'), () => toast(n + ' restricted', 'Loses posting only · audit entry written')); return; }
      update(d => {
        const u = d.users.find(x => x.n === n)!;
        u.status = 'Restricted';
        audit(d, 'restricted ' + u.n + ' for 24h · reason: “community guidelines — repeated hostility” · auto-expires');
      });
      toast(n + ' restricted for 24h', 'Loses posting only · auto-expires · user notified with reason · audit entry written');
    },
    reactivateUser(n: string) {
      if (LIVE) { send(standingLive(n, 'Active'), () => toast(n + ' reactivated')); return; }
      update(d => {
        const u = d.users.find(x => x.n === n)!;
        u.status = 'Active';
        audit(d, 'reactivated ' + u.n);
      });
      toast(n + ' reactivated');
    },

    /* ---- AI controls ---- */
    toggleFeature(key: 'qna' | 'issueCreate' | 'toneRewrite' | 'summaries') {
      if (LIVE) { send(aiSettingsLive({ [key]: !ref.current.ai[key] }), () => toast('Setting saved — the resident app follows it')); return; }
      update(d => { d.ai[key] = !d.ai[key]; });
      toast('Setting saved — the resident app updates instantly');
    },
    toggleTone(tone: Tone) {
      const was = ref.current.ai.tones[tone];
      if (LIVE) { send(aiSettingsLive({ tones: { [tone]: !was } }), () => toast('Tone ' + (was ? 'disabled' : 'enabled'))); return; }
      update(d => { d.ai.tones[tone] = !was; });
      toast('Tone ' + (was ? 'disabled' : 'enabled') + ' — check the resident composer');
    },
    setThreshold(v: State['ai']['threshold']) {
      if (LIVE) { send(thresholdLive(v), () => toast('Threshold saved')); return; }
      update(d => { d.ai.threshold = v; });
      toast('Threshold saved');
    },
    setAutoHold(v: State['ai']['autoHold']) {
      if (LIVE) { send(aiSettingsLive({ autoHold: v }), () => toast('Saved', v === 'Medium & above' ? 'Borderline posts wait for a moderator' : 'Borderline posts go up at once and are queued for review')); return; }
      update(d => { d.ai.autoHold = v; });
      toast('Saved');
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `send` only closes over toast and sync
  }), [update, ref, reset, sync, toast]);
}

export type Actions = ReturnType<typeof useActions>;

export function StoreProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const toast = useToast();
  // connected to the API, the server is the source of truth: start empty rather than flash demo records
  const [state, setState] = useState<State>(() => (LIVE ? blank() : load()));
  const ref = useRef(state);
  // actions read the latest committed state; handlers only run after a commit
  useLayoutEffect(() => { ref.current = state; });
  useEffect(() => {
    if (LIVE) return; // nothing is kept in the browser when the API holds the data
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ }
  }, [state]);

  const signedIn = !!user;
  const failed = useRef(false);
  const sync = useCallback(async () => {
    if (!LIVE) return;
    try {
      const fresh = await fetchAll(ref.current);
      setState(fresh);
      failed.current = false;
    } catch (e) {
      // say it once, not every 20 seconds
      if (!failed.current) toast(e instanceof ApiError ? e.message : 'Can’t reach the server.', 'Showing the last data received.', 'warn');
      failed.current = true;
    }
  }, [toast]);
  // load on sign-in, then keep the queue fresh so a resident's new issue appears without a reload.
  // Each refresh is about a dozen requests: every 30 s while someone is using the console, every 90 s once
  // nobody has clicked or typed for 2 minutes, never while the tab is hidden — so a few staff on one office
  // connection stay well inside the server's request limit.
  useEffect(() => {
    if (!LIVE || !signedIn) return;
    const poll = { last: Date.now(), inFlight: false, timer: undefined as ReturnType<typeof setTimeout> | undefined };
    const seen = () => { poll.last = Date.now(); };
    const run = async () => {
      if (poll.inFlight || document.visibilityState !== 'visible') return;
      poll.inFlight = true; // a slow answer never stacks a second refresh on top of the first
      try { await sync(); } finally { poll.inFlight = false; }
    };
    const loop = () => {
      poll.timer = setTimeout(() => { void run().finally(loop); }, Date.now() - poll.last > 120_000 ? 90_000 : 30_000);
    };
    // back on the tab: refresh at once (it may have been a while), then carry on the usual rhythm
    const back = () => { if (document.visibilityState === 'visible') { seen(); void run(); } };
    void run();
    loop();
    window.addEventListener('pointerdown', seen);
    window.addEventListener('keydown', seen);
    document.addEventListener('visibilitychange', back);
    return () => {
      clearTimeout(poll.timer);
      window.removeEventListener('pointerdown', seen);
      window.removeEventListener('keydown', seen);
      document.removeEventListener('visibilitychange', back);
    };
  }, [signedIn, sync]);

  const update = useCallback((fn: (d: Draft<State>) => void) => setState(s => produce(s, fn)), []);
  const reset = useCallback(() => setState(initialState()), []);
  const actions = useActions(update, ref, reset, sync);
  const value = useMemo(() => ({ state, actions }), [state, actions]);
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}
