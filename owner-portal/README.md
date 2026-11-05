# Owner Portal 2.0 · Trinize

React (Vite) rebuild of the Owner Portal 2.0 concept — the platform operator's console for running the
Trinize subscription business across client associations. Screens, data and copy follow
<https://trinize-portal-sim.vercel.app/>. All records are fictional demo data; nothing is stored or sent.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
npm run lint     # oxlint
```

## Sign in

Every screen sits behind `/login`. Demo account (fictional): **ravi.kulkarni@trinize.com** / **Trinize@2026**
— the login page has a "Fill in" button. "Keep me signed in" stores the session in `localStorage`;
unticked, it lasts for the browser tab only. Sign out from the account menu (top right).

## Screens

| Route | Screen |
|---|---|
| `/login` | Sign in |
| `/` | Command centre — four ranked decisions, KPIs, revenue and health charts, copilot summary, activity |
| `/renewals` | Renewals & risk — renewal runway ordered by days left, scored by the health model |
| `/collections` | Collections — invoices oldest-first with chase actions, billed-vs-collected chart |
| `/associations` | Associations — health-first cards with filters |
| `/associations/:id` | Association 360 — adoption curve, timeline, blocks, committee, tickets |
| `/issues` | Support issues — SLA-first table, assign & reply modal |
| `/modules` | Modules & plans — plan simulator and module matrix |
| `/changed` | What we changed, and why |

Everywhere: ⌘K / Ctrl+K search, the Portfolio Copilot drawer (✦ button), and "What's new" in the top bar.
Every route is a real URL; `public/_redirects` (Netlify) and `vercel.json` keep deep links working on refresh.

## Layout

```
src/
  data/portal.js      demo records, health() model, formatters, pill tones
  data/copilot.jsx    copilot answers (suggest-only, from the records above)
  data/nav.js         sidebar items and routes
  store/              PortalProvider: actions taken, activity feed, issue assignments, overlays
  components/         sidebar, top bar, KPI/ring/spark, charts, copilot, ⌘K palette, modal, toast
  pages/              one file per screen
  index.css           the concept's stylesheet, ported as-is
```

## Icons

- **3D icons** (KPI tiles, page titles, decision cards, toasts, login, What's new) are from Microsoft's
  [Fluent UI Emoji](https://github.com/microsoft/fluentui-emoji) set, MIT licence, bundled in `public/icons3d/`.
  Use them with `<Icon3D name="money_bag" />`; the name is the PNG file name.
- **Line icons** (sidebar, top bar, inside buttons, table ticks) are from [lucide-react](https://lucide.dev).

Actions (clearing a decision, chasing an invoice, assigning an issue) update the screens and the activity
feed for the session and reset on reload, as in the original concept.
