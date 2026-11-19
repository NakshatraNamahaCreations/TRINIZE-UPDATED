import { LIVE } from '../lib/api';

/* Fictional demo data, modelled on the live Trinize owner portal. Nothing here is stored or sent anywhere.
   When the portal is connected to the API (VITE_API_URL), these same arrays are emptied and refilled from
   the server by hydrate() — the pages read them the same way in both modes. */

export const TODAY = LIVE ? new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : 'Sun 30 Aug 2026';

export const ASSOC = [
  {id:'asn-2', n:'Prestige Lakeside Habitat', city:'Bengaluru', type:'Apartment', plan:'Enterprise', bill:'yearly', state:'Active', pay:'Paid',
   plots:3426, owners:2971, adopt:87, annual:1164840, renew:'14 Sep 2026', days:15, mrr:97070, c:'#E6EEFB', tc:'#1F5FB0', ini:'PL',
   admin:'Sanjana Rao', role:'Secretary', ph:'+91 80 4128 7000', em:'admin@plhabitat.org', reg:'KA/BLR/RWA/2015/1188', since:'14 Jun 2023',
   addr:'Varthur Main Road, Gunjur · Off Sarjapur Road · Bengaluru 560087', credits:18523,
   blocks:[['Tower 1',620,22],['Tower 2',580,22],['Tower 3',610,22],['Tower 4',566,20],['Tower 5',540,20],['Tower 6',510,18]],
   committee:[['Col. (Retd.) Vikram Nair','President','+91 98455 71200'],['Sudha Balakrishnan','Vice President','+91 99012 66431'],['Sanjana Rao','Secretary','+91 80 4128 7000'],['Girish Prabhu','Treasurer','+91 98867 22190']],
   usage:[62,64,66,69,71,74,76,79,81,83,86,87], tickets:2, ticketsPrev:4, logins:1840,
   note:'Largest account — 70% of annual revenue. Renewal in under a month.',
   tl:[['Renewal invoice issued','TRZ-INV-2026-0117 · ₹11,64,840','5 days ago',1],['Quarterly business review held','Committee asked about a resident app','18 Aug 2026',0],['Enterprise uplift discussed','AI Assistant + Community modules','02 Aug 2026',0],['Owner onboarding crossed 85%','2,971 of 3,426 plots claimed','24 Jul 2026',0]]},
  {id:'asn-3', n:'Sobha Dream Acres', city:'Bengaluru', type:'Apartment', plan:'Professional', bill:'yearly', state:'Active', pay:'Paid',
   plots:2100, owners:1622, adopt:77, annual:462000, renew:'01 Oct 2026', days:32, mrr:38500, c:'#E2F4EA', tc:'#05683F', ini:'SD',
   admin:'Nagaraj Hebbar', role:'Secretary', ph:'+91 98862 41100', em:'office@sobhadreamacres.in', reg:'KA/BLR/RWA/2017/0442', since:'09 Nov 2023',
   addr:'Panathur Main Road · Bengaluru 560087', credits:9400,
   blocks:[['Cluster A',720,18],['Cluster B',690,18],['Cluster C',690,18]],
   committee:[['Nagaraj Hebbar','Secretary','+91 98862 41100'],['Priya Menon','Treasurer','+91 99001 77420']],
   usage:[58,60,61,63,66,68,70,71,73,75,76,77], tickets:1, ticketsPrev:2, logins:980,
   note:'Steady account. Good candidate for a Professional → Enterprise uplift.',
   tl:[['Work Orders module usage up 22%','Highest of any Professional account','3 days ago',1],['Renewal window opens','₹4.6L/yr · 32 days out','01 Oct 2026',0]]},
  {id:'asn-1', n:'Mytri Apartments', city:'Bengaluru', type:'Apartment', plan:'Professional', bill:'yearly', state:'Active', pay:'Part paid',
   plots:120, owners:104, adopt:87, annual:26400, renew:'19 Feb 2027', days:173, mrr:2200, c:'#EEF0FE', tc:'#4F46E5', ini:'MY',
   admin:'Sudhakar Rao', role:'Joint secretary', ph:'+91 98455 30021', em:'mytri.committee@gmail.com', reg:'KA/BLR/RWA/2011/0771', since:'22 Feb 2024',
   addr:'Kaggadasapura Main Road · Bengaluru 560093', credits:1200,
   blocks:[['Block A',64,8],['Block B',56,7]],
   committee:[['Sudhakar Rao','Joint secretary','+91 98455 30021']],
   usage:[70,72,73,75,78,80,82,84,85,86,87,87], tickets:2, ticketsPrev:1, logins:210,
   note:'Small but healthy. One invoice part paid for 80 days.',
   tl:[['Invoice part paid','TRZ-INV-2026-0055 · ₹9,000 outstanding','80 days ago',1],['Committee role change raised a ticket','ISS-2033 · sign-in after role change','15 Aug 2026',0]]},
  {id:'asn-4', n:'Green Meadows Villas', city:'Mysuru', type:'Villa', plan:'Starter', bill:'monthly', state:'Active', pay:'Past due',
   plots:84, owners:61, adopt:73, annual:12096, renew:'15 Aug 2026', days:-15, mrr:1008, c:'#FCEFD9', tc:'#A44207', ini:'GM',
   admin:'Bhagya Lakshmi', role:'President', ph:'+91 97310 55884', em:'greenmeadows.rwa@gmail.com', reg:'KA/MYS/RWA/2019/0231', since:'11 Mar 2025',
   addr:'Bogadi 2nd Stage · Mysuru 570026', credits:0,
   blocks:[['Villas 1–48',48,1],['Villas 49–84',36,1]],
   committee:[['Bhagya Lakshmi','President','+91 97310 55884']],
   usage:[68,68,67,66,66,65,64,64,63,62,62,61], tickets:1, ticketsPrev:0, logins:96,
   note:'Two invoices overdue and usage sliding. Access restricts at 30 days past due.',
   tl:[['Second invoice went overdue','TRZ-INV-2026-0104 · ₹1,008','5 days ago',1],['Kannada language request raised','ISS-2029 · resident app','11 Aug 2026',0],['Logins down 34% quarter on quarter','Adoption slipping from 68% → 61%','01 Aug 2026',1]]},
  {id:'asn-5', n:'Nandi Hills Plotted Layout', city:'Chikkaballapur', type:'Plotted', plan:'Starter', bill:'monthly', state:'Active', pay:'Trial',
   plots:210, owners:38, adopt:18, annual:30240, renew:'03 Sep 2026', days:4, trial:true, mrr:2520, c:'#F3E8FF', tc:'#7C3AED', ini:'NH',
   admin:'Nagesh Gowda', role:'Secretary', ph:'+91 99456 22013', em:'nandihills.layout@gmail.com', reg:'KA/CBP/RWA/2021/0114', since:'04 Aug 2026',
   addr:'Nandi Cross · Chikkaballapur 562103', credits:0,
   blocks:[['Phase 1',120,1],['Phase 2',90,1]],
   committee:[['Nagesh Gowda','Secretary','+91 99456 22013']],
   usage:[0,0,0,0,0,0,0,0,4,9,14,18], tickets:1, ticketsPrev:0, logins:41,
   note:'Trial ends in 4 days at 18% owner onboarding — the number that decides conversion.',
   tl:[['Trial ends in 4 days','₹30,240/yr at stake','03 Sep 2026',1],['Bulk owner import failing','ISS-2038 · two owners per plot rejected','17 Aug 2026',1],['Trial started','210 plots · Starter','04 Aug 2026',0]]},
  {id:'asn-6', n:'Coastal Grove Residency', city:'Mangaluru', type:'Mixed', plan:'Professional', bill:'yearly', state:'Pending', pay:'Trial',
   plots:340, owners:0, adopt:0, annual:74800, renew:'11 Sep 2026', days:12, trial:true, mrr:6233, c:'#E6EEFB', tc:'#1F5FB0', ini:'CG',
   admin:"Ronald D'Souza", role:'President', ph:'+91 98450 71190', em:'coastalgrove.rwa@gmail.com', reg:'KA/MNG/RWA/2022/0308', since:'12 Aug 2026',
   addr:'Kadri Road · Mangaluru 575003', credits:0,
   blocks:[['Tower East',180,12],['Row houses',160,1]],
   committee:[["Ronald D'Souza",'President','+91 98450 71190']],
   usage:[0,0,0,0,0,0,0,0,0,0,0,0], tickets:0, ticketsPrev:0, logins:6,
   note:'Awaiting verification — registration certificate and bank proof pending. Nothing can start until this clears.',
   tl:[['Awaiting verification','Registration + bank proof not yet checked','12 Aug 2026',1],['Trial ends in 12 days','No owners onboarded yet','11 Sep 2026',1]]},
  {id:'asn-7', n:'Silver Oak Enclave', city:'Hubballi', type:'Apartment', plan:'Starter', bill:'monthly', state:'Suspended', pay:'Suspended',
   plots:96, owners:71, adopt:74, annual:13824, renew:'05 Jun 2026', days:-86, mrr:0, c:'#EFEEE9', tc:'#54525E', ini:'SO',
   admin:'Imtiaz Ali', role:'Secretary', ph:'+91 94480 11227', em:'silveroak.rwa@gmail.com', reg:'KA/HBL/RWA/2018/0655', since:'18 Jan 2025',
   addr:'Vidyanagar · Hubballi 580021', credits:0,
   blocks:[['Block 1',96,8]],
   committee:[['Imtiaz Ali','Secretary','+91 94480 11227']],
   usage:[60,58,55,50,44,38,30,22,14,8,4,0], tickets:0, ticketsPrev:1, logins:0,
   note:'Suspended for non-payment since June. Win-back conversation, not a renewal.',
   tl:[['Access suspended','₹1,152 unpaid for 76 days','05 Jun 2026',1]]},
];

