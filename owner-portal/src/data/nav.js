import { Blocks, Building2, Hourglass, IndianRupee, LayoutDashboard, LifeBuoy, Radar, Sparkles } from 'lucide-react';

/** Sidebar order and badges. `k` is the page key used by go(); Association 360 takes an account id. */
export const NAV = [
  { grp: 'Run the business' },
  { k: 'command', ic: LayoutDashboard, l: 'Command centre' },
  { k: 'renewals', ic: Hourglass, l: 'Renewals & risk', cnt: 3, hot: true },
  { k: 'collections', ic: IndianRupee, l: 'Collections', cnt: 4 },
  { grp: 'Accounts' },
  { k: 'associations', ic: Building2, l: 'Associations' },
  { k: 'a360', ic: Radar, l: 'Association 360' },
  { grp: 'Delivery' },
  { k: 'issues', ic: LifeBuoy, l: 'Support issues', cnt: 6 },
  { k: 'modules', ic: Blocks, l: 'Modules & plans' },
  { grp: 'About this concept' },
  { k: 'changed', ic: Sparkles, l: 'What we changed' },
];

/** page key → route */
export const PATHS = {
  command: '/', renewals: '/renewals', collections: '/collections', associations: '/associations',
  issues: '/issues', modules: '/modules', changed: '/changed',
};
