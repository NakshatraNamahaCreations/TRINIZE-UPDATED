import { AddressBook, CalendarCheck, ChartBar, Gauge, HeartStraight, Images, Lifebuoy, ChatsCircle, ClipboardText, ListChecks, Sparkle, CurrencyInr, Door, Key, Wrench, type Icon as IconType, Megaphone, Buildings, Robot, UserGear, ShieldCheck, SquaresFour, Ticket, UsersThree } from '@phosphor-icons/react';

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
    { to: '/visits', icon: CalendarCheck, label: 'Visits & planning' },
    { to: '/gate', icon: Door, label: 'Gate' },
    { to: '/accounts', icon: CurrencyInr, label: 'Accounts' },
    { to: '/owners', icon: Key, label: 'Owners' },
    { to: '/moderation', icon: ShieldCheck, label: 'Moderation', badge: 'moderation' },
  ]],
  ['Engage', [
    { to: '/community', icon: HeartStraight, label: 'Community hub' },
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
    { to: '/ai-usage', icon: Gauge, label: 'AI usage' },
    { to: '/audit', icon: ClipboardText, label: 'Audit log' },
    { to: '/support', icon: Lifebuoy, label: 'Help & support' },
  ]],
];

export function crumbFor(pathname: string): [string, string] {
  // the longest matching path wins, so /ai-usage is "AI usage" and not "AI controls"
  let best: [string, NavItem] | null = null;
  for (const [grp, items] of NAV) for (const i of items) {
    if ((pathname === i.to || pathname.startsWith(i.to + '/') || pathname.startsWith(i.to + '?')) && (!best || i.to.length > best[1].to.length)) best = [grp, i];
  }
  return best ? [best[0], best[1].label] : ['Overview', 'Dashboard'];
}