export const INVOICES = [
  {id:'TRZ-INV-2026-0117', a:'asn-2', amt:1164840, due:'in 25 days', state:'Issued', days:25},
  {id:'TRZ-INV-2026-0055', a:'asn-1', amt:9000, due:'80 days ago', state:'Part paid', days:-80},
  {id:'TRZ-INV-2026-0071', a:'asn-7', amt:1152, due:'76 days ago', state:'Overdue', days:-76},
  {id:'TRZ-INV-2026-0092', a:'asn-4', amt:1008, due:'36 days ago', state:'Overdue', days:-36},
  {id:'TRZ-INV-2026-0104', a:'asn-4', amt:1008, due:'5 days ago', state:'Overdue', days:-5},
];

export const ISSUES = [
  {id:'ISS-2043', cat:'Billing', t:'Completed job payment not reflecting in the vendor ledger', by:'Mahesh Kulkarni', src:'Associate · Sunrise Plumbing Co.', a:'asn-2', pri:'Medium', pm:'Unassigned', raised:'Yesterday', sla:'12h left', slaState:'ok', st:'Open'},
  {id:'ISS-2041', cat:'Billing', t:"Maintenance invoices show last year's per-sqft rate", by:'Ashok Menon', src:'End user · Treasurer', a:'asn-2', pri:'High', pm:'Sanjana Rao', raised:'2 days ago', sla:'6h over', slaState:'over', st:'In progress'},
  {id:'ISS-2040', cat:'Bug', t:'Associate app fails to upload job completion photos', by:'Shalini Prabhu', src:'Associate · GreenLeaf Housekeeping', a:'asn-1', pri:'High', pm:'Imran Qureshi', raised:'2 days ago', sla:'8h left', slaState:'ok', st:'In progress'},
  {id:'ISS-2038', cat:'Data', t:'Bulk owner import rejects rows with two owners per plot', by:'Nagesh Gowda', src:'End user · Secretary', a:'asn-5', pri:'High', pm:'Unassigned', raised:'3 days ago', sla:'4h left', slaState:'risk', st:'Open'},
  {id:'ISS-2033', cat:'Access', t:'Committee member cannot sign in after role change', by:'Sudhakar Rao', src:'End user · Joint secretary', a:'asn-1', pri:'Medium', pm:'Sanjana Rao', raised:'5 days ago', sla:'20h left', slaState:'ok', st:'In progress'},
  {id:'ISS-2029', cat:'Feature', t:'Request a Kannada option on the resident app', by:'Bhagya Lakshmi', src:'End user · Resident, Villa 27', a:'asn-4', pri:'Low', pm:'Lalitha Gowda', raised:'9 days ago', sla:'96h left', slaState:'ok', st:'Open'},
  {id:'ISS-2022', cat:'Bug', t:'Visit schedule shows old dates after a job was reassigned', by:'Ravi Teja', src:'Associate · AquaPure Water Systems', a:'asn-3', pri:'Low', pm:'Lalitha Gowda', raised:'14 days ago', sla:'Met', slaState:'met', st:'Resolved'},
  {id:'ISS-2018', cat:'Bug', t:'Visitor pass QR expires an hour early', by:'Ritu Malhotra', src:'End user · Resident T4-1108', a:'asn-3', pri:'Medium', pm:'Imran Qureshi', raised:'16 days ago', sla:'Met', slaState:'met', st:'Resolved'},
];

