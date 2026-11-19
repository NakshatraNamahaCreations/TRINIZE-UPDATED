import { produce, type Draft } from 'immer';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useUI } from '@/components/Overlay';
import { useT } from '@/i18n';
import { ApiError, LIVE } from '@/lib/api';
import { registerStoreRefresh } from '@/lib/refresh';
import { confirm } from '@/lib/confirm';
import { addMemberLive, blockPerson, createPost, createReply, deleteAccountLive, deletePost, deleteReply, fetchCommunity, fetchPost, readAllNotifsLive, readNotifLive, removeMemberLive, reportItem, saveSettings, sendGratitudeLive, SERVER_NOTIF_BASE, setReaction, suggestLive, unblockPerson } from '@/lib/live2';
import { ackLive, addIssueUpdateLive, askAssistant, clearAssistantHistory, confirmIssueLive, createCommonIssueLive, createIssueLive, fetchAll, logAssistantTurns, reopenIssueLive, type HistoryTurn, rsvpLive, unrsvpLive, voteLive } from '@/lib/live';
import { cancelEventReminder, scheduleEventReminder } from '@/lib/notify';
import { deleteStore, loadStore, saveStore } from '@/lib/persist';
import { useAuth } from './auth';
import { todayStamp } from './dates';
import { firstState, initialChat, ME, resetIdentity, pollClosed, type Member, type Priority, type NotifPrefs, type PrivacyPrefs, type State, type Suggestion, type TryKey } from './data';
import { aiReply, attachChatPhoto, handledInApp, audit, checkSafety, createIssue, holdForReview, notify, type Safety } from './logic';

export const TRY_TOTAL = 7;

