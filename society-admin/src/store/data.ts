/* Demo records for Prestige Lakeside Habitat — all names, numbers and messages are fictional. */

export type Tone = 'Polite' | 'Friendly' | 'Funny' | 'Short & Clear';
export type Priority = 'Low' | 'Medium' | 'High' | 'Emergency';
export type IssueStatus = 'Submitted' | 'Acknowledged' | 'Assigned' | 'In Progress' | 'On Hold' | 'Resolved' | 'Closed';
export type ModAction = 'Allowed' | 'Warned author' | 'Rewrite suggested' | 'Hidden';

export type Issue = {
  id: string; title: string; cat: string; loc: string; pri: Priority; by: string; unit: string;
  when: string; status: IssueStatus; vendor: string; sla: string; slaState: 'ok' | 'over' | 'met';
  /** public timeline — the resident sees these */
  tl: { s: IssueStatus; w: string; n?: string }[];
  /** admin/vendor-only notes — never shown to residents */
  internal: { w: string; n: string }[];
};
export type ModItem = {
  id: string; kind: string; by: string; unit: string; when: string; text: string; cat: string;
  sev: 'Low' | 'Medium' | 'High'; state: 'open' | 'done'; rec: ModAction; ai: string; ctx: string;
};
export type ResolvedMod = { id: string; by: string; when: string; text: string; action: string; admin: string };
/** `read` is a percentage; connected to the API it is the share of residents who acknowledged, and `acks` the count */
export type Announcement = { id: string; title: string; body: string; pri: 'High' | 'Normal'; aud: string; when: string; by: string; ack: boolean; read: number; acks?: number };
/** `wait` = people on the waitlist, `mins` = how long it runs, `at` = the start as an ISO time (when known) */
export type CommunityEvent = { id: string; title: string; when: string; where: string; cap: number; going: number; wait?: number; mins?: number; at?: string; desc?: string };
export type Poll = { id: string; q: string; opts: { t: string; v: number }[]; elig: string; closed?: boolean; closesAt?: string; owners?: boolean };
export type User = { n: string; unit: string; role: 'Owner' | 'Tenant'; status: 'Active' | 'Warned' | 'Restricted' | 'Suspended' | 'Blocked'; warns: number };
/** `at` is the exact ISO time, when the server gave one */
export type AuditEntry = { who: string; what: string; when: string; at?: string };
export type KnowledgeDoc = { n: string; t: string; d: string; /** connected: the server's id and the text the assistant answers from */ id?: string; body?: string };

export const ADMIN = { name: 'Sanjana Rao', first: 'Sanjana', role: 'Secretary' };
export const SOCIETY = { name: 'Prestige Lakeside Habitat' };
export const VENDORS = ['Sunrise Plumbing Co.', 'FixIt Electricals', 'GreenLeaf Housekeeping', 'CoolBreeze HVAC', 'OTIS AMC'];
/** the resident persona the demo resident app plays — their issues get resident notifications */
export const DEMO_RESIDENT = 'Ananya Iyer';

