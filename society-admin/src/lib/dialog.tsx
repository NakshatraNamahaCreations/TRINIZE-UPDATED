import { Question, Warning, X } from '@phosphor-icons/react';
import { useEffect, useRef, useState, type FormEvent } from 'react';

/* The console's own dialogs, in place of the browser's confirm / prompt / alert boxes.
   One host is mounted at the root; anywhere in the app asks a question with a function call and awaits the answer:

     if (!(await confirmBox('Remove Ramesh? They are signed out at once.'))) return;
     const reason = await promptBox('Reverse RCP-000123? Give the reason.');
     const v = await formBox({ title: 'Flat T1-1503', fields: [{ key: 'area', label: 'Area in sq ft' }, …] });

   Dialogs asked for while one is open wait their turn. Escape or a click outside cancels. */

export type Field = {
  key: string; label: string; value?: string; placeholder?: string; hint?: string;
  type?: 'text' | 'number' | 'password' | 'textarea';
  /** a fixed set of answers: shown as a list to pick from */
  options?: readonly string[];
  /** the dialog cannot be confirmed while this is empty */
  required?: boolean;
};
export type DialogSpec = {
  title: string; body?: string; fields?: Field[];
  confirm?: string; /** null: an information box with a single button */ cancel?: string | null;
  /** a destructive action: the confirm button is red */
  danger?: boolean;
  /** the confirm button stays off until this exact text is typed into the first field (capitals ignored) */
  match?: string;
};
type Pending = DialogSpec & { settle: (values: Record<string, string> | null) => void };

let push: ((p: Pending) => void) | null = null;
const queue: Pending[] = [];
const ask = (spec: DialogSpec) => new Promise<Record<string, string> | null>(settle => {
  const p = { ...spec, settle };
  if (push) push(p); else queue.push(p);
});

/** the question as a heading, whatever follows it as the explanation: "Remove X? They are signed out." */
function split(message: string): { title: string; body?: string } {
  const text = message.trim();
  const line = text.indexOf('\n');
  if (line > 0 && line <= 90) return { title: text.slice(0, line).trim(), body: text.slice(line).trim() || undefined };
  const q = text.search(/[?.]\s/);
  if (q > 0 && q <= 90 && q < text.length - 2) return { title: text.slice(0, q + 1), body: text.slice(q + 1).trim() };
  return { title: text };
}
const DESTRUCTIVE = /^(Delete|Remove|Cancel|Block|Suspend|Reverse|Withdraw|Reopen)\b/;

/** yes or no. The confirm button takes the action's own word ("Remove", "Delete"…) and turns red when it destroys something. */
export async function confirmBox(message: string, opts: Partial<DialogSpec> = {}): Promise<boolean> {
  const verb = DESTRUCTIVE.exec(message.trim())?.[1];
  // "Cancel" as the action would sit beside a "Cancel" that backs out — say which is which
  const backOut = verb === 'Cancel' ? 'Keep it' : 'Cancel';
  return (await ask({ ...split(message), confirm: verb === 'Cancel' ? 'Yes, cancel it' : verb ?? 'Confirm', cancel: backOut, danger: !!verb, ...opts })) !== null;
}
/** one typed answer; null when backed out of. */
export async function promptBox(message: string, initial = '', opts: Partial<DialogSpec> & Partial<Field> = {}): Promise<string | null> {
  const { type, options, placeholder, hint, required, ...spec } = opts;
  const s = split(message);
  const r = await ask({ ...s, confirm: 'OK', ...spec, fields: [{ key: 'v', label: s.title, value: initial, type, options, placeholder, hint, required }] });
  return r ? r.v ?? '' : null;
}
/** something to read, one button. */
export async function alertBox(message: string, opts: Partial<DialogSpec> = {}): Promise<void> {
  await ask({ ...split(message), confirm: 'OK', cancel: null, ...opts });
}
/** several answers at once; null when backed out of. */
export const formBox = (spec: DialogSpec) => ask({ confirm: 'Save', ...spec });

export function DialogHost() {
  // anything asked before the host was on the page is picked up as it mounts
  const [waiting, setWaiting] = useState<Pending[]>(() => queue.splice(0));
  const cur = waiting[0];
  useEffect(() => {
    push = p => setWaiting(w => [...w, p]);
    return () => { push = null; };
  }, []);
  // keyed by the request itself, so each dialog starts with its own blank form
  return cur ? <Box key={waiting.length + cur.title} d={cur} done={v => { cur.settle(v); setWaiting(w => w.slice(1)); }} /> : null;
}

