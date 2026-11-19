import { ExternalLink, Heart } from 'lucide-react';
import { Icon3D } from '../components/Icon3D';
import { CommunityPanel, Ink, PageHead } from '../components/ui';
import { COMMUNITY_SIM_URL } from '../data/portal';

const ROWS = [
  ['A dashboard of 12 equal panels', <><b>Command centre</b> — four ranked decisions with the money at stake and a one-click action, above any chart</>, 'You open the portal to decide something, not to read'],
  ['Renewal dates in a list', <><b>Renewal runway</b> — every account scored on adoption, payment, usage slope and tickets, ordered by days left</>, 'A date tells you when; a health score tells you whether to worry'],
  ['Association cards showing plan & plots', <><b>Health-first cards</b>, sorted worst-first, each leading with the number that explains its score</>, 'The account needing you should not be alphabetically fourth'],
  ['Association page = static facts', <><b>Association 360</b> — adoption curve, account timeline, invoices, tickets and committee on one screen</>, 'Everything you need before a renewal call, without five tabs'],
  ['Invoices listed by date', <><b>Collections</b> with a chase action per invoice and an assistant chase plan that reads account health</>, 'Chasing money from a churning account needs a different message'],
  ['Support issues sorted by age', <><b>SLA-first ordering</b> with breached and unassigned surfaced as their own filters</>, 'Age is not urgency'],
  ['Modules = a capability list', <><b>Plan simulator</b> — pick a tier, see exactly what an account gains, plus modelled upsell headroom</>, 'Turns a catalog into a revenue tool'],
  ['AI business summary, read-only', <><b>Trinize Assistant</b> you can ask follow-ups and ask to draft the actual email</>, 'Suggest-only, but useful rather than decorative'],
  ['Navigate by clicking through menus', <><b>⌘K command palette</b> across accounts, invoices, issues and pages</>, 'Operators live in keyboards'],
  ['Deep links 404 on refresh', <><b>Every view is linkable</b> and survives a reload</>, <>The live site's /owner link 404s today — one <b>_redirects</b> line fixes it</>],
];

const KEPT = [
  'The association / plot / owner / subscription data model',
  'The 19-module registry and its three plan tiers',
  'Roles: operator, property manager, service associate, committee',
  'Invoice numbering, SLA language and issue categories',
  "Every figure on these screens comes from the live portal's own demo records",
];

export function Changed() {
  return (
    <>
      <PageHead crumb="About this concept" title="What we changed, and why" icon="sparkles">
        This is a <b>UI/UX concept</b> built on the live portal's own data model, structure and vocabulary — no backend, nothing to migrate. Same records, same roles, same modules registry; a different set of decisions on top of them.
      </PageHead>

      <div className="att ai" style={{ marginBottom: 18 }}>
        <div className="t"><Icon3D name="sparkles" size={16} /> The principle</div>
        <b className="head">The current portal reports the business. This one runs it.</b>
        <span className="sub">Every screen was rebuilt around the question an operator actually arrives with — what needs me today, which renewal is in trouble, who owes me money and why, what would an upgrade give them — instead of presenting the data and leaving the reasoning to the reader.</span>
      </div>

      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr><th style={{ width: '26%' }}>Today</th><th style={{ width: '38%' }}>In this concept</th><th>Why it matters</th></tr></thead>
          <tbody>
            {ROWS.map(([today, concept, why], i) => (
              <tr key={i}><td style={{ color: 'var(--ink2)' }}>{today}</td><td style={{ color: 'var(--ink)' }}>{concept}</td><td>{why}</td></tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid2e" style={{ marginTop: 16 }}>
        <div className="panel">
          <h3>Kept exactly as-is</h3>
          <div className="p-sub">This is a re-skin of judgement, not a rewrite</div>
          <ul style={{ margin: '4px 0 0 18px', color: 'var(--ink2)', fontSize: 12.5 }}>
            {KEPT.map(k => <li key={k} style={{ margin: '5px 0' }}>{k}</li>)}
          </ul>
        </div>
        <div className="panel">
          <h3>Two fixes worth doing regardless</h3>
          <div className="p-sub">Found while touring the live portal</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink2)' }}>
            <Ink>1 · SPA fallback is missing.</Ink> Every deep link or refresh returns a Netlify 404 — including <b>/owner/associations</b>. One file, <b>_redirects</b>, containing <b>/*&nbsp;&nbsp;/index.html&nbsp;&nbsp;200</b>.
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--ink2)', marginTop: 10 }}>
            <Ink>2 · The 404 drops the session.</Ink> Bouncing off a missing route signs the operator out, so a shared link costs a re-login. Same fix.
          </div>
        </div>
      </div>

      <CommunityPanel
        title={<><Icon3D name="purple_heart" size={20} /> And the resident side</>}
        sub="The CFM brief's community platform, as a working simulation"
        actions={<a className="btn ai" href={COMMUNITY_SIM_URL} target="_blank" rel="noopener noreferrer" style={{ marginTop: 12, display: 'inline-flex' }}><Heart size={14} /> Open the Community simulation <ExternalLink size={13} /></a>}
      >
        This concept covers the operator portal. The companion simulation covers the other half of the CFM brief — the resident app and the society committee's moderation console, with a resident action landing live in the admin queue.
      </CommunityPanel>

      <p style={{ fontSize: 12, color: 'var(--ink3)', marginTop: 22 }}>
        Prepared by Ghani · All names, numbers and records are fictional demo data modelled on the live portal's own demo set. Nothing here is stored or sent anywhere.
      </p>
    </>
  );
}
