import type { Issue, ModItem, User } from '../store/data';

export type PillTone = 'good' | 'warn' | 'bad' | 'acc' | 'dim';

export const priTone = (p: Issue['pri']): PillTone => (p === 'High' ? 'bad' : p === 'Low' ? 'dim' : 'warn');
export const slaTone = (s: Issue['slaState']): PillTone => (s === 'over' ? 'bad' : s === 'met' ? 'good' : 'dim');
export const statusTone = (s: Issue['status']): PillTone => (s === 'Resolved' || s === 'Closed' ? 'good' : s === 'Submitted' ? 'dim' : 'acc');
export const sevTone = (s: ModItem['sev']): PillTone => (s === 'High' ? 'bad' : s === 'Medium' ? 'warn' : 'dim');
export const userTone = (s: User['status']): PillTone => (s === 'Active' ? 'good' : s === 'Warned' ? 'warn' : 'bad');

export const initials = (n: string) =>
  n.replace(/\(.*?\)/g, '').split(/\s+/).filter(w => /^[A-Za-z]/.test(w)).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?';

const AVATARS: [string, string][] = [
  ['#EFEAFE', '#6D28D9'], ['#E3F3FC', '#0369A1'], ['#E4F7EE', '#067647'],
  ['#FEF0DC', '#B54708'], ['#FCE7F3', '#BE185D'], ['#E0E7FF', '#4338CA'],
];
/** stable tint per person, so the same resident always looks the same */
export function avatarColor(name: string): [string, string] {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATARS[h % AVATARS.length];
}

/** Download rows as a CSV file (Excel-friendly, UTF-8 with BOM). */
export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const cell = (v: string | number) => '"' + String(v).replace(/"/g, '""') + '"';
  const csv = '﻿' + rows.map(r => r.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  URL.revokeObjectURL(url);
}

export const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
};
