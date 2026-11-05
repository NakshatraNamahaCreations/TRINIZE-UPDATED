import { produce, type Draft } from 'immer';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useUI } from '@/components/Overlay';
import { useT } from '@/i18n';
import { cancelEventReminder, scheduleEventReminder } from '@/lib/notify';
import { saveStore } from '@/lib/persist';
import { initialChat, initialState, ME, type Member, type NotifPrefs, type PrivacyPrefs, type State, type Suggestion, type TryKey } from './data';
import { aiReply, audit, checkSafety, createIssue, holdForReview, notify, type Safety } from './logic';

export const TRY_TOTAL = 7;

function useActions(update: (fn: (d: Draft<State>) => void) => void, ref: { current: State }, replace: (s: State) => void) {
  const { toast, confetti } = useUI();
  const { t } = useT();

  return useMemo(() => ({
    markTried(key: TryKey) {
      update(d => { d.tried[key] = true; });
    },

    /* ---- assistant ---- */
    sendChat(text: string) {
      if (ref.current.chat.busy) return; // stops rapid chip taps stacking replies
      update(d => { d.chat.log.push({ who: 'me', text }); d.chat.busy = true; });
      setTimeout(() => update(d => { d.chat.busy = false; aiReply(d, text); }), 380 + Math.min(620, text.length * 10));
    },
    confirmIssue() {
      const c = ref.current.chat;
      const prev = [...c.log].reverse().find(m => m.who === 'preview');
      if (c.creating || !prev || prev.who !== 'preview') return; // double-taps create only one issue
      const id = 'ISS-' + ref.current.issueSeq;
      update(d => { d.chat.creating = true; });
      setTimeout(() => {
        update(d => {
          createIssue(d, { ...prev.draft, via: 'chat' });
          d.chat.log = d.chat.log.filter(m => m.who !== 'preview');
          d.chat.log.push({ who: 'ai', text: 'Done ✅ Issue ' + id + ' is created and the admin team has been notified. Response is due within 24 hours. You can track it any time in My Issues.', chips: ['Open My Issues', 'Start over'] });
          d.chat.mode = 'idle'; d.chat.draft = {}; d.chat.creating = false;
          d.tried.issue = true;
        });
        confetti();
        toast(t('toast.issueCreated', { id }), 'ticket');
      }, 500);
    },
    cancelIssue() {
      update(d => {
        d.chat.log = d.chat.log.filter(m => m.who !== 'preview');
        d.chat.mode = 'idle'; d.chat.draft = {};
        d.chat.log.push({ who: 'ai', text: "Okay, I've discarded that draft. Nothing was created.", chips: ['Start over'] });
      });
    },

    /* ---- announcements ---- */
    ackAnnouncement(id: string) {
      update(d => {
        const a = d.announcements.find(x => x.id === id);
        if (!a) return;
        a.acked = true;
        audit(d, 'System', 'acknowledgement recorded · ' + ME.name + ' (' + ME.unit + ') · ' + a.id);
      });
      toast(t('toast.acked'), 'checkmark-circle');
    },

    /* ---- discussions ---- */
    /** reactions stay weightless — deliberately not audited */
    react(id: string, emo: string) {
      update(d => {
        const x = d.discussions.find(q => q.id === id);
        if (x) x.myReact = x.myReact === emo ? null : emo;
      });
    },
    checkPost(text: string): Safety {
      return checkSafety(text, ref.current.ai.threshold);
    },
    publishPost(text: string, held = false) {
      const first = text.split(/\n/)[0];
      const title = first.length > 52 ? first.slice(0, 49) + '…' : first;
      update(d => {
        const id = 'D-' + d.discSeq++;
        d.discussions.unshift({ id, title, body: text, by: ME.name, unit: ME.unit, when: 'Just now', comments: 0, likes: 0, state: held ? 'held' : 'published' });
        if (held) holdForReview(d, 'Discussion post', text, 'Aggressive', 'Medium', 'Author chose to post after a warn. Borderline hostility — review context before deciding.', 'New post in Discussions', id);
      });
      if (held) toast(t('toast.held'), 'shield-checkmark');
      else toast(t('toast.published'), 'checkmark-circle');
    },

    /* ---- events ---- */
    rsvp(id: string) {
      const e = ref.current.events.find(x => x.id === id);
      if (!e) return;
      const full = e.going >= e.cap;
      update(d => {
        const ev = d.events.find(x => x.id === id)!;
        if (full) ev.mine = 'Waitlist';
        else { ev.going++; ev.mine = 'Going'; }
        notify(d, { icon: ev.icon, c: '#E4F7EE', tc: '#067647', t: 'RSVP ' + (full ? 'waitlisted' : 'confirmed') + ': ' + ev.title, s: ev.when, goTo: 'events' });
        audit(d, 'System', (full ? 'waitlist join' : 'RSVP') + ' recorded for ' + ev.title + ' · ' + ME.name + ' (' + ME.unit + ')');
        d.tried.rsvp = true;
      });
      if (full) toast(t('toast.waitlist'), 'hourglass');
      else {
        toast(t(e.going + 1 >= e.cap ? 'toast.lastSeat' : 'toast.rsvp'), 'checkmark-circle');
        scheduleEventReminder(e, ref.current.settings.notif, { title: 'Trinize', body: t('push.body') });
      }
    },
    unrsvp(id: string) {
      update(d => {
        const e = d.events.find(x => x.id === id);
        if (!e) return;
        if (e.mine === 'Going') e.going = Math.max(0, e.going - 1);
        e.mine = null;
      });
      cancelEventReminder(id);
      toast(t('toast.unrsvp'), 'close-circle');
    },

    /* ---- polls ---- */
    vote(pid: string, idx: number) {
      const p = ref.current.polls.find(x => x.id === pid);
      if (!p || p.mine || p.closed) return; // one vote per unit
      update(d => {
        const poll = d.polls.find(x => x.id === pid)!;
        poll.opts[idx].v++;
        poll.mine = poll.opts[idx].t;
        audit(d, 'System', 'vote recorded on “' + poll.q + '” · ' + ME.unit + ' (choice private)');
        d.tried.vote = true;
      });
      toast(t('toast.voted'), 'checkmark-circle');
    },

    /* ---- gratitude ---- */
    sendGratitude(text: string, cat: string, to: string): 'sent' | 'held' {
      const safety = checkSafety(text, ref.current.ai.threshold);
      if (safety.level !== 'safe') {
        update(d => {
          holdForReview(d, 'Gratitude note', text, safety.level === 'block' ? 'Abusive' : 'Aggressive', safety.level === 'block' ? 'High' : 'Medium',
            'Gratitude text failed the safety check — held before delivery.', 'Gratitude to ' + to);
          d.tried.guard = true;
        });
        toast(t('toast.gratHeld'), 'shield-checkmark');
        return 'held';
      }
      update(d => {
        d.gratitudes.unshift({ by: ME.name, to, cat, text, when: 'Just now' });
        d.me.gratitudes++;
        audit(d, 'System', 'gratitude sent · ' + ME.name + ' → ' + to + ' · ' + cat + ' (note text private to recipient)');
        d.tried.gratitude = true;
      });
      confetti();
      toast(t('toast.gratSent'), 'heart');
      return 'sent';
    },

    /* ---- notifications ---- */
    readNotif(id: number) {
      update(d => { const n = d.notifs.find(x => x.id === id); if (n) n.unread = false; });
    },
    markAllRead() {
      update(d => { d.notifs.forEach(n => { n.unread = false; }); });
    },

    /* ---- profile settings ---- */
    toggleNotif(key: keyof NotifPrefs) {
      update(d => { d.settings.notif[key] = !d.settings.notif[key]; });
    },
    togglePrivacy(key: keyof PrivacyPrefs) {
      update(d => { d.settings.privacy[key] = !d.settings.privacy[key]; });
    },
    clearChat() {
      update(d => { d.chat = initialChat(); });
      toast(t('pv.cleared'), 'trash');
    },

    /* ---- discussion replies ---- */
    /** 'block' posts nothing; 'warn' posts a held reply only the author sees, queued for moderation */
    reply(id: string, text: string): Safety['level'] {
      const safety = checkSafety(text, ref.current.ai.threshold);
      if (safety.level === 'block') { update(d => { d.tried.guard = true; }); return 'block'; }
      const held = safety.level === 'warn';
      update(d => {
        const x = d.discussions.find(q => q.id === id);
        if (!x) return;
        const r = { id: 'R-' + d.replySeq++, by: ME.name, unit: ME.unit, text, when: 'Just now', held };
        (x.thread ??= []).push(r);
        if (held) {
          holdForReview(d, 'Discussion reply', text, 'Aggressive', 'Medium', 'Reply failed the safety check after a warn. Review in thread context.', 'Reply on “' + x.title + '”', r.id);
          d.tried.guard = true;
        } else x.comments++;
      });
      toast(t(held ? 'post.heldReply' : 'post.posted'), held ? 'shield-checkmark' : 'chatbubble');
      return safety.level;
    },

    /* ---- issue follow-ups ---- */
    reopenIssue(id: string, reason: string) {
      update(d => {
        const i = d.issues.find(x => x.id === id);
        if (!i) return;
        i.status = 'Acknowledged';
        i.slaState = 'ok';
        i.sla = 'Reopened · response due in 24h';
        i.tl.push({ s: 'Acknowledged', w: 'Just now', n: 'Reopened by resident: ' + reason });
        notify(d, { icon: 'refresh', c: '#FEF0DC', tc: '#B54708', t: i.id + ' reopened', s: 'Back in the admin queue', goTo: 'issues' });
        audit(d, ME.name + ' (' + ME.unit + ')', 'reopened ' + i.id + ' · reason: ' + reason);
      });
      toast(t('issue.reopened'), 'refresh');
    },
    addIssueUpdate(id: string, text: string, photo?: string) {
      update(d => {
        const i = d.issues.find(x => x.id === id);
        if (!i) return;
        (i.updates ??= []).push({ text, when: 'Just now', photo });
        audit(d, ME.name + ' (' + ME.unit + ')', 'update on ' + i.id + (photo ? ' · photo attached' : ''));
      });
      toast(t('issue.updateSent'), 'send');
    },

    /* ---- event ideas ---- */
    suggestEvent(s: Omit<Suggestion, 'id' | 'status'>) {
      update(d => {
        d.suggestions.unshift({ ...s, id: 'S-' + d.sugSeq++, status: 'pending' });
        audit(d, ME.name + ' (' + ME.unit + ')', 'event suggestion · ' + s.title + ' · awaiting committee');
      });
      toast(t('sug.sent'), 'calendar');
    },

    /** sign-out: the next resident on this phone must not inherit chats, votes or settings */
    reset() {
      replace(initialState);
      saveStore(initialState); // now, not after the debounce — the app may be closed right after signing out
    },

    /* ---- unit & family ---- */
    addMember(m: Pick<Member, 'name' | 'rel' | 'phone'>) {
      update(d => {
        d.family.push({ ...m, id: 'M' + d.famSeq++, pending: true });
        audit(d, 'System', 'family member added · ' + m.name + ' (' + m.rel + ') → ' + ME.unit + ' · pending verification');
      });
      toast(t('fam.added', { name: m.name }), 'person-add');
    },
    removeMember(id: string) {
      const m = ref.current.family.find(x => x.id === id);
      if (!m || m.you) return; // the signed-in owner can't remove themselves
      update(d => { d.family = d.family.filter(x => x.id !== id); });
      toast(t('fam.removed', { name: m.name }), 'person-remove');
    },
  }), [update, ref, replace, toast, confetti, t]);
}

