/* Demo records for Prestige Lakeside Habitat — all names, numbers and messages are fictional. */
import type { IconName } from '@/components/Icon';

export type Tone = 'Polite' | 'Friendly' | 'Funny' | 'Short & Clear';
export type Priority = 'Low' | 'Medium' | 'High';
export type IssueStatus = 'Submitted' | 'Acknowledged' | 'Assigned' | 'In Progress' | 'Resolved' | 'Closed';
export type NotifTarget = 'home' | 'issues' | 'polls' | 'events';
export type TryKey = 'ask' | 'issue' | 'guard' | 'tone' | 'rsvp' | 'vote' | 'gratitude';

export type Announcement = {
  id: string; title: string; body: string; pri: 'High' | 'Normal'; aud: string;
  when: string; by: string; ack: boolean; acked?: boolean; read: number; icon: IconName;
};
export type Discussion = {
  id: string; title: string; body: string; by: string; unit: string; when: string;
  comments: number; likes: number; state: 'published' | 'held' | 'hidden'; pinned?: boolean; myReact?: string | null;
  /** latest replies, oldest first; `comments` is the full count including older ones not loaded */
  thread?: Reply[];
};
export type Reply = { id: string; by: string; unit: string; text: string; when: string; held?: boolean };
export type CommunityEvent = {
  id: string; title: string; when: string; where: string; cap: number; going: number;
  mine: 'Going' | 'Waitlist' | null; icon: IconName; desc: string;
  /** local start time + length, for Add to calendar */
  at: string; mins: number;
};
export type PastEvent = { id: string; title: string; when: string; where: string; attended: number; icon: IconName };
export type Suggestion = { id: string; title: string; when: string; where: string; note: string; status: 'pending' };
export type Poll = {
  id: string; q: string; opts: { t: string; v: number }[]; mine: string | null;
  closes: string; elig: string; closed?: boolean;
};
export type Contact = { n: string; r: string; ph: string; c: string; tc: string };
export type TimelineStep = { s: IssueStatus; w: string; n?: string };
/** resident-added comment (optionally with a photo) — public on the ticket, unlike `internal` */
export type IssueUpdate = { text: string; when: string; photo?: string };
export type Issue = {
  id: string; title: string; cat: string; loc: string; pri: Priority; by: string; unit: string;
  mine?: boolean; when: string; status: IssueStatus; vendor: string; sla: string;
  slaState: 'ok' | 'over' | 'met'; tl: TimelineStep[];
  /** admin/vendor-only notes — never rendered in the resident app */
  internal: { w: string; n: string }[];
  updates?: IssueUpdate[];
};
export type ModItem = {
  id: string; kind: string; by: string; unit: string; when: string; text: string;
  cat: string; sev: 'Low' | 'Medium' | 'High'; state: 'open' | 'done'; ai: string; ctx: string; refId?: string | null;
};
export type Notif = {
  id: number; icon: IconName; c: string; tc: string; t: string; s: string; when: string; unread: boolean; goTo: NotifTarget;
};
export type Gratitude = { by: string; to: string; cat: string; text: string; when: string };
export const RELATIONS = ['Spouse', 'Parent', 'Child', 'Sibling', 'Tenant', 'Other'] as const;
export type Relation = 'Owner' | (typeof RELATIONS)[number];
/** `you` is the signed-in resident; `pending` until the admin office verifies a newly added member */
export type Member = { id: string; name: string; rel: Relation; phone: string; you?: boolean; pending?: boolean };
export type NotifPrefs = Record<'announcements' | 'events' | 'polls' | 'discussions' | 'gratitude' | 'issues' | 'quiet', boolean>;
export type PrivacyPrefs = Record<'showFlat' | 'showPhone' | 'aiHistory', boolean>;
export type IssueDraft = { title: string; desc: string; cat: string; loc: string; pri: Priority };
export type ChatMsg =
  | { who: 'ai'; text: string; src?: string | null; chips?: string[] }
  | { who: 'me'; text: string }
  | { who: 'preview'; draft: IssueDraft };
export type ChatMode = 'idle' | 'issue.desc' | 'issue.loc' | 'issue.urg' | 'issue.preview';
export type Chat = { log: ChatMsg[]; mode: ChatMode; draft: Partial<IssueDraft>; busy: boolean; creating: boolean };

