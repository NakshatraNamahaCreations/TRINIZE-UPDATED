import { produce, type Draft } from 'immer';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useToast } from '../components/toast-context';
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

function audit(d: Draft<State>, what: string, who = ADMIN.name) {
  d.audit.unshift({ who, what, when: 'Just now' });
}

function useActions(update: (fn: (d: Draft<State>) => void) => void, ref: { current: State }, reset: () => void) {
  const toast = useToast();

  return useMemo(() => ({
    reset() {
      reset();
      toast('Demo data restored', 'Every record is back to its starting state.');
    },

    /* ---- issues ---- */
    advanceIssue(id: string, { note, internal, vendor }: { note: string; internal: boolean; vendor?: string }) {
      const cur = ref.current.issues.find(x => x.id === id);
      const to = cur && FLOW[cur.status];
      if (!cur || !to) return;
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
      update(d => {
        d.announcements.unshift({ id: 'AN-' + d.anSeq++, title, body, pri, aud, when: 'Just now', by: ADMIN.name, ack: pri === 'High', read: 0 });
        audit(d, 'published announcement “' + title.slice(0, 50) + '” to ' + aud + ' · priority ' + pri);
      });
      toast('Published', aud === 'Committee only' ? 'Committee-only — it will not appear in the resident app' : 'On the resident home screen, with a privacy-safe push');
      return true;
    },

    /* ---- users ---- */
    restrictUser(n: string) {
      update(d => {
        const u = d.users.find(x => x.n === n)!;
        u.status = 'Restricted';
        audit(d, 'restricted ' + u.n + ' for 24h · reason: “community guidelines — repeated hostility” · auto-expires');
      });
      toast(n + ' restricted for 24h', 'Loses posting only · auto-expires · user notified with reason · audit entry written');
    },
    reactivateUser(n: string) {
      update(d => {
        const u = d.users.find(x => x.n === n)!;
        u.status = 'Active';
        audit(d, 'reactivated ' + u.n);
      });
      toast(n + ' reactivated');
    },

    /* ---- AI controls ---- */
    toggleFeature(key: 'qna' | 'issueCreate' | 'toneRewrite' | 'summaries') {
      update(d => { d.ai[key] = !d.ai[key]; });
      toast('Setting saved — the resident app updates instantly');
    },
    toggleTone(tone: Tone) {
      const was = ref.current.ai.tones[tone];
      update(d => { d.ai.tones[tone] = !was; });
      toast('Tone ' + (was ? 'disabled' : 'enabled') + ' — check the resident composer');
    },
    setThreshold(v: State['ai']['threshold']) {
      update(d => { d.ai.threshold = v; });
      toast('Threshold saved');
    },
    setAutoHold(v: State['ai']['autoHold']) {
      update(d => { d.ai.autoHold = v; });
      toast('Saved');
    },
  }), [update, ref, reset, toast]);
}

export type Actions = ReturnType<typeof useActions>;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(load);
  const ref = useRef(state);
  // actions read the latest committed state; handlers only run after a commit
  useLayoutEffect(() => { ref.current = state; });
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full or blocked */ }
  }, [state]);

  const update = useCallback((fn: (d: Draft<State>) => void) => setState(s => produce(s, fn)), []);
  const reset = useCallback(() => setState(initialState()), []);
  const actions = useActions(update, ref, reset);
  const value = useMemo(() => ({ state, actions }), [state, actions]);
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}