function Box({ d, done }: { d: Pending; done: (v: Record<string, string> | null) => void }) {
  const fields = d.fields ?? [];
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(fields.map(f => [f.key, f.value ?? (f.options ? f.options[0] ?? '' : '')])));
  const box = useRef<HTMLFormElement>(null);
  const back = useRef<HTMLElement | null>(null);
  const first = fields[0];
  // a single unlabelled question: the heading already says it, so the field needs no second label
  const lone = fields.length === 1 && first!.label === d.title;
  const ready = fields.every(f => !f.required || (v[f.key] ?? '').trim()) && (!d.match || (v[first?.key ?? ''] ?? '').trim().toLowerCase() === d.match.trim().toLowerCase());

  useEffect(() => {
    back.current = document.activeElement as HTMLElement | null;
    const el = box.current?.querySelector<HTMLElement>('[data-first]') ?? box.current?.querySelector<HTMLElement>('[data-ok]');
    el?.focus();
    if (el instanceof HTMLInputElement) el.select();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); done(null); }
      // keep Tab inside the dialog
      if (e.key === 'Tab' && box.current) {
        const all = [...box.current.querySelectorAll<HTMLElement>('input,select,textarea,button')].filter(x => !(x as HTMLButtonElement).disabled);
        const a = all[0], z = all[all.length - 1];
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z?.focus(); }
        else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a?.focus(); }
      }
    };
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('keydown', key, true); back.current?.focus?.(); };
  }, [done]);

  const submit = (e: FormEvent) => { e.preventDefault(); if (ready) done(v); };
  const set = (k: string, x: string) => setV(s => ({ ...s, [k]: x }));
  return (
    <div className="dlg-veil" onMouseDown={e => { if (e.target === e.currentTarget) done(null); }}>
      <form ref={box} className="dlg" role={d.cancel === null ? 'alertdialog' : 'dialog'} aria-modal="true" aria-labelledby="dlg-t" aria-describedby={d.body ? 'dlg-b' : undefined} onSubmit={submit}>
        <div className="dlg-h">
          <span className={'dlg-ic' + (d.danger ? ' bad' : '')}>{d.danger ? <Warning size={20} /> : <Question size={20} />}</span>
          <h2 id="dlg-t">{d.title}</h2>
          <button type="button" className="d-close" onClick={() => done(null)} aria-label="Close"><X size={17} /></button>
        </div>
        {d.body && <p id="dlg-b" className="dlg-b">{d.body}</p>}
        {fields.map((f, i) => (
          <label key={f.key} className="dlg-f">
            {!lone && <span>{f.label}</span>}
            {f.options
              ? <select className="a-in" value={v[f.key]} onChange={e => set(f.key, e.target.value)} data-first={i === 0 ? '' : undefined} aria-label={lone ? f.label : undefined}>{f.options.map(o => <option key={o}>{o}</option>)}</select>
              : f.type === 'textarea'
                ? <textarea className="a-in" rows={3} value={v[f.key]} placeholder={f.placeholder} onChange={e => set(f.key, e.target.value)} data-first={i === 0 ? '' : undefined} aria-label={lone ? f.label : undefined} />
                : <input className="a-in" type={f.type === 'password' ? 'password' : 'text'} inputMode={f.type === 'number' ? 'decimal' : undefined} value={v[f.key]} placeholder={f.placeholder} autoComplete="off"
                    onChange={e => set(f.key, e.target.value)} data-first={i === 0 ? '' : undefined} aria-label={lone ? f.label : undefined} />}
            {f.hint && <em>{f.hint}</em>}
          </label>
        ))}
        <div className="dlg-act">
          {d.cancel !== null && <button type="button" className="a-btn ghost" onClick={() => done(null)}>{d.cancel ?? 'Cancel'}</button>}
          <button type="submit" className={'a-btn' + (d.danger ? ' danger-solid' : '')} disabled={!ready} data-ok="">{d.confirm ?? 'OK'}</button>
        </div>
      </form>
    </div>
  );
}