export const initialState = () => ({
  ai: {
    qna: true, issueCreate: true, toneRewrite: true, summaries: true,
    tones: { Polite: true, Friendly: true, Funny: true, 'Short & Clear': true } as Record<Tone, boolean>,
    threshold: 'Standard' as 'Lenient' | 'Standard' | 'Strict',
    autoHold: 'Medium & above' as 'Medium & above' | 'High severity',
    docs: [
      { n: 'Community Handbook v3', t: 'PDF · 48 pages', d: '12 Jul 2026' },
      { n: 'Pool, Gym & Clubhouse Rules 2026', t: 'PDF · 6 pages', d: '02 Jun 2026' },
      { n: 'Maintenance Charges Circular FY-27', t: 'PDF · 3 pages', d: '01 Apr 2026' },
      { n: 'Move-in / Move-out Policy', t: 'PDF · 4 pages', d: '18 Feb 2026' },
      { n: 'AGM 2025 — Approved Minutes', t: 'PDF · 11 pages', d: '20 Sep 2025' },
    ] as KnowledgeDoc[],
  },
  announcements: [
    { id: 'AN-118', title: 'Water supply maintenance — Wed 2 Sep', body: 'Water supply will be paused on Wednesday 2 September from 10:00 AM to 2:00 PM for pump-room maintenance in Towers 4 and 5. Please store water in advance.', pri: 'High', aud: 'Towers 4 & 5', when: 'Yesterday, 6:00 PM', by: 'Admin Office', ack: true, read: 61 },
    { id: 'AN-117', title: 'Plantation drive this Sunday', body: "Join us near the lakeside walkway at 8:00 AM this Sunday. Saplings and tools provided — let's make the community greener.", pri: 'Normal', aud: 'All residents', when: '2 days ago', by: 'Green Committee', ack: false, read: 44 },
    { id: 'AN-115', title: 'New waste segregation rules from 1 Sep', body: 'Three-bin segregation becomes mandatory from Monday. The updated guide is attached in the Community Handbook.', pri: 'Normal', aud: 'All residents', when: '4 days ago', by: 'Admin Office', ack: false, read: 72 },
  ] as Announcement[],
  events: [
    { id: 'E-51', title: 'Badminton Court Finals', when: 'Mon 31 Aug · 6:00 PM', where: 'Indoor court', cap: 24, going: 24 },
    { id: 'E-52', title: 'Yoga by the Lake', when: 'Sun 6 Sep · 7:00 AM', where: 'Lakeside lawn', cap: 40, going: 38 },
    { id: 'E-53', title: 'Onam Sadhya Lunch', when: 'Sat 5 Sep · 12:30 PM', where: 'Community Hall', cap: 250, going: 121 },
    { id: 'E-54', title: 'Annual General Meeting', when: 'Mon 14 Sep · 10:00 AM', where: 'Community Hall', cap: 300, going: 214 },
  ] as CommunityEvent[],
  polls: [
    { id: 'P-21', q: 'Best timing for the Sunday yoga session?', opts: [{ t: '7:00 – 8:00 AM', v: 48 }, { t: '8:00 – 9:00 AM', v: 21 }, { t: '9:00 – 10:00 AM', v: 11 }], elig: 'All residents · one vote per unit' },
    { id: 'P-20', q: 'Approve CCTV upgrade in the play area? (₹1.4L from corpus)', opts: [{ t: 'Yes, approve', v: 85 }, { t: 'No, defer', v: 15 }], elig: 'Owners only · one vote per unit' },
    { id: 'P-18', q: 'Diwali event budget preference', opts: [{ t: '₹80K — essentials', v: 64 }, { t: '₹1.5L — full programme', v: 112 }], elig: 'All residents', closed: true },
  ] as Poll[],
  issues: [
    { id: 'ISS-1042', title: 'Corridor light flickering — Tower 4, floor 11', cat: 'Electrical', loc: 'Tower 4 · Floor 11', pri: 'Medium', by: 'Ananya Iyer', unit: 'T4-1108', when: '28 Aug', status: 'In Progress', vendor: 'FixIt Electricals', sla: 'Due tomorrow, 6 PM', slaState: 'ok',
      tl: [{ s: 'Submitted', w: '28 Aug, 9:12 AM', n: 'Reported via app' }, { s: 'Acknowledged', w: '28 Aug, 10:05 AM', n: 'Ticket accepted by admin office' }, { s: 'Assigned', w: '28 Aug, 2:30 PM', n: 'FixIt Electricals scheduled for Friday' }, { s: 'In Progress', w: '29 Aug, 11:00 AM', n: 'Ballast replacement in progress; part ordered' }],
      internal: [{ w: '28 Aug, 2:31 PM', n: 'Vendor quoted ₹850 — within auto-approve limit.' }] },
    { id: 'ISS-1038', title: 'Water seepage in bathroom ceiling', cat: 'Plumbing', loc: 'T4-1108', pri: 'High', by: 'Ananya Iyer', unit: 'T4-1108', when: '21 Aug', status: 'Resolved', vendor: 'Sunrise Plumbing Co.', sla: 'Met · resolved in 2 days', slaState: 'met',
      tl: [{ s: 'Submitted', w: '21 Aug, 8:40 AM', n: 'Reported via chatbot' }, { s: 'Acknowledged', w: '21 Aug, 9:15 AM' }, { s: 'Assigned', w: '21 Aug, 11:00 AM', n: 'Sunrise Plumbing Co.' }, { s: 'In Progress', w: '22 Aug, 10:00 AM' }, { s: 'Resolved', w: '23 Aug, 4:20 PM', n: "Upstairs flat's shower drain resealed; ceiling patch repainted." }],
      internal: [{ w: '22 Aug, 10:02 AM', n: 'Access to T4-1208 arranged with owner.' }] },
    { id: 'ISS-1041', title: 'Gym AC not cooling', cat: 'HVAC', loc: 'Clubhouse · Gym', pri: 'Medium', by: 'Rohit Sharma', unit: 'T2-0704', when: '27 Aug', status: 'Assigned', vendor: 'CoolBreeze HVAC', sla: 'Due 1 Sep', slaState: 'ok',
      tl: [{ s: 'Submitted', w: '27 Aug, 7:55 AM' }, { s: 'Acknowledged', w: '27 Aug, 9:00 AM' }, { s: 'Assigned', w: '27 Aug, 3:10 PM', n: 'CoolBreeze HVAC — gas top-up scheduled' }], internal: [] },
    { id: 'ISS-1039', title: 'Lift 2 making grinding noise, Tower 1', cat: 'Lifts', pri: 'High', loc: 'Tower 1 · Lift 2', by: 'Arjun Mehta', unit: 'T1-1503', when: '24 Aug', status: 'In Progress', vendor: 'OTIS AMC', sla: '6h over SLA', slaState: 'over',
      tl: [{ s: 'Submitted', w: '24 Aug, 6:20 PM' }, { s: 'Acknowledged', w: '24 Aug, 6:45 PM' }, { s: 'Assigned', w: '25 Aug, 9:00 AM', n: 'OTIS AMC engineer visit' }, { s: 'In Progress', w: '26 Aug, 11:30 AM', n: 'Awaiting replacement bearing from OTIS' }],
      internal: [{ w: '29 Aug, 9:00 AM', n: 'Part delayed at supplier — chase daily. Escalated to AMC manager.' }] },
    { id: 'ISS-1036', title: 'Dustbin overflow near Block A gate', cat: 'Sanitation', pri: 'Low', loc: 'Block A · Gate side', by: 'Neha Iyer', unit: 'T5-0110', when: '19 Aug', status: 'Resolved', vendor: 'GreenLeaf Housekeeping', sla: 'Met', slaState: 'met',
      tl: [{ s: 'Submitted', w: '19 Aug, 10:30 AM', n: 'Reported via chatbot' }, { s: 'Acknowledged', w: '19 Aug, 10:40 AM' }, { s: 'Assigned', w: '19 Aug, 11:00 AM' }, { s: 'Resolved', w: '19 Aug, 2:15 PM', n: 'Cleared; pickup frequency doubled for festival week.' }], internal: [] },
  ] as Issue[],
  modqueue: [
    { id: 'MOD-88', kind: 'Discussion comment', by: 'Vikas Kumar', unit: 'T2-0402', when: '3h ago', text: 'This committee is a joke, bunch of freeloaders doing nothing all year.', cat: 'Aggressive', sev: 'Medium', state: 'open', rec: 'Warned author', ai: 'Hostile generalisation aimed at a group; no threat detected.', ctx: 'On “Car parking near Tower 5 — any updates?”' },
    { id: 'MOD-87', kind: 'Discussion post', by: 'Deepak R', unit: 'T3-0916', when: 'Yesterday', text: 'Selling my 2-wheeler, DM me on 98XXX. Great price, first come first serve!!', cat: 'Spam / marketplace', sev: 'Low', state: 'open', rec: 'Hidden', ai: 'Commercial content — marketplace posts are outside community guidelines.', ctx: 'New post in Discussions' },
  ] as ModItem[],
  resolvedMods: [
    { id: 'MOD-85', by: 'Anonymous report', when: '24 Aug', text: 'Reported photo in “Community moments” — parking dispute screenshot with a visible number plate.', action: 'Removed · privacy', admin: 'Sanjana Rao' },
  ] as ResolvedMod[],
  users: [
    { n: 'Ananya Iyer', unit: 'T4-1108', role: 'Owner', status: 'Active', warns: 0 },
    { n: 'Rohit Sharma', unit: 'T2-0704', role: 'Owner', status: 'Active', warns: 0 },
    { n: 'Neha Iyer', unit: 'T5-0110', role: 'Tenant', status: 'Active', warns: 0 },
    { n: 'Arjun Mehta', unit: 'T1-1503', role: 'Owner', status: 'Active', warns: 0 },
    { n: 'Vikas Kumar', unit: 'T2-0402', role: 'Owner', status: 'Warned', warns: 1 },
    { n: 'Deepak R', unit: 'T3-0916', role: 'Tenant', status: 'Active', warns: 0 },
  ] as User[],
  audit: [
    { who: 'System (SLA)', what: 'escalated ISS-1039 — response SLA breached by 6h', when: 'Today, 9:00 AM' },
    { who: 'System', what: 'gratitude sent · Neha Iyer → The whole community · Kindness', when: 'Today, 8:04 AM' },
    { who: 'Sanjana Rao', what: 'published announcement AN-118 to Towers 4 & 5 · priority High', when: 'Yesterday, 6:00 PM' },
    { who: 'System', what: 'gratitude sent · Ananya Iyer → Security team · Help received (note text private to recipient)', when: 'Yesterday, 9:12 AM' },
    { who: 'Moderator (Priya)', what: 'removed a Community Moments photo · reason: privacy — visible number plate', when: '24 Aug, 5:02 PM' },
    { who: 'Sanjana Rao', what: 'resolved ISS-1036 · “Cleared; pickup frequency doubled”', when: '19 Aug, 2:15 PM' },
  ] as AuditEntry[],
  /** 14 days of issues created vs resolved; the last day is today (partial) */
  trend: {
    days: ['17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30'],
    created: [2, 1, 3, 1, 2, 1, 0, 3, 1, 2, 2, 1, 1, 0],
    resolved: [1, 2, 2, 1, 1, 2, 1, 1, 2, 1, 1, 2, 1, 0],
  },
  gratitudes: 6,
  anSeq: 119,
});

export type State = ReturnType<typeof initialState>;

export const isOpen = (i: Issue) => !['Resolved', 'Closed'].includes(i.status);

/** the status an issue moves to next, and the button that moves it */
export const FLOW: Partial<Record<IssueStatus, IssueStatus>> = { Submitted: 'Acknowledged', Acknowledged: 'Assigned', Assigned: 'In Progress', 'In Progress': 'Resolved' };
export const NEXT_LABEL: Partial<Record<IssueStatus, string>> = { Submitted: 'Acknowledge', Acknowledged: 'Assign vendor', Assigned: 'Start work', 'In Progress': 'Mark resolved' };

/** what the moderator says to the resident, prefilled per action */
export const GUIDANCE: Record<ModAction | 'default', string> = {
  'Warned author': 'Be kind and respectful — this community is a safe space for everyone.',
  Hidden: 'Marketplace and personal-sale posts belong on the notice board — everything else is welcome here.',
  'Rewrite suggested': 'Your point is worth making — could you share it in kinder words and repost?',
  Allowed: 'A moderator reviewed this and no action was needed. Thanks for taking part.',
  default: 'A moderator has reviewed this. Please keep posts kind and respectful.',
};