function useActions(update: (fn: (d: Draft<State>) => void) => void, ref: { current: State }, release: () => void, wipe: () => void, sync: () => Promise<void>) {
  const { toast, confetti } = useUI();
  const { t } = useT();
  /** a server refusal, in the server's own words; anything else gets a generic line */
  const fail = (e: unknown) => toast(e instanceof ApiError ? e.message : t('live.failed'), 'alert-circle');

  /** in-app assistant turns go to the server's history too — unless the resident switched history off */
  const record = (turns: HistoryTurn[]) => {
    if (LIVE && turns.length && ref.current.settings.privacy.aiHistory) logAssistantTurns(turns.slice(-10)).catch(() => {});
  };

  return useMemo(() => ({
    /** re-read everything the server owns (LIVE only) */
    refresh: sync,

    markTried(key: TryKey) {
      update(d => { d.tried[key] = true; });
    },

    /* ---- assistant ---- */
    sendChat(text: string) {
      if (ref.current.chat.busy) return; // stops rapid chip taps stacking replies
      update(d => { d.chat.log.push({ who: 'me', text }); d.chat.busy = true; });
      if (LIVE && !handledInApp(ref.current.chat, text)) {
        // a real question: the server's assistant answers from the society's documents and live records
        askAssistant(text).then(r => update(d => {
          d.chat.busy = false;
          d.chat.log.push({ who: 'ai', text: r.text, src: r.source, chips: r.chips ?? ['Report an issue'], calls: r.calls, link: r.link, offer: r.offer });
          d.tried.ask = true;
          // the server keeps the question (unless assistant history is off), so the impact figures move with it
          if (d.settings.privacy.aiHistory && d.me.chats !== null) { d.me.chats++; d.me.pastChats = [text, ...d.me.pastChats].slice(0, 4); }
        })).catch(e => update(d => {
          d.chat.busy = false;
          d.chat.log.push({ who: 'ai', text: e instanceof ApiError ? e.message : t('live.failed'), chips: ['Report an issue'] });
        }));
        return;
      }
      setTimeout(() => {
        const reply = (d: Draft<State>) => { d.chat.busy = false; aiReply(d, text); };
        if (LIVE) {
          // worked out on a copy first, to know what the assistant says: untouched messages keep their identity, new ones don't
          const was = ref.current.chat.log;
          const said = produce(ref.current, reply).chat.log.filter(m => !was.includes(m));
          record([{ role: 'user', text }, ...said.flatMap(m => (m.who === 'ai' ? [{ role: 'assistant' as const, text: m.text }] : []))]);
        }
        update(reply);
      }, 380 + Math.min(620, text.length * 10));
    },
    attachChatPhoto(uri: string) {
      if (ref.current.chat.mode === 'issue.photo') record([{ role: 'user', text: '📷 Photo added' }]);
      update(d => attachChatPhoto(d, uri));
    },
    confirmIssue() {
      const c = ref.current.chat;
      const prev = [...c.log].reverse().find(m => m.who === 'preview');
      if (c.creating || !prev || prev.who !== 'preview') return; // double-taps create only one issue
      if (LIVE) {
        // the server numbers the ticket, so the chat waits for its answer before saying "done"
        update(d => { d.chat.creating = true; });
        createIssueLive({ ...prev.draft, via: 'chat' }).then(issue => {
          const doneText = 'Done ✅ Issue ' + issue.id + ' is created and sent to the society office. You can track it any time in My Issues.';
          record([{ role: 'assistant', text: doneText }]);
          update(d => {
            d.issues.unshift(issue);
            d.chat.log = d.chat.log.filter(m => m.who !== 'preview');
            d.chat.log.push({ who: 'ai', text: doneText, chips: ['Open My Issues', 'Start over'] });
            d.chat.mode = 'idle'; d.chat.draft = {}; d.chat.creating = false;
            notify(d, { icon: 'ticket-outline', c: '#F1ECFE', tc: '#7C55F7', t: issue.id + ' created', s: issue.title, goTo: 'issues', href: '/issues/' + issue.id });
            d.tried.issue = true;
          });
          confetti();
          toast(t('toast.issueCreated', { id: issue.id }), 'ticket');
        }).catch(e => { update(d => { d.chat.creating = false; }); fail(e); });
        return;
      }
      const id = 'ISS-' + ref.current.issueSeq;
      update(d => { d.chat.creating = true; });
      setTimeout(() => {
        update(d => {
          createIssue(d, { ...prev.draft, via: 'chat' });
          d.chat.log = d.chat.log.filter(m => m.who !== 'preview');
          d.chat.log.push({ who: 'ai', text: 'Done ✅ Issue ' + id + ' is created and sent to the society office. Response is due within 24 hours. You can track it any time in My Issues.', chips: ['Open My Issues', 'Start over'] });
          d.chat.mode = 'idle'; d.chat.draft = {}; d.chat.creating = false;
          d.tried.issue = true;
        });
        confetti();
        toast(t('toast.issueCreated', { id }), 'ticket');
      }, 500);
    },
    cancelIssue() {
      record([{ role: 'assistant', text: "Okay, I've discarded that draft. Nothing was created." }]);
      update(d => {
        d.chat.log = d.chat.log.filter(m => m.who !== 'preview');
        d.chat.mode = 'idle'; d.chat.draft = {};
        d.chat.log.push({ who: 'ai', text: "Okay, I've discarded that draft. Nothing was created.", chips: ['Start over'] });
      });
    },

    /** the "Use a form instead" path — same ticket as the chat creates, without the conversation */
    async createIssueFromForm(f: { title: string; desc: string; cat: string; loc: string; pri: Priority; photo?: string; asset?: string }): Promise<string | null> {
      if (LIVE) {
        try {
          // with an asset it is a common-area request (lift, STP…), not one about the resident's own flat
          const issue = f.asset ? await createCommonIssueLive({ ...f, asset: f.asset }) : await createIssueLive({ ...f, via: 'form' });
          update(d => {
            d.issues.unshift(issue);
            notify(d, { icon: 'ticket-outline', c: '#F1ECFE', tc: '#7C55F7', t: issue.id + ' created', s: issue.title, goTo: 'issues', href: '/issues/' + issue.id });
            d.tried.issue = true;
          });
          confetti();
          toast(t('toast.issueCreated', { id: issue.id }), 'ticket');
          return issue.id;
        } catch (e) {
          fail(e);
          return null;
        }
      }
      const id = 'ISS-' + ref.current.issueSeq; // what createIssue will assign — the updater runs later
      update(d => { createIssue(d, { ...f, via: 'app' }); d.tried.issue = true; });
      confetti();
      toast(t('toast.issueCreated', { id }), 'ticket');
      return id;
    },

    /* ---- announcements ---- */
    ackAnnouncement(id: string) {
      if (LIVE) {
        ackLive(id).then(() => {
          update(d => { const a = d.announcements.find(x => x.id === id); if (a) a.acked = true; });
          toast(t('toast.acked'), 'checkmark-circle');
        }).catch(fail);
        return;
      }
      update(d => {
        const a = d.announcements.find(x => x.id === id);
        if (!a) return;
        a.acked = true;
        a.ackedOn = todayStamp();
        audit(d, 'System', 'acknowledgement recorded · ' + ME.name + ' (' + ME.unit + ') · ' + a.id);
      });
      toast(t('toast.acked'), 'checkmark-circle');
    },

    /* ---- discussions ---- */
    /** reactions stay weightless — deliberately not audited */
    react(id: string, emo: string) {
      if (LIVE) {
        const cur = ref.current.discussions.find(q => q.id === id);
        if (!cur) return;
        const next = cur.myReact === emo ? null : emo;
        // shown at once; the server call follows, and a failure puts it back
        const apply = (to: string | null, from: string | null | undefined) => update(d => {
          const x = d.discussions.find(q => q.id === id);
          if (!x) return;
          const r = { ...(x.reacts ?? {}) };
          if (from) r[from] = Math.max(0, (r[from] ?? 1) - 1);
          if (to) r[to] = (r[to] ?? 0) + 1;
          x.reacts = r; x.myReact = to;
        });
        apply(next, cur.myReact);
        setReaction(id, next).catch(e => { apply(cur.myReact ?? null, next); fail(e); });
        return;
      }
      update(d => {
        const x = d.discussions.find(q => q.id === id);
        if (x) x.myReact = x.myReact === emo ? null : emo;
      });
    },
    checkPost(text: string): Safety {
      return checkSafety(text, ref.current.ai.threshold);
    },
    publishPost(text: string, held = false) {
      if (LIVE) {
        const post = (confirmed: boolean) => createPost(text, confirmed).then(p => {
          update(d => { d.discussions.unshift(p); });
          toast(t(p.state === 'held' ? 'toast.held' : 'toast.published'), p.state === 'held' ? 'shield-checkmark' : 'checkmark-circle');
        }).catch(e => {
          // the server's moderation can flag what the on-phone check passed: offer to post it for review
          if (e instanceof ApiError && e.code === 'needs_review' && !confirmed) confirm(t('guard.serverT'), e.message, t('guard.serverOk'), t('common.cancel'), () => { void post(true); });
          else fail(e);
        });
        void post(held);
        return;
      }
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
      if (LIVE) {
        const ev0 = ref.current.events.find(x => x.id === id);
        if (!ev0) return;
        // the server decides seat or waitlist — two people can't both get the last seat
        rsvpLive(id).then(({ status }) => {
          update(d => {
            const ev = d.events.find(x => x.id === id);
            if (!ev || ev.mine) return;
            ev.mine = status;
            if (status === 'Going') ev.going++;
            notify(d, { icon: ev.icon, c: '#E4F7EE', tc: '#067647', t: 'RSVP ' + (status === 'Waitlist' ? 'waitlisted' : 'confirmed') + ': ' + ev.title, s: ev.when, goTo: 'events' });
            d.tried.rsvp = true;
          });
          if (status === 'Waitlist') toast(t('toast.waitlist'), 'hourglass');
          else {
            toast(t(ev0.going + 1 >= ev0.cap ? 'toast.lastSeat' : 'toast.rsvp'), 'checkmark-circle');
            scheduleEventReminder(ev0, ref.current.settings.notif, { title: 'Trinize', body: t('push.body') });
          }
        }).catch(fail);
        return;
      }
      const e = ref.current.events.find(x => x.id === id);
      if (!e) return;
      const full = e.going >= e.cap;
      update(d => {
        const ev = d.events.find(x => x.id === id)!;
        if (full) ev.mine = 'Waitlist';
        else { ev.going++; ev.mine = 'Going'; }
        notify(d, { icon: ev.icon, c: '#E4F7EE', tc: '#067647', t: 'RSVP ' + (full ? 'waitlisted' : 'confirmed') + ': ' + ev.title, s: ev.when, goTo: 'events', href: '/events?focus=' + ev.id });
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
      if (LIVE) {
        unrsvpLive(id).then(() => {
          update(d => {
            const e = d.events.find(x => x.id === id);
            if (!e) return;
            if (e.mine === 'Going') e.going = Math.max(0, e.going - 1);
            e.mine = null;
          });
          cancelEventReminder(id);
          toast(t('toast.unrsvp'), 'close-circle');
        }).catch(fail);
        return;
      }
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
      if (LIVE) {
        const p0 = ref.current.polls.find(x => x.id === pid);
        if (!p0 || p0.mine || pollClosed(p0)) return;
        voteLive(pid, idx).then(() => {
          update(d => {
            const poll = d.polls.find(x => x.id === pid);
            if (!poll || poll.mine || !poll.opts[idx]) return;
            poll.opts[idx].v++;
            poll.mine = poll.opts[idx].t;
            d.tried.vote = true;
          });
          toast(t('toast.voted'), 'checkmark-circle');
          // someone else in the flat may have voted first, or the poll closed — show what the server has
        }).catch(e => { fail(e); sync(); });
        return;
      }
      const p = ref.current.polls.find(x => x.id === pid);
      if (!p || p.mine || pollClosed(p)) return; // one vote per unit
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
      if (LIVE) {
        sendGratitudeLive(text, cat, to).then(r => {
          if (r.state === 'held') { toast(t('toast.gratHeld'), 'shield-checkmark'); return; }
          update(d => { d.gratitudes.unshift({ by: ME.name, to, cat, text, when: 'Just now' }); d.tried.gratitude = true; });
          confetti();
          toast(t('toast.gratSent'), 'heart');
        }).catch(fail);
        return 'sent';
      }
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
        audit(d, 'System', 'gratitude sent · ' + ME.name + ' → ' + to + ' · ' + cat + ' (note text private to recipient)');
        d.tried.gratitude = true;
      });
      confetti();
      toast(t('toast.gratSent'), 'heart');
      return 'sent';
    },

    /* ---- report · block · delete (store rules for user content) ---- */
    /** One report per item; it goes to the moderation queue with the reporter kept private. */
    report(o: { id: string; discId: string; by: string; unit: string; text: string; kind: 'post' | 'reply' }) {
      if (ref.current.reported.includes(o.id)) return;
      if (LIVE) {
        reportItem(o.kind, o.id).then(() => { update(d => { d.reported.push(o.id); }); toast(t('menu.reported'), 'flag'); }).catch(fail);
        return;
      }
      update(d => {
        d.reported.push(o.id);
        d.modqueue.unshift({ id: 'MOD-' + d.modSeq++, kind: o.kind === 'post' ? 'Reported post' : 'Reported reply', by: o.by, unit: o.unit, when: 'Just now', text: o.text,
          cat: 'Reported by a resident', sev: 'Medium', state: 'open', ai: 'A resident reported this. The reporter is visible to moderators only, never to the author.', ctx: 'Discussion ' + o.discId, refId: o.id });
        audit(d, 'System', 'resident report on ' + o.id + ' queued for moderation');
      });
      toast(t('menu.reported'), 'flag');
    },
    block(name: string) {
      if (name === ME.name || ref.current.blocked.includes(name)) return;
      if (LIVE) {
        blockPerson(name).then(() => { update(d => { d.blocked.push(name); }); toast(t('menu.blockedToast', { name }), 'eye-off'); }).catch(fail);
        return;
      }
      update(d => { d.blocked.push(name); });
      toast(t('menu.blockedToast', { name }), 'eye-off');
    },
    unblock(name: string) {
      if (LIVE) {
        // their posts come back, so re-read the feed
        unblockPerson(name).then(() => { update(d => { d.blocked = d.blocked.filter(n => n !== name); }); toast(t('menu.unblocked', { name }), 'eye'); void sync(); }).catch(fail);
        return;
      }
      update(d => { d.blocked = d.blocked.filter(n => n !== name); });
      toast(t('menu.unblocked', { name }), 'eye');
    },
    /** residents can always take down what they wrote */
    deleteMine(discId: string, replyId?: string) {
      if (LIVE) {
        (replyId ? deleteReply(replyId) : deletePost(discId)).then(() => {
          update(d => {
            if (!replyId) { d.discussions = d.discussions.filter(x => x.id !== discId); return; }
            const x = d.discussions.find(q => q.id === discId);
            const r = x?.thread?.find(q => q.id === replyId);
            if (!x || !r) return;
            x.thread = x.thread!.filter(q => q.id !== replyId);
            if (!r.held) x.comments = Math.max(0, x.comments - 1);
          });
          toast(t('menu.deleted'), 'trash');
        }).catch(fail);
        return;
      }
      update(d => {
        if (!replyId) { d.discussions = d.discussions.filter(x => !(x.id === discId && x.by === ME.name)); return; }
        const x = d.discussions.find(q => q.id === discId);
        const r = x?.thread?.find(q => q.id === replyId);
        if (!x || !r || r.by !== ME.name) return;
        x.thread = x.thread!.filter(q => q.id !== replyId);
        if (!r.held) x.comments = Math.max(0, x.comments - 1);
      });
      toast(t('menu.deleted'), 'trash');
    },

    /* ---- first run ---- */
    setWelcomed(v: boolean) {
      update(d => { d.welcomed = v; });
    },
    /** connected to the API: the server erases the account; either way this phone's copy goes too */
    async deleteAccount(): Promise<boolean> {
      if (LIVE) {
        try { await deleteAccountLive(); } catch (e) { fail(e); return false; }
      }
      wipe();
      return true;
    },
    /** open a post: the feed carries counts only, the thread is read when the post is opened */
    loadPost(id: string) {
      if (!LIVE) return;
      fetchPost(id).then(p => update(d => { d.discussions = d.discussions.map(x => (x.id === id ? p : x)); })).catch(() => {});
    },

    /* ---- notifications ---- */
    readNotif(id: number) {
      if (LIVE && id >= SERVER_NOTIF_BASE) readNotifLive(id).catch(() => {});
      update(d => { const n = d.notifs.find(x => x.id === id); if (n) n.unread = false; });
    },
    markAllRead() {
      if (LIVE) readAllNotifsLive().catch(() => {});
      update(d => { d.notifs.forEach(n => { n.unread = false; }); });
    },

    /* ---- profile settings ---- */
    toggleNotif(key: keyof NotifPrefs) {
      const next = !(ref.current.settings.notif[key] ?? true); // a switch this build has not stored yet counts as on
      update(d => { d.settings.notif[key] = next; });
      if (LIVE) saveSettings({ notif: { [key]: next } }).catch(e => { update(d => { d.settings.notif[key] = !next; }); fail(e); });
    },
    togglePrivacy(key: keyof PrivacyPrefs) {
      const next = !ref.current.settings.privacy[key];
      update(d => { d.settings.privacy[key] = next; });
      if (LIVE) saveSettings({ privacy: { [key]: next } }).catch(e => { update(d => { d.settings.privacy[key] = !next; }); fail(e); });
    },
    clearChat() {
      // "removes every message" — earlier sessions too, so Helpful chats drops to 0 with it
      if (LIVE) clearAssistantHistory().catch(() => {}); // the server's copy goes too
      update(d => { d.chat = initialChat(); d.me.pastChats = []; if (d.me.chats !== null) d.me.chats = 0; });
      toast(t('pv.cleared'), 'trash');
    },

    /* ---- discussion replies ---- */
    /** 'block' posts nothing; 'warn' posts a held reply only the author sees, queued for moderation */
    reply(id: string, text: string): Safety['level'] {
      const safety = checkSafety(text, ref.current.ai.threshold);
      if (safety.level === 'block') { update(d => { d.tried.guard = true; }); return 'block'; }
      const held = safety.level === 'warn';
      if (LIVE) {
        createReply(id, text).then(r => {
          update(d => {
            const x = d.discussions.find(q => q.id === id);
            if (!x) return;
            (x.thread ??= []).push(r);
            if (!r.held) x.comments++;
          });
          toast(t(r.held ? 'post.heldReply' : 'post.posted'), r.held ? 'shield-checkmark' : 'chatbubble');
        }).catch(fail);
        return safety.level;
      }
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
    /** the resident says the fix worked: the ticket closes */
    confirmFixed(id: string) {
      if (!LIVE) { update(d => { const i = d.issues.find(x => x.id === id); if (i) { i.status = 'Closed'; i.tl.push({ s: 'Closed', w: 'Just now', n: 'Confirmed fixed by the resident' }); } }); toast(t('issue.confirmed'), 'checkmark-circle'); return; }
      confirmIssueLive(id).then(issue => { update(d => { d.issues = d.issues.map(x => (x.id === id ? issue : x)); }); toast(t('issue.confirmed'), 'checkmark-circle'); }).catch(fail);
    },
    reopenIssue(id: string, reason: string) {
      if (LIVE) {
        reopenIssueLive(id, reason).then(issue => {
          update(d => {
            d.issues = d.issues.map(x => (x.id === id ? issue : x));
            notify(d, { icon: 'refresh', c: '#FEF0DC', tc: '#B54708', t: id + ' reopened', s: 'Back with the society office', goTo: 'issues', href: '/issues/' + id });
          });
          toast(t('issue.reopened'), 'refresh');
        }).catch(fail);
        return;
      }
      update(d => {
        const i = d.issues.find(x => x.id === id);
        if (!i) return;
        i.status = 'Acknowledged';
        i.slaState = 'ok';
        i.sla = 'Reopened · response due in 24h';
        i.tl.push({ s: 'Acknowledged', w: 'Just now', n: 'Reopened by resident: ' + reason });
        notify(d, { icon: 'refresh', c: '#FEF0DC', tc: '#B54708', t: i.id + ' reopened', s: 'Back in the admin queue', goTo: 'issues', href: '/issues/' + i.id });
        audit(d, ME.name + ' (' + ME.unit + ')', 'reopened ' + i.id + ' · reason: ' + reason);
      });
      toast(t('issue.reopened'), 'refresh');
    },
    addIssueUpdate(id: string, text: string, photo?: string) {
      if (LIVE) {
        addIssueUpdateLive(id, text, photo).then(issue => {
          update(d => { d.issues = d.issues.map(x => (x.id === id ? issue : x)); });
          toast(t('issue.updateSent'), 'send');
        }).catch(fail);
        return;
      }
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
      if (LIVE) {
        suggestLive(s).then(sg => { update(d => { d.suggestions.unshift(sg); }); toast(t('sug.sent'), 'calendar'); }).catch(fail);
        return;
      }
      update(d => {
        d.suggestions.unshift({ ...s, id: 'S-' + d.sugSeq++, status: 'pending' });
        audit(d, ME.name + ' (' + ME.unit + ')', 'event suggestion · ' + s.title + ' · awaiting committee');
      });
      toast(t('sug.sent'), 'calendar');
    },

    /** sign-out: save this number's data, then clear the screen so the next number starts fresh */
    reset() {
      release();
    },

    /* ---- unit & family ---- */
    addMember(m: Pick<Member, 'name' | 'rel' | 'phone'>) {
      if (LIVE) {
        addMemberLive(m).then(row => { update(d => { d.family.push({ ...row, rel: m.rel }); }); toast(t('fam.added', { name: m.name }), 'person-add'); }).catch(fail);
        return;
      }
      update(d => {
        d.family.push({ ...m, id: 'M' + d.famSeq++, pending: true });
        audit(d, 'System', 'family member added · ' + m.name + ' (' + m.rel + ') → ' + ME.unit + ' · pending verification');
      });
      toast(t('fam.added', { name: m.name }), 'person-add');
    },
    removeMember(id: string) {
      const m = ref.current.family.find(x => x.id === id);
      if (!m || m.you) return; // the signed-in owner can't remove themselves
      if (LIVE) {
        removeMemberLive(id).then(() => { update(d => { d.family = d.family.filter(x => x.id !== id); }); toast(t('fam.removed', { name: m.name }), 'person-remove'); }).catch(fail);
        return;
      }
      update(d => { d.family = d.family.filter(x => x.id !== id); });
      toast(t('fam.removed', { name: m.name }), 'person-remove');
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `fail` only closes over toast and t
  }), [update, ref, release, wipe, sync, toast, confetti, t]);
}

/** `ready`: the signed-in number's saved data has loaded (until then `state` is the fresh seed) */
type Store = { state: State; actions: ReturnType<typeof useActions>; ready: boolean };
const StoreCtx = createContext<Store | null>(null);

export function StoreProvider({ initial = firstState, children }: { initial?: State; children: ReactNode }) {
  const [state, setState] = useState<State>(initial);
  const { signedIn, phone, role } = useAuth();
  // resident data only: a property manager's login has no household, feed or settings to load
  const owner = signedIn && role === 'resident' ? phone : '';
  /** the number whose data `state` holds right now ('' = nobody's: signed out, or still loading) */
  const holder = useRef(owner);
  /** the number whose saved data has arrived — state, so screens re-render when it does */
  const [loadedFor, setLoadedFor] = useState(owner);

  // signing in loads that number's saved data; nothing is written until it has arrived
  useEffect(() => {
    if (!owner || holder.current === owner) return;
    let live = true;
    loadStore(owner).then(s => { if (!live) return; holder.current = owner; setState(s); setLoadedFor(owner); });
    return () => { live = false; };
  }, [owner]);

  // debounced so a burst of taps (typing a chat, toggling switches) writes once
  useEffect(() => {
    if (!owner || holder.current !== owner) return;
    const h = setTimeout(() => saveStore(owner, state), 400);
    return () => clearTimeout(h);
  }, [state, owner]);
  const ref = useRef(state);
  // actions read the latest committed state from here; handlers only ever run after a commit
  useLayoutEffect(() => { ref.current = state; });
  const update = useCallback((fn: (d: Draft<State>) => void) => setState(s => produce(s, fn)), []);
  const release = useCallback(() => {
    // now, not after the debounce — the app may be closed right after signing out
    if (holder.current) saveStore(holder.current, ref.current);
    holder.current = '';
    setLoadedFor('');
    resetIdentity();
    setState(firstState);
  }, []);
  const wipe = useCallback(() => {
    if (holder.current) deleteStore(holder.current);
    holder.current = '';
    setLoadedFor('');
    resetIdentity();
    setState(firstState);
  }, []);
  const { toast, confetti } = useUI();
  const { t } = useT();
  const offlineMsg = useRef('');
  useLayoutEffect(() => { offlineMsg.current = t('live.offline'); });
  /** LIVE: issues, notices, events and polls come from the server; the saved copy is what shows while offline */
  const sync = useCallback(async () => {
    if (!LIVE || !holder.current) return;
    const forWhom = holder.current;
    try {
      const [fresh, com] = await Promise.all([fetchAll(), fetchCommunity()]);
      if (holder.current !== forWhom) return; // signed out, or someone else signed in, while it loaded
      setState(s => ({
        ...s, ...fresh,
        // keep threads already opened: the feed only carries counts
        discussions: com.discussions.map(p => { const old = s.discussions.find(x => x.id === p.id); return old?.thread ? { ...p, thread: old.thread } : p; }),
        gratitudes: com.gratitudes, settings: com.settings, family: com.family, suggestions: com.suggestions, blocked: com.blocked,
        directory: com.directory, who: com.who,
        // the resident's own figures: days the app was opened, streaks, and questions put to the assistant
        me: com.impact ? { days: com.impact.days, streak: com.impact.streak, best: com.impact.best, last14: com.impact.last14, chats: com.impact.chats, pastChats: com.impact.recentQuestions } : s.me,
        // the server's notifications, plus the ones this phone raised itself ("ISS-1044 created") since signing in
        notifs: [...s.notifs.filter(n => n.id >= 7 && n.id < SERVER_NOTIF_BASE), ...com.notifs],
        modqueue: [], audit: [],
      }));
    } catch (e) {
      if (holder.current === forWhom) toast(e instanceof ApiError ? e.message : offlineMsg.current, 'cloud-offline');
    }
  }, [toast]);
  const actions = useActions(update, ref, release, wipe, sync);
  // a pull-to-refresh on any screen reads everything again
  useEffect(() => registerStoreRefresh(sync), [sync]);
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

  const ready = !!owner && loadedFor === owner;
  // sync only sets state after the network answers, never during the effect itself
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (ready) sync(); }, [ready, sync]);
  const value = useMemo(() => ({ state, actions, ready }), [state, actions, ready]);
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export function useStore() {
  const s = useContext(StoreCtx);
  if (!s) throw new Error('useStore must be used inside <StoreProvider>');
  return s;
}

export const unreadCount = (s: State) => s.notifs.filter(n => n.unread).length;