export const PROPERTY_MANAGERS = ['Sanjana Rao', 'Imran Qureshi', 'Lalitha Gowda', 'Prakash Reddy', 'Vinod Kamat'];

/** [name, description, category, starter, professional, enterprise, adoption %, flag] */
export const MODULES = [
  ['Property Management','Blocks, plots and the unit register.','Core',1,1,1,100],
  ['Residents & Onboarding','Owner and tenant records, invitations.','Core',1,1,1,100],
  ['Maintenance Billing','Periodic charges, dues and receipts.','Finance',1,1,1,100],
  ['Notices & Announcements','Circulars, AGM notices and events.','Community',1,1,1,100],
  ['Service Associate Directory','Approved vendors the society can call.','Services',1,1,1,100],
  ['Accounting','Ledgers, vouchers and financial statements.','Finance',0,1,1,60],
  ['Rent Collection','Rent invoicing and arrears tracking.','Finance',0,1,1,60],
  ['Maintenance & Work Orders','Requests, assignment and completion.','Operations',0,1,1,60],
  ['Visitor Management','Gate passes, pre-approvals and logs.','Security',0,1,1,60],
  ['Delivery Management','Parcel intake and handover.','Security',0,1,1,60],
  ['Reports','Standard operational and financial reports.','Core',0,1,1,60],
  ['Fixed Deposit Management','Corpus deposits, maturity tracking.','Finance',0,1,1,60],
  ['Applications & eSign','Rental applications and signed agreements.','Rental',0,0,1,20],
  ['Tenant Screening','Background and police verification.','Rental',0,0,1,20],
  ['Workflow Automation','Rules that trigger tasks and reminders.','Automation',0,0,1,20],
  ['AI Inspections','Photo-based condition assessment.','Automation',0,0,1,20],
  ['AI Assistant','Natural-language answers over society data.','Automation',0,0,1,20],
  ['White Label & Branding',"Society's own logo, colours and domain.",'Platform',0,0,1,20],
  ['Third-Party Integrations','Tally, payment gateways and webhooks.','Platform',0,0,1,20],
  ['Community Engagement','Resident app, discussions, events, polls, AI assistant.','Community',0,0,1,0,'new'],
];

