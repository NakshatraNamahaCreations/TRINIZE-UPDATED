import { ArrowLeft, Lifebuoy, PaperPlaneTilt, Plus } from '@phosphor-icons/react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { TableCard } from '../components/TableCard';
import { useToast } from '../components/toast-context';
import { Empty, PageHead, Pill, Stat } from '../components/ui';
import { api, ApiError, LIVE } from '../lib/api';
import { association } from '../lib/live';
import { usePlan } from '../lib/plan';

/* Help & support: the society office writes to Trinize here. Each issue lands in Trinize's own
   support queue with a response time, and the conversation stays on this page. Connected mode only. */

const A = () => `/v1/admin/${association()}/support`;
type Ticket = { id: string; ref: string; category: string; title: string; raisedBy: string; priority: 'Low' | 'Medium' | 'High'; status: 'Open' | 'In progress' | 'Resolved'; assignee: string | null; createdAt: string; resolvedAt: string | null; slaState: 'met' | 'over' | 'ok' };
type Thread = Ticket & { replies: { by: string; text: string; at: string; mine: boolean }[] };
const RESPONSE = { High: 'within 8 working hours', Medium: 'within a day', Low: 'within 3 days' } as const;
const ABOUT: Record<string, string> = { Billing: 'Your subscription, invoices or payments to Trinize', Bug: 'Something is not working as it should', Data: 'Records that look wrong, or an import or export', Access: 'Sign-in, passwords or who can see what', Feature: 'A change of plan, or something you would like added', Other: 'Anything else' };
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
const statusTone = (s: Ticket['status']) => (s === 'Resolved' ? 'good' : s === 'Open' ? 'warn' : 'acc') as 'good' | 'warn' | 'acc';
const priTone = (p: Ticket['priority']) => (p === 'High' ? 'bad' : p === 'Low' ? 'dim' : 'warn') as 'bad' | 'dim' | 'warn';
const small = { fontSize: 12, color: 'var(--ink3)' } as const;

