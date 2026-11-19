import type { IconName } from '@/components/Icon';

/* Every "are you sure?" in the app goes through here and is drawn by <Dialog /> (components/Dialog.tsx),
   the app's own dialog — never the phone's system alert, which ignores the app's type and colours. */

export type DialogTone = 'danger' | 'primary';
export type DialogAsk = {
  title: string; body: string; ok: string; cancel: string; onOk: () => void;
  /** danger = removing, cancelling, signing out, raising an alarm; primary = going ahead with something */
  tone: DialogTone;
  icon?: IconName;
};

let show: ((ask: DialogAsk) => void) | null = null;
/** <Dialog /> registers itself here when the app starts */
export function bindDialog(fn: ((ask: DialogAsk) => void) | null) { show = fn; }

/** Two-button confirm in the app's own dialog. `onOk` runs only when the person taps the confirm button. */
export function confirm(title: string, body: string, ok: string, cancel: string, onOk: () => void, opts: { tone?: DialogTone; icon?: IconName } = {}) {
  show?.({ title, body, ok, cancel, onOk, tone: opts.tone ?? 'danger', icon: opts.icon });
}
