import { ChartBar, ClipboardText, type Icon as IconType, Megaphone, Robot, ShieldCheck, SquaresFour, Ticket, UsersThree } from '@phosphor-icons/react';

export type NavKey = 'issues' | 'moderation';
export type NavItem = { to: string; icon: IconType; label: string; badge?: NavKey };

/** Single source for the sidebar and the header breadcrumb. */
export const NAV: [string, NavItem[]][] = [
  ['Overview', [{ to: '/dashboard', icon: SquaresFour, label: 'Dashboard' }]],
  ['Operations', [
    { to: '/issues', icon: Ticket, label: 'Issues', badge: 'issues' },
    { to: '/moderation', icon: ShieldCheck, label: 'Moderation', badge: 'moderation' },
  ]],
  ['Engage', [
    { to: '/announcements', icon: Megaphone, label: 'Announcements' },
    { to: '/events-polls', icon: ChartBar, label: 'Events & Polls' },
  ]],
  ['Manage', [
    { to: '/users', icon: UsersThree, label: 'Users & Units' },
    { to: '/ai', icon: Robot, label: 'AI Assistant' },
    { to: '/audit', icon: ClipboardText, label: 'Audit log' },
  ]],
];

export function crumbFor(pathname: string): [string, string] {
  for (const [grp, items] of NAV) {
    const hit = items.find(i => pathname.startsWith(i.to));
    if (hit) return [grp, hit.label];
  }
  return ['Overview', 'Dashboard'];
}