export function Support() {
  const toast = useToast();
  const { plan } = usePlan();
  const [params, setParams] = useSearchParams();
  const [list, setList] = useState<Ticket[] | null>(null);
  const [cats, setCats] = useState<string[]>(['Billing', 'Bug', 'Data', 'Access', 'Feature', 'Other']);
  const [open, setOpen] = useState<Thread | null>(null);
  const [form, setForm] = useState<{ category: string; title: string; details: string; priority: Ticket['priority'] } | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const fail = useCallback((e: unknown) => toast(e instanceof ApiError ? e.message : 'Something went wrong.', undefined, 'warn'), [toast]);

  const load = useCallback(() => {
    if (!LIVE) return;
    api<{ categories: string[]; tickets: Ticket[] }>('GET', A()).then(r => { setList(r.tickets); setCats(r.categories); }).catch(fail);
  }, [fail]);
  useEffect(load, [load]);

  // arriving from a locked section: the request to upgrade is already written, ready to send
  const wantsUpgrade = params.get('new') === 'upgrade', to = params.get('to') ?? '';
  useEffect(() => {
    if (!wantsUpgrade) return;
    // oxlint-disable-next-line react/set-state-in-effect -- opens the form once for the link that asked for it
    setForm({ category: 'Feature', title: `Upgrade our plan${to ? ' to ' + to : ''}`, details: `We would like to move ${plan?.plan ? 'from the ' + plan.plan + ' plan ' : ''}${to ? 'to the ' + to + ' plan' : 'to a higher plan'}. Please tell us the price and what we need to do.`, priority: 'Medium' });
    setParams({}, { replace: true });
  }, [wantsUpgrade, to, plan?.plan, setParams]);

  const show = (id: string) => api<Thread>('GET', `${A()}/${id}`).then(t => { setOpen(t); setReply(''); }).catch(fail);

  const raise = async (e: FormEvent) => {
    e.preventDefault();
    if (!form || busy) return;
    setBusy(true);
    try {
      const t = await api<Thread>('POST', A(), { ...form, title: form.title.trim(), details: form.details.trim() });
      toast(`${t.ref} sent to Trinize`, `They aim to reply ${RESPONSE[t.priority]}. The answer appears on this page.`);
      setForm(null); setOpen(t); load();
    } catch (err) { fail(err); }
    setBusy(false);
  };
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!open || !reply.trim() || busy) return;
    setBusy(true);
    try {
      const was = open.status;
      const t = await api<Thread>('POST', `${A()}/${open.id}/reply`, { text: reply.trim() });
      setOpen(t); setReply('');
      toast(was === 'Resolved' ? `${t.ref} reopened` : 'Reply sent', was === 'Resolved' ? 'Trinize will look at it again.' : undefined);
      load();
    } catch (err) { fail(err); }
    setBusy(false);
  };

  if (!LIVE) return <><PageHead title="Help & support" sub="Write to Trinize about your subscription or a problem with the console" /><Empty icon={Lifebuoy} title="Available when connected" body="Support issues are sent to Trinize through the server, so this page works only in the connected console." /></>;

  if (open) {
    return (
      <>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button className="a-btn ghost" onClick={() => { setOpen(null); load(); }}><ArrowLeft size={15} />All issues</button>
        </div>
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <b style={{ fontSize: 16 }}>{open.ref} · {open.title}</b>
            <Pill tone={statusTone(open.status)}>{open.status}</Pill><Pill tone={priTone(open.priority)}>{open.priority} priority</Pill>
          </div>
          <div style={{ ...small, marginTop: 6 }}>{open.category} · raised by {open.raisedBy} on {when(open.createdAt)} · {open.assignee ? `${open.assignee} at Trinize is handling it` : 'not yet picked up by Trinize'}{open.status !== 'Resolved' && open.slaState === 'over' ? ' · past its response time' : ''}</div>
        </div>
        <div className="sup-thread">
          {open.replies.map((r, i) => (
            <div key={i} className={'sup-msg' + (r.mine ? ' mine' : '')}>
              <div className="sup-who"><b>{r.mine ? r.by : `${r.by} · Trinize`}</b><span>{when(r.at)}</span></div>
              <div className="sup-text">{r.text}</div>
            </div>
          ))}
        </div>
        <form onSubmit={send} className="card" style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          <label><b>{open.status === 'Resolved' ? 'Still not right? Write again to reopen this issue' : 'Add to this issue'}</b>
            <textarea className="a-in" rows={3} value={reply} onChange={e => setReply(e.target.value)} maxLength={4000} placeholder="Write your message to Trinize" style={{ marginTop: 6 }} />
          </label>
          <div><button className="a-btn" disabled={busy || !reply.trim()}><PaperPlaneTilt size={15} />{open.status === 'Resolved' ? 'Send and reopen' : 'Send'}</button></div>
        </form>
      </>
    );
  }

  const rows = list ?? [], waiting = rows.filter(t => t.status !== 'Resolved');
  const ready = !!form && form.title.trim().length >= 5 && form.details.trim().length >= 10;
  return (
    <>
      <PageHead title="Help & support" sub="Write to Trinize about your subscription, a problem with the console, or something you need changed"
        actions={!form && <button className="a-btn" onClick={() => setForm({ category: 'Bug', title: '', details: '', priority: 'Medium' })}><Plus size={15} />Raise an issue</button>} />

      <div className="stats">
        <Stat icon={Lifebuoy} label="Issues raised" value={rows.length} />
        <Stat label="Waiting on Trinize" value={waiting.length} tone={waiting.length ? 'acc' : undefined} />
        <Stat label="Past response time" value={waiting.filter(t => t.slaState === 'over').length} tone={waiting.some(t => t.slaState === 'over') ? 'warn' : undefined} />
        <Stat label="Resolved" value={rows.length - waiting.length} tone={rows.length > waiting.length ? 'good' : undefined} />
      </div>

      {form && (
        <form onSubmit={raise} className="card" style={{ display: 'grid', gap: 10, marginBottom: 12 }}>
          <b>Raise an issue with Trinize</b>
          <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
            <label>What is it about?<select className="a-in" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>{cats.map(c => <option key={c}>{c}</option>)}</select><span style={small}>{ABOUT[form.category]}</span></label>
            <label>How urgent is it?<select className="a-in" value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value as Ticket['priority'] })}><option value="High">High — the office cannot work</option><option value="Medium">Medium — it is in the way</option><option value="Low">Low — when you get to it</option></select><span style={small}>Trinize aims to reply {RESPONSE[form.priority]}.</span></label>
          </div>
          <label>In a few words<input className="a-in" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} maxLength={140} placeholder="e.g. Receipts are not downloading" autoFocus /></label>
          <label>What happened?<textarea className="a-in" rows={4} value={form.details} onChange={e => setForm({ ...form, details: e.target.value })} maxLength={4000} placeholder="What you were doing, what you expected, and what happened instead. Mention the flat, bill or page if it helps." /></label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="a-btn" disabled={busy || !ready}><PaperPlaneTilt size={15} />Send to Trinize</button>
            <button type="button" className="a-btn ghost" onClick={() => setForm(null)}>Cancel</button>
            {!ready && <span style={small}>Add a short title and a sentence or two about the problem.</span>}
          </div>
        </form>
      )}

      {list && rows.length === 0 ? <Empty icon={Lifebuoy} title="Nothing raised yet" body="When something is wrong with the console or your subscription, raise it here and Trinize will answer on this page." /> : (
        <TableCard rows={rows} noun="issue" search={t => [t.ref, t.title, t.category, t.raisedBy, t.assignee]} placeholder="Search by number, title or who raised it"
          filters={[{ key: 'status', label: 'Status', get: t => t.status, options: ['Open', 'In progress', 'Resolved'] }, { key: 'cat', label: 'About', get: t => t.category }, { key: 'pri', label: 'Priority', get: t => t.priority, options: ['High', 'Medium', 'Low'] }]}
          sorts={[{ label: 'Newest', by: t => t.createdAt, dir: 'desc' }, { label: 'Oldest', by: t => t.createdAt, dir: 'asc' }]}>{(page, sl) => (<div className="a-tbl-wrap">
          <table className="a-tbl">
            <thead><tr><th className="sl">Sl. no.</th><th>Issue</th><th>About</th><th>Priority</th><th>Raised</th><th>With</th><th>Status</th></tr></thead>
            <tbody>{page.map((t, rowNo) => (
              <tr key={t.id}><td className="sl num">{sl(rowNo)}</td>
                <td><button className="cell-t" onClick={() => show(t.id)}>{t.ref} · {t.title}</button></td>
                <td>{t.category}</td>
                <td><Pill tone={priTone(t.priority)}>{t.priority}</Pill></td>
                <td>{when(t.createdAt)}<div className="cell-m">by {t.raisedBy}</div></td>
                <td>{t.assignee ?? '—'}</td>
                <td><Pill tone={statusTone(t.status)}>{t.status}</Pill>{t.status !== 'Resolved' && t.slaState === 'over' && <div className="cell-m">past response time</div>}</td>
              </tr>
            ))}</tbody>
          </table></div>)}
        </TableCard>
      )}
    </>
  );
}