type Store = { state: State; actions: ReturnType<typeof useActions> };
const StoreCtx = createContext<Store | null>(null);

export function StoreProvider({ initial = initialState, children }: { initial?: State; children: ReactNode }) {
  const [state, setState] = useState<State>(initial);
  // debounced so a burst of taps (typing a chat, toggling switches) writes once
  useEffect(() => {
    const h = setTimeout(() => saveStore(state), 400);
    return () => clearTimeout(h);
  }, [state]);
  const ref = useRef(state);
  // actions read the latest committed state from here; handlers only ever run after a commit
  useLayoutEffect(() => { ref.current = state; });
  const update = useCallback((fn: (d: Draft<State>) => void) => setState(s => produce(s, fn)), []);
  const actions = useActions(update, ref, setState);
  const { toast, confetti } = useUI();
  const { t } = useT();
  // read through a ref so switching language doesn't replay the celebration
  const loopMsg = useRef('');
  useLayoutEffect(() => { loopMsg.current = t('toast.loop'); });

  const triedCount = Object.keys(state.tried).length;
  useEffect(() => {
    if (triedCount !== TRY_TOTAL) return;
    confetti();
    const h = setTimeout(() => toast(loopMsg.current, 'trophy'), 400);
    return () => clearTimeout(h);
  }, [triedCount, confetti, toast]);

  const value = useMemo(() => ({ state, actions }), [state, actions]);
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export function useStore() {
  const s = useContext(StoreCtx);
  if (!s) throw new Error('useStore must be used inside <StoreProvider>');
  return s;
}

export const unreadCount = (s: State) => s.notifs.filter(n => n.unread).length;
