import { AddressBook, ChartBar, Images, Lifebuoy, ChatsCircle, ClipboardText, ListChecks, Sparkle, CurrencyInr, Door, Key, Wrench, type Icon as IconType, Megaphone, Buildings, Robot, UserGear, ShieldCheck, SquaresFour, Ticket, UsersThree } from '@phosphor-icons/react';

export type NavKey = 'issues' | 'moderation';
export type NavItem = { to: string; icon: IconType; label: string; badge?: NavKey };

/** Single source for the sidebar and the header breadcrumb. */
export const NAV: [string, NavItem[]][] = [
  ['Overview', [
    { to: '/dashboard', icon: SquaresFour, label: 'Dashboard' },
    { to: '/assistant', icon: Sparkle, label: 'Assistant' },
  ]],
  ['Operations', [
    { to: '/issues', icon: Ticket, label: 'Issues', badge: 'issues' },
    { to: '/maintenance', icon: Wrench, label: 'Maintenance' },
    { to: '/inspections', icon: ListChecks, label: 'Inspections' },
    { to: '/gate', icon: Door, label: 'Gate' },
    { to: '/accounts', icon: CurrencyInr, label: 'Accounts' },
    { to: '/owners', icon: Key, label: 'Owners' },
    { to: '/moderation', icon: ShieldCheck, label: 'Moderation', badge: 'moderation' },
  ]],
  ['Engage', [
    { to: '/communication', icon: ChatsCircle, label: 'Communication' },
    { to: '/announcements', icon: Megaphone, label: 'Announcements' },
    { to: '/events-polls', icon: ChartBar, label: 'Events & Polls' },
    { to: '/gallery', icon: Images, label: 'Gallery' },
  ]],
  ['Manage', [
    { to: '/residents', icon: UsersThree, label: 'Residents' },
    { to: '/flats', icon: Buildings, label: 'Flats & units' },
    { to: '/directory', icon: AddressBook, label: 'Directory' },
    { to: '/team', icon: UserGear, label: 'Team & access' },
    { to: '/ai', icon: Robot, label: 'AI controls' },
    { to: '/audit', icon: ClipboardText, label: 'Audit log' },
    { to: '/support', icon: Lifebuoy, label: 'Help & support' },
  ]],
];

export function crumbFor(pathname: string): [string, string] {
  for (const [grp, items] of NAV) {
    const hit = items.find(i => pathname.startsWith(i.to));
    if (hit) return [grp, hit.label];
  }
  return ['Overview', 'Dashboard'];
}
