import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { copilotAnswer, COPILOT_INTRO } from '../data/copilot';
import { PATHS } from '../data/nav';
import { FEED, findAssoc, INVOICES, ISSUES, OPERATOR } from '../data/portal';
import { PortalCtx } from './context';

export function PortalProvider({ children }) {
  const navigate = useNavigate();

  /* demo records that change as the operator acts */
  const [done, setDone] = useState({});
  const [feed, setFeed] = useState(FEED);
  const [issues, setIssues] = useState(ISSUES);
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

  const chase = useCallback(invId => {
    const inv = INVOICES.find(x => x.id === invId), a = findAssoc(inv.a);
    toast('Reminder sent · ' + invId, a.admin + ' at ' + a.em + ' · payment link included · logged to the account', 'outbox_tray');
    log('sent a payment reminder for ' + invId + ' · ' + a.n);
  }, [toast, log]);

  const assignIssue = useCallback((id, pm) => {
    setIssues(list => list.map(i => (i.id === id ? { ...i, pm, st: i.st === 'Open' ? 'In progress' : i.st } : i)));
    log('assigned ' + id + ' to ' + pm);
    setModal(null);
    toast(id + ' assigned to ' + pm, 'Raiser notified · activity logged', 'check_mark_button');
  }, [toast, log]);

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
    done, feed, issues, view, patchView,
    go, doAct, chase, assignIssue, toast,
    toastMsg, modal, openModal, closeModal,
    cmdkOpen, setCmdkOpen, tip, showTip, hideTip,
    cop, openCop, closeCop, copAsk,
  }), [done, feed, issues, view, patchView, go, doAct, chase, assignIssue, toast, toastMsg, modal, openModal, closeModal, cmdkOpen, tip, showTip, hideTip, cop, openCop, closeCop, copAsk]);

  return <PortalCtx.Provider value={value}>{children}</PortalCtx.Provider>;
}