export const MRR = [97100,101200,104800,108300,112600,116900,121400,125800,129900,133100,136200,138778];
export const MONTHS = ['Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug'];
/** the same months as chart tooltips show them */
export const MONTHS_FULL = MONTHS.map(m => m + ' 2026');
/** [month, invoiced, collected] */
export const BILLED = [['Mar',210000,205000],['Apr',232000,228000],['May',256000,249000],['Jun',274000,268000],['Jul',298000,286000],['Aug',1298000,120000]];

export const FEED = [
  {who:'System', what:'invoice TRZ-INV-2026-0104 crossed its due date · Green Meadows Villas', when:'5 days ago'},
  {who:'Imran Qureshi', what:'picked up ISS-2040 · associate photo upload bug', when:'2 days ago'},
  {who:'System', what:'SLA breached on ISS-2041 · Prestige Lakeside Habitat', when:'Yesterday'},
  {who:'Sanjana Rao', what:'requested a demo of the Community Engagement module', when:'18 Aug 2026'},
  {who:'System', what:'trial started · Nandi Hills Plotted Layout · 210 plots', when:'04 Aug 2026'},
];

export const COMMUNITY_SIM_URL = 'https://trinize-community-sim.vercel.app';
export const OPERATOR = { name: 'Ravi Kulkarni', first: 'Ravi', ini: 'RK', role: 'Platform operator · Trinize', email: 'ravi.kulkarni@trinize.com' };
/** fictional demo credentials, shown on the login page */
export const DEMO_LOGIN = { email: 'ravi.kulkarni@trinize.com', password: 'Trinize@2026' };

/** property managers (VPMs): created here, they work on the mobile app in the societies assigned to them */
export const VPMS = [
  { id: 'vpm-1', name: 'Imran Qureshi', phone: '9833300003', email: 'imran.qureshi@trinize.com', societies: [{ id: 'asn-2', name: 'Prestige Lakeside Habitat' }, { id: 'asn-4', name: 'Green Meadows Villas' }], openIssues: 9 },
  { id: 'vpm-2', name: 'Lalitha Gowda', phone: '9844400004', email: 'lalitha.gowda@trinize.com', societies: [{ id: 'asn-3', name: 'Sobha Dream Acres' }, { id: 'asn-1', name: 'Mytri Apartments' }], openIssues: 4 },
  { id: 'vpm-3', name: 'Prakash Reddy', phone: '9855500005', email: null, societies: [{ id: 'asn-5', name: 'Nandi Hills Plotted Layout' }], openIssues: 1 },
];

export const findAssoc = id => ASSOC.find(x => x.id === id);

