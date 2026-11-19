import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { copilotAnswer, COPILOT_INTRO } from '../data/copilot';
import { PATHS } from '../data/nav';
import { ASSOC, FEED, findAssoc, fmtI, hydrate, INVOICES, ISSUES, OPERATOR, VPMS } from '../data/portal';
import { LIVE } from '../lib/api';
import * as live from '../lib/live';
import { PortalCtx, useAuth } from './context';

export function PortalProvider({ children }) {
  const navigate = useNavigate();
  const { session } = useAuth();
  /** identifies this sign-in; token refreshes keep it */
  const sid = session?.at ?? null;

  /* records that change as the operator acts — demo: in memory; connected: re-read from the server */
  const [done, setDone] = useState({});
  const [feed, setFeed] = useState(FEED);
  const [issues, setIssues] = useState(ISSUES);
  const [vpms, setVpms] = useState(VPMS);
  /* connected mode: `ready` once the first load lands; `version` changes whenever the records are re-read */
  const [loadedFor, setLoadedFor] = useState(null);
  const ready = !LIVE || (sid !== null && loadedFor === sid);
  const [loadError, setLoadError] = useState(null);
  const [version, setVersion] = useState(0);
  /* view state kept across pages, like the original's V object */
  const [view, setView] = useState({ assocFilter: 'All', issueFilter: 'All', modCat: 'All', plan: 'Enterprise', lastAssoc: 'asn-2' });
  const patchView = useCallback(p => setView(v => ({ ...v, ...p })), []);

  /* overlays */
  const [toastMsg, setToastMsg] = useState(null);
  const [modal, setModal] = useState(null);
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [tip, setTip] = useState(null);
  const [cop, setCop] = useState({ open: false, log: [], busy: false });
  const copBusy = useRef(false);

  /** `icon` names a 3D icon (public/icons3d); the toast falls back to 'information' */
  const toast = useCallback((msg, sub, icon) => setToastMsg({ msg, sub, icon, key: Date.now() }), []);
  const openModal = useCallback(node => setModal(node), []);
  const closeModal = useCallback(() => setModal(null), []);
  const showTip = useCallback((content, e) => setTip({ content, x: e.clientX + 12, y: e.clientY - 34 }), []);
  const hideTip = useCallback(() => setTip(null), []);
  const fail = useCallback(e => toast(e?.message ?? 'Something went wrong.', undefined, 'warning'), [toast]);

  /** connected: read everything again and repaint */
  const reload = useCallback(async firstFor => {
    if (!LIVE) return;
    try {
      hydrate(await live.loadPortal());
      setIssues([...ISSUES]); setFeed([...FEED]); setVpms([...VPMS]);
      setView(v => (findAssoc(v.lastAssoc) ? v : { ...v, lastAssoc: ASSOC[0]?.id }));
      setVersion(n => n + 1);
      setLoadError(null);
      if (typeof firstFor === 'number') setLoadedFor(firstFor);
    } catch (e) {
      setLoadError(e?.message ?? 'Couldn’t load the portal.');
    }
  }, []);

  useEffect(() => {
    if (!LIVE || sid === null) return;
    // oxlint-disable-next-line react/set-state-in-effect -- reads from the server; state is set when it answers
    void reload(sid);
    // other operators and the societies themselves change these records; keep the page current
    const h = setInterval(() => { if (document.visibilityState === 'visible') void reload(); }, 60000);
    return () => clearInterval(h);
  }, [sid, reload]);

  const go = useCallback((page, id) => {
    if (page === 'a360') navigate('/associations/' + (id ?? view.lastAssoc));
    else navigate(PATHS[page] ?? '/');
  }, [navigate, view.lastAssoc]);

  const log = useCallback(what => setFeed(f => [{ who: OPERATOR.name, what, when: 'Just now' }, ...f]), []);

  const doAct = useCallback((id, msg, sub) => {
    setDone(d => ({ ...d, [id]: true }));
    toast(msg, sub, 'check_mark_button');
    log(msg.toLowerCase());
  }, [toast, log]);

  const chase = useCallback(async invId => {
    const inv = INVOICES.find(x => x.id === invId), a = findAssoc(inv.a);
    if (LIVE) {
      try {
        const r = await live.chaseInvoice(inv.uid);
        const to = r.to ? [a.admin, r.to].filter(Boolean).join(' at ') : a.admin;
        if (r.delivered) toast('Reminder ' + r.chases + ' emailed · ' + invId, 'Sent to ' + to + ' and recorded on the account.', 'outbox_tray');
        else if (r.delivery === 'Skipped') toast('Reminder ' + r.chases + ' recorded, not sent · ' + invId, (r.deliveryDetail || 'No email address is on file') + '. Add one with Edit details on the society’s page.', 'warning');
        else if (r.delivery === 'Failed') toast('Reminder ' + r.chases + ' could not be sent · ' + invId, (r.deliveryDetail || 'The mail provider refused it') + ' It is recorded on the account.', 'warning');
        else toast('Reminder ' + r.chases + ' recorded · ' + invId, 'Written for ' + to + ', but no mail provider is connected on the server yet, so it has not left. Call them, or connect a provider.', 'outbox_tray');
        await reload();
      } catch (e) { fail(e); }
      return;
    }
    toast('Reminder sent · ' + invId, a.admin + ' at ' + a.em + ' · payment link included · logged to the account', 'outbox_tray');
    log('sent a payment reminder for ' + invId + ' · ' + a.n);
  }, [toast, log, reload, fail]);

  /** connected only: money received against an invoice */
  const recordPayment = useCallback(async (invId, amount) => {
    const inv = INVOICES.find(x => x.id === invId);
    try {
      const r = await live.payInvoice(inv.uid, amount);
      setModal(null);
      toast(fmtI(amount) + ' recorded · ' + invId, r.state === 'Paid' ? 'Invoice is now fully paid.' : 'Part paid — the balance stays in collections.', 'check_mark_button');
      await reload();
    } catch (e) { fail(e); }
  }, [toast, reload, fail]);

  const assignIssue = useCallback(async (id, pm, note = '', resolve = false) => {
    if (LIVE) {
      const i = ISSUES.find(x => x.id === id);
      try {
        if (pm && pm !== 'Unassigned' && pm !== i.pm) await live.assignTicket(i.uid, pm);
        if (note.trim()) await live.replyTicket(i.uid, note.trim(), resolve);
        setModal(null);
        toast(resolve && note.trim() ? id + ' resolved' : id + ' updated', [pm !== i.pm && 'Assigned to ' + pm, note.trim() && 'Reply saved on the ticket'].filter(Boolean).join(' · ') || 'No change', 'check_mark_button');
        await reload();
      } catch (e) { fail(e); }
      return;
    }
    setIssues(list => list.map(i => (i.id === id ? { ...i, pm, st: i.st === 'Open' ? 'In progress' : i.st } : i)));
    log('assigned ' + id + ' to ' + pm);
    setModal(null);
    toast(id + ' assigned to ' + pm, 'Raiser notified · activity logged', 'check_mark_button');
  }, [toast, log, reload, fail]);

  /** connected only: plan, state, annual value or renewal date of an account */
  const updateSubscription = useCallback(async (id, patch, msg) => {
    try {
      await live.setSubscription(id, patch);
      toast(msg ?? 'Subscription updated', findAssoc(id)?.n, 'check_mark_button');
      await reload();
      return true;
    } catch (e) { fail(e); return false; }
  }, [toast, reload, fail]);

  /** connected only: a new society with its subscription and first admin login; resolves to an error message or null */
  const onboardAssociation = useCallback(async body => {
    try {
      const a = await live.onboard(body);
      await reload();
      setModal(null);
      toast(a.name + ' onboarded', a.adminLogin ? 'Its admin can sign in to the society console now.' : 'No console login was created for its admin.', 'check_mark_button');
      navigate('/associations/' + a.id);
      return null;
    } catch (e) { return e?.message ?? 'Something went wrong.'; }
  }, [toast, reload, navigate]);

  /* ---- property managers (VPMs): each resolves to an error message, or null on success ---- */
  const societiesOf = ids => ids.map(id => ({ id, name: findAssoc(id)?.n ?? '' }));
  const createManager = useCallback(async v => {
    if (LIVE) {
      try { await live.createVpm({ name: v.name, phone: v.phone, email: v.email || undefined, associationIds: v.associationIds }); await reload(); }
      catch (e) { return e?.message ?? 'Something went wrong.'; }
    } else {
      if (VPMS.some(x => x.phone === v.phone)) return 'That number already belongs to a property manager.';
      VPMS.push({ id: 'vpm-' + Date.now(), name: v.name, phone: v.phone, email: v.email || null, societies: societiesOf(v.associationIds), openIssues: 0 });
      setVpms([...VPMS]);
      log('created property manager ' + v.name);
    }
    setModal(null);
    toast(v.name + ' added', 'They sign in to the mobile app with ' + v.phone + ' and a one-time code.', 'check_mark_button');
    return null;
  }, [reload, toast, log]);

  const assignManager = useCallback(async (id, associationIds) => {
    const m = VPMS.find(x => x.id === id);
    if (LIVE) {
      try { await live.setVpmSocieties(id, associationIds); await reload(); }
      catch (e) { return e?.message ?? 'Something went wrong.'; }
    } else {
      m.societies = societiesOf(associationIds);
      setVpms([...VPMS]);
      log('reassigned ' + m.name);
    }
    setModal(null);
    toast(m.name + ' now manages ' + associationIds.length + (associationIds.length === 1 ? ' society' : ' societies'), 'Access to any society you removed has ended.', 'check_mark_button');
    return null;
  }, [reload, toast, log]);

  const removeManager = useCallback(async id => {
    const m = VPMS.find(x => x.id === id);
    if (LIVE) {
      try { await live.removeVpm(id); await reload(); }
      catch (e) { return e?.message ?? 'Something went wrong.'; }
    } else {
      VPMS.splice(VPMS.indexOf(m), 1);
      setVpms([...VPMS]);
      log('removed property manager ' + m.name);
    }
    setModal(null);
    toast(m.name + ' removed', 'They are signed out of the app and can no longer see any society.', 'check_mark_button');
    return null;
  }, [reload, toast, log]);

  /* ---- copilot ---- */
  const openCop = useCallback(() => setCop(c => ({ ...c, open: true, log: c.log.length ? c.log : [COPILOT_INTRO] })), []);
  const closeCop = useCallback(() => setCop(c => ({ ...c, open: false })), []);
  const copAsk = useCallback(text => {
    if (copBusy.current) return;
    copBusy.current = true;
    setCop(c => ({ open: true, busy: true, log: [...(c.log.length ? c.log : [COPILOT_INTRO]), { who: 'me', t: text }, { who: 'typing' }] }));
    setTimeout(() => {
      copBusy.current = false;
      setCop(c => ({ ...c, busy: false, log: [...c.log.filter(m => m.who !== 'typing'), copilotAnswer(text)] }));
    }, 620);
  }, []);

  /* ⌘K / Ctrl+K toggles search; Esc closes every overlay */
  useEffect(() => {
    const onKey = e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setCmdkOpen(o => !o); }
      else if (e.key === 'Escape') { setCmdkOpen(false); setModal(null); setCop(c => ({ ...c, open: false })); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const value = useMemo(() => ({
    done, feed, issues, vpms, view, patchView, ready, loadError, version, reload,
    go, doAct, chase, recordPayment, assignIssue, updateSubscription, onboardAssociation,
    createManager, assignManager, removeManager, toast,
    toastMsg, modal, openModal, closeModal,
    cmdkOpen, setCmdkOpen, tip, showTip, hideTip,
    cop, openCop, closeCop, copAsk,
  }), [done, feed, issues, vpms, view, patchView, ready, loadError, version, reload, go, doAct, chase, recordPayment, assignIssue, updateSubscription, onboardAssociation,
    createManager, assignManager, removeManager, toast, toastMsg, modal, openModal, closeModal, cmdkOpen, tip, showTip, hideTip, cop, openCop, closeCop, copAsk]);

  return <PortalCtx.Provider value={value}>{children}</PortalCtx.Provider>;
}