export const ME = { name: 'Ananya Iyer', first: 'Ananya', unit: 'T4-1108', role: 'Owner', flat: 'Tower 4, Flat 1108' };
export const SOCIETY = { name: 'Prestige Lakeside Habitat', short: 'Prestige Lakeside', city: 'Bengaluru' };
export const TODAY = 'Sun 30 Aug 2026';

export const WELCOME_CHIPS = ['When is the water shutdown?', 'What are the pool timings?', 'Report an issue', 'Summarise this week'];

export const initialChat = (): Chat => ({
  log: [{
    who: 'ai',
    text: "Hi Ananya! I'm your Community Assistant. I answer only from approved community documents and live records — and I never post or create anything without your confirmation. How can I help?",
    chips: WELCOME_CHIPS,
  }],
  mode: 'idle', draft: {}, busy: false, creating: false,
});

export const initialState = {
  /** society-admin controlled switches; the resident app obeys them */
  ai: {
    qna: true, issueCreate: true, toneRewrite: true, summaries: true,
    tones: { Polite: true, Friendly: true, Funny: true, 'Short & Clear': true } as Record<Tone, boolean>,
    threshold: 'Standard' as 'Lenient' | 'Standard' | 'Strict',
  },
  announcements: [
    { id: 'AN-118', title: 'Water supply maintenance — Wed 2 Sep', body: 'Water supply will be paused on Wednesday 2 September from 10:00 AM to 2:00 PM for pump-room maintenance in Towers 4 and 5. Please store water in advance.', pri: 'High', aud: 'Towers 4 & 5', when: 'Yesterday, 6:00 PM', by: 'Admin Office', ack: true, read: 61, icon: 'water-outline' },
    { id: 'AN-117', title: 'Plantation drive this Sunday', body: "Join us near the lakeside walkway at 8:00 AM this Sunday. Saplings and tools provided — let's make the community greener.", pri: 'Normal', aud: 'All residents', when: '2 days ago', by: 'Green Committee', ack: false, read: 44, icon: 'leaf-outline' },
    { id: 'AN-115', title: 'New waste segregation rules from 1 Sep', body: 'Three-bin segregation becomes mandatory from Monday. The updated guide is attached in the Community Handbook.', pri: 'Normal', aud: 'All residents', when: '4 days ago', by: 'Admin Office', ack: false, read: 72, icon: 'trash-bin-outline' },
  ] as Announcement[],
  discussions: [
    { id: 'D-231', title: 'Best electrician near Gate 2?', body: 'Anyone has a good contact for small wiring work? Prefer someone who has worked in the towers before.', by: 'Rohit Sharma', unit: 'T2-0704', when: '2h ago', comments: 12, likes: 8, state: 'published',
      thread: [
        { id: 'R-1', by: 'Sanjana Rao', unit: 'T3-0402', text: 'FixIt Electricals from the approved vendor list did our MCB box last month — quick and fair.', when: '1h ago' },
        { id: 'R-2', by: 'Karan Shah', unit: 'T2-1101', text: 'Ramesh has done most of the wiring in T2. Ask at the security desk for his number.', when: '1h ago' },
        { id: 'R-3', by: 'Rohit Sharma', unit: 'T2-0704', text: 'Thanks both! Booked FixIt for Saturday.', when: '20m ago' },
      ] },
    { id: 'D-230', title: 'Car parking near Tower 5 — any updates?', body: 'Visitor cars keep taking resident slots on weekends. Did the committee decide anything in the last meeting?', by: 'Neha Iyer', unit: 'T5-0110', when: '5h ago', comments: 8, likes: 5, state: 'published',
      thread: [
        { id: 'R-4', by: 'Girish Prabhu', unit: 'T5-0903', text: 'Committee approved visitor stickers from next month. Security will tow unmarked cars from resident slots.', when: '4h ago' },
        { id: 'R-5', by: 'Neha Iyer', unit: 'T5-0110', text: 'That’s great, thank you for the update.', when: '3h ago' },
      ] },
    { id: 'D-228', title: 'Festival decoration volunteers needed 🎉', body: 'Onam decorations go up Thursday evening. We need 10 more volunteers for the clubhouse and lobby. Sign up in comments!', by: 'Arjun Mehta', unit: 'T1-1503', when: '1d ago', comments: 14, likes: 21, state: 'published', pinned: true,
      thread: [
        { id: 'R-6', by: 'Meera Pillai', unit: 'T1-0207', text: 'Count me in for the clubhouse! I can bring marigold strings.', when: '20h ago' },
        { id: 'R-7', by: 'Aditya Kulkarni', unit: 'T3-1210', text: 'Me and my son for the lobby 🙌', when: '18h ago' },
        { id: 'R-8', by: 'Arjun Mehta', unit: 'T1-1503', text: '7 of 10 spots filled — 3 more please! We start 5:30 PM Thursday.', when: '6h ago' },
      ] },
  ] as Discussion[],
  events: [
    { id: 'E-51', title: 'Badminton Court Finals', when: 'Mon 31 Aug · 6:00 PM', where: 'Indoor court', cap: 24, going: 24, mine: null, icon: 'tennisball-outline', desc: 'Season finale — doubles finals followed by prize distribution.', at: '2026-08-31T18:00', mins: 120 },
    { id: 'E-52', title: 'Yoga by the Lake', when: 'Sun 6 Sep · 7:00 AM', where: 'Lakeside lawn', cap: 40, going: 38, mine: null, icon: 'body-outline', desc: 'Morning hatha yoga with instructor Meera. Mats provided.', at: '2026-09-06T07:00', mins: 60 },
    { id: 'E-53', title: 'Onam Sadhya Lunch', when: 'Sat 5 Sep · 12:30 PM', where: 'Community Hall', cap: 250, going: 121, mine: null, icon: 'restaurant-outline', desc: 'Traditional 18-course sadhya on banana leaf. Family seating.', at: '2026-09-05T12:30', mins: 120 },
    { id: 'E-54', title: 'Annual General Meeting', when: 'Mon 14 Sep · 10:00 AM', where: 'Community Hall', cap: 300, going: 214, mine: 'Going', icon: 'business-outline', desc: 'FY-27 budget approval and committee elections. One member per unit.', at: '2026-09-14T10:00', mins: 180 },
  ] as CommunityEvent[],
  pastEvents: [
    { id: 'PE-9', title: 'Independence Day Flag Hoisting', when: '15 Aug · 7:30 AM', where: 'Central lawn', attended: 180, icon: 'flag-outline' },
    { id: 'PE-8', title: 'Monsoon Tree Plantation', when: '2 Aug · 8:00 AM', where: 'Lakeside walkway', attended: 64, icon: 'leaf-outline' },
    { id: 'PE-7', title: 'Kids Art Camp', when: '26–28 Jul · 10:00 AM', where: 'Clubhouse', attended: 42, icon: 'color-palette-outline' },
    { id: 'PE-6', title: 'Blood Donation Drive', when: '13 Jul · 9:00 AM', where: 'Community Hall', attended: 57, icon: 'medkit-outline' },
  ] as PastEvent[],
  /** resident event ideas awaiting committee approval */
  suggestions: [] as Suggestion[],
  polls: [
    { id: 'P-21', q: 'Best timing for the Sunday yoga session?', opts: [{ t: '7:00 – 8:00 AM', v: 48 }, { t: '8:00 – 9:00 AM', v: 21 }, { t: '9:00 – 10:00 AM', v: 11 }], mine: null, closes: 'Closes 8 Sep', elig: 'All residents · one vote per unit' },
    { id: 'P-20', q: 'Approve CCTV upgrade in the play area? (₹1.4L from corpus)', opts: [{ t: 'Yes, approve', v: 85 }, { t: 'No, defer', v: 15 }], mine: null, closes: 'Closes 10 Sep', elig: 'Owners only · one vote per unit' },
    { id: 'P-18', q: 'Diwali event budget preference', opts: [{ t: '₹80K — essentials', v: 64 }, { t: '₹1.5L — full programme', v: 112 }], mine: '₹1.5L — full programme', closes: 'Closed 20 Aug', elig: 'All residents', closed: true },
  ] as Poll[],
  directory: {
    committee: [
      { n: 'Col. (Retd.) Vikram Nair', r: 'President', ph: '+91 98455 71200', c: '#E3F3FC', tc: '#0369A1' },
      { n: 'Sudha Balakrishnan', r: 'Vice President', ph: '+91 99012 66431', c: '#EEF0FE', tc: '#4F46E5' },
      { n: 'Sanjana Rao', r: 'Secretary', ph: '+91 80 4128 7000', c: '#E4F7EE', tc: '#067647' },
      { n: 'Girish Prabhu', r: 'Treasurer', ph: '+91 98867 22190', c: '#FEF0DC', tc: '#B54708' },
    ] as Contact[],
    emergency: [
      { n: 'Security Office (24×7)', r: 'Main gate', ph: '+91 80 4128 7001', c: '#FDE9E7', tc: '#B42318' },
      { n: 'Ambulance', r: 'Government helpline', ph: '108', c: '#FDE9E7', tc: '#B42318' },
      { n: 'Fire Brigade', r: 'Government helpline', ph: '101', c: '#FDE9E7', tc: '#B42318' },
    ] as Contact[],
    vendors: [
      { n: 'Sunrise Plumbing Co.', r: 'Plumbing · approved', ph: '+91 98450 22110', c: '#E3F3FC', tc: '#0369A1' },
      { n: 'GreenLeaf Housekeeping', r: 'Housekeeping · approved', ph: '+91 97404 88221', c: '#E4F7EE', tc: '#067647' },
      { n: 'FixIt Electricals', r: 'Electrical · approved', ph: '+91 96323 44810', c: '#FEF0DC', tc: '#B54708' },
    ] as Contact[],
  },
  issues: [
    { id: 'ISS-1042', title: 'Corridor light flickering — Tower 4, floor 11', cat: 'Electrical', loc: 'Tower 4 · Floor 11', pri: 'Medium', by: 'Ananya Iyer', unit: 'T4-1108', mine: true, when: '28 Aug', status: 'In Progress', vendor: 'FixIt Electricals', sla: 'Due tomorrow, 6 PM', slaState: 'ok',
      tl: [{ s: 'Submitted', w: '28 Aug, 9:12 AM', n: 'Reported via app' }, { s: 'Acknowledged', w: '28 Aug, 10:05 AM', n: 'Ticket accepted by admin office' }, { s: 'Assigned', w: '28 Aug, 2:30 PM', n: 'FixIt Electricals scheduled for Friday' }, { s: 'In Progress', w: '29 Aug, 11:00 AM', n: 'Ballast replacement in progress; part ordered' }],
      internal: [{ w: '28 Aug, 2:31 PM', n: 'Vendor quoted ₹850 — within auto-approve limit.' }] },
    { id: 'ISS-1038', title: 'Water seepage in bathroom ceiling', cat: 'Plumbing', loc: 'T4-1108', pri: 'High', by: 'Ananya Iyer', unit: 'T4-1108', mine: true, when: '21 Aug', status: 'Resolved', vendor: 'Sunrise Plumbing Co.', sla: 'Met · resolved in 2 days', slaState: 'met',
      tl: [{ s: 'Submitted', w: '21 Aug, 8:40 AM', n: 'Reported via chatbot' }, { s: 'Acknowledged', w: '21 Aug, 9:15 AM' }, { s: 'Assigned', w: '21 Aug, 11:00 AM', n: 'Sunrise Plumbing Co.' }, { s: 'In Progress', w: '22 Aug, 10:00 AM' }, { s: 'Resolved', w: '23 Aug, 4:20 PM', n: "Upstairs flat's shower drain resealed; ceiling patch repainted." }],
      internal: [{ w: '22 Aug, 10:02 AM', n: 'Access to T4-1208 arranged with owner.' }] },
    { id: 'ISS-1041', title: 'Gym AC not cooling', cat: 'HVAC', loc: 'Clubhouse · Gym', pri: 'Medium', by: 'Rohit Sharma', unit: 'T2-0704', when: '27 Aug', status: 'Assigned', vendor: 'CoolBreeze HVAC', sla: 'Due 1 Sep', slaState: 'ok',
      tl: [{ s: 'Submitted', w: '27 Aug, 7:55 AM' }, { s: 'Acknowledged', w: '27 Aug, 9:00 AM' }, { s: 'Assigned', w: '27 Aug, 3:10 PM', n: 'CoolBreeze HVAC — gas top-up scheduled' }], internal: [] },
    { id: 'ISS-1039', title: 'Lift 2 making grinding noise, Tower 1', cat: 'Lifts', pri: 'High', loc: 'Tower 1 · Lift 2', by: 'Arjun Mehta', unit: 'T1-1503', when: '24 Aug', status: 'In Progress', vendor: 'OTIS AMC', sla: '6h over SLA', slaState: 'over',
      tl: [{ s: 'Submitted', w: '24 Aug, 6:20 PM' }, { s: 'Acknowledged', w: '24 Aug, 6:45 PM' }, { s: 'Assigned', w: '25 Aug, 9:00 AM', n: 'OTIS AMC engineer visit' }, { s: 'In Progress', w: '26 Aug, 11:30 AM', n: 'Awaiting replacement bearing from OTIS' }],
      internal: [{ w: '29 Aug, 9:00 AM', n: 'Part delayed at supplier — chase daily. Escalated to AMC manager.' }] },
  ] as Issue[],
  /** shared with the Society Admin console — the resident app only ever adds to it */
  modqueue: [] as ModItem[],
  notifs: [
    { id: 1, icon: 'water-outline', c: '#E3F3FC', tc: '#0369A1', t: 'Important: water supply maintenance', s: 'Towers 4 & 5 · Wed 2 Sep, 10 AM – 2 PM', when: 'Yesterday', unread: true, goTo: 'home' },
    { id: 2, icon: 'construct-outline', c: '#FEF0DC', tc: '#B54708', t: 'Update on ISS-1042', s: 'FixIt Electricals: ballast replacement in progress', when: 'Yesterday', unread: true, goTo: 'issues' },
    { id: 3, icon: 'bar-chart-outline', c: '#EEF0FE', tc: '#4F46E5', t: 'New poll: CCTV upgrade in play area', s: 'Voting open until 10 Sep', when: '2 days ago', unread: true, goTo: 'polls' },
    { id: 4, icon: 'body-outline', c: '#E4F7EE', tc: '#067647', t: 'Yoga by the Lake — filling fast', s: '38 of 40 spots taken · Sun 6 Sep', when: '2 days ago', unread: false, goTo: 'events' },
    { id: 5, icon: 'checkmark-circle-outline', c: '#E4F7EE', tc: '#067647', t: 'ISS-1038 resolved', s: 'Water seepage fixed — tell us how we did', when: '7 days ago', unread: false, goTo: 'issues' },
    { id: 6, icon: 'heart-outline', c: '#F1ECFE', tc: '#7C55F7', t: 'Gratitude received', s: 'The security team thanked you for your kind note', when: 'Yesterday', unread: false, goTo: 'home' },
  ] as Notif[],
  audit: [] as { who: string; what: string; when: string }[],
  gratitudes: [
    { by: 'Neha Iyer', to: 'The whole community', cat: 'Kindness', text: 'Thank you everyone who joined the plantation drive — the lakeside looks beautiful! 💜', when: '2h ago' },
    { by: 'Ananya Iyer', to: 'Security team', cat: 'Help received', text: 'Night shift helped me find my parcel at 11 PM. Heroes. 🙏', when: 'Yesterday' },
    { by: 'Arjun Mehta', to: 'The whole community', cat: 'Motivation', text: '14 volunteers turned up for the Onam decorations at 6 AM on a holiday. This is why I moved here.', when: 'Yesterday' },
    { by: 'Rohit Sharma', to: 'The whole community', cat: 'Help received', text: 'Whoever left the spare inverter battery outside T2 lift on Thursday — you saved our evening. Thank you.', when: '2 days ago' },
  ] as Gratitude[],
  me: { gratitudes: 12, chats: 4, days: 46 },
  settings: {
    notif: { announcements: true, events: true, polls: true, discussions: false, gratitude: true, issues: true, quiet: true } as NotifPrefs,
    privacy: { showFlat: true, showPhone: false, aiHistory: true } as PrivacyPrefs,
  },
  family: [
    { id: 'M1', name: ME.name, rel: 'Owner', phone: '', you: true },
    { id: 'M2', name: 'Karthik Iyer', rel: 'Spouse', phone: '98450 12345' },
  ] as Member[],
  chat: initialChat(),
  issueSeq: 1043, modSeq: 89, notifSeq: 7, discSeq: 232, famSeq: 3, replySeq: 9, sugSeq: 1,
  tried: {} as Partial<Record<TryKey, true>>,
};

export type State = typeof initialState;