/** how each plan is described; connected, the super admin edits this under Modules & plans */
export const PLAN_INFO = {
  Starter: { tag: 'Run the society', about: 'The unit register, residents, maintenance billing, notices and the vendor directory.', price: 0 },
  Professional: { tag: 'Run it properly', about: 'Adds accounting, rent collection, work orders, visitor and delivery management, and reports.', price: 0 },
  Enterprise: { tag: 'Everything, automated', about: 'Adds leasing and eSign, tenant screening, workflows, AI inspections and assistant, and the community app.', price: 0 },
};

const fill = (target, rows) => { target.length = 0; target.push(...rows); };
/** connected mode: replace every record with what the server holds */
export function hydrate(d) {
  fill(ASSOC, d.assoc); fill(INVOICES, d.invoices); fill(ISSUES, d.issues); fill(FEED, d.feed); fill(MODULES, d.modules);
  fill(MRR, d.mrr); fill(MONTHS, d.months); fill(MONTHS_FULL, d.monthsFull); fill(BILLED, d.billed); fill(VPMS, d.vpms);
  fill(PROPERTY_MANAGERS, [...new Set([...d.vpms.map(v => v.name), OPERATOR.name])]);
  for (const p of Object.keys(d.plans ?? {})) if (PLAN_INFO[p]) Object.assign(PLAN_INFO[p], d.plans[p]);
}
export function setOperator(name, email) {
  Object.assign(OPERATOR, { name, first: name.split(' ')[0], ini: initials(name).toUpperCase(), email });
}
// connected: start empty so no fictional record is ever shown while the real ones load
if (LIVE) for (const list of [ASSOC, INVOICES, ISSUES, FEED, MODULES, MRR, BILLED, VPMS, PROPERTY_MANAGERS]) list.length = 0;

/* Health scoring — a real model, not decoration. */
export function health(a) {
  if (a.h) return a.h; // connected: the server scores the account
  if (a.state === 'Suspended') return { score: 12, band: 'Critical', why: 'Suspended for non-payment' };
  let s = 50;
  s += Math.round(a.adopt * 0.35); // adoption is the strongest renewal signal
  s += a.pay === 'Paid' ? 14 : a.pay === 'Trial' ? 0 : a.pay === 'Part paid' ? -8 : -22;
  const slope = a.usage[11] - a.usage[8];
  s += slope > 2 ? 8 : slope < -2 ? -12 : 0;
  s -= a.tickets > a.ticketsPrev ? 5 : 0;
  if (a.state === 'Pending') s -= 12;
  s = Math.max(4, Math.min(98, s));
  const band = s >= 75 ? 'Healthy' : s >= 52 ? 'Watch' : 'At risk';
  const why = a.state === 'Pending' ? 'Not verified · no owners onboarded yet'
    : a.pay === 'Past due' ? 'Payment overdue and usage sliding'
    : a.trial ? 'Trial · onboarding at ' + a.adopt + '%'
    : slope < -2 ? 'Usage trending down'
    : a.adopt >= 85 ? 'High owner adoption · paying on time'
    : 'Paying · adoption still climbing';
  return { score: s, band, why };
}

export const bandColor = b => (b === 'Healthy' ? '#05683F' : b === 'Watch' ? '#A44207' : '#B42318');

export const fmtI = n => '₹' + n.toLocaleString('en-IN');
export const fmtL = n => n >= 10000000 ? '₹' + (n / 10000000).toFixed(1) + 'Cr'
  : n >= 100000 ? '₹' + (n / 100000).toFixed(1) + 'L'
  : n >= 1000 ? '₹' + (n / 1000).toFixed(1) + 'K'
  : '₹' + n;
export const num = n => n.toLocaleString('en-IN');
export const initials = name => name.split(' ').filter(w => /^[A-Za-z]/.test(w)).map(w => w[0]).slice(0, 2).join('');

/* pill tones */
export const stateTone = s => (s === 'Active' ? 'good' : s === 'Pending' ? 'warn' : s === 'Trial' ? 'sky' : 'dim');
export const payTone = p => (p === 'Paid' ? 'good' : p === 'Trial' ? 'sky' : p === 'Part paid' ? 'warn' : 'bad');
export const priTone = p => (p === 'High' ? 'bad' : p === 'Low' ? 'dim' : 'warn');
export const slaTone = s => (s === 'over' ? 'bad' : s === 'risk' ? 'warn' : s === 'met' ? 'good' : 'dim');
export const statusTone = s => (s === 'Resolved' ? 'good' : s === 'Open' ? 'dim' : 'sky');
export const bandTone = b => (b === 'Healthy' ? 'good' : b === 'Watch' ? 'warn' : 'bad');
export const SLA_ORDER = { over: 0, risk: 1, ok: 2, met: 3 };
