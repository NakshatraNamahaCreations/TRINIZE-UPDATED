# Trinize Society Admin (React)

React + TypeScript (Vite) build of the **Society admin** console from the
[Trinize Community simulation](https://trinize-community-sim.vercel.app/). You are
Sanjana Rao, Secretary of Prestige Lakeside Habitat. All data is fictional.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production bundle in dist/
npm run lint
```

## Live

https://trinize-society-admin.netlify.app — Netlify project `trinize-society-admin`.

Redeploy after changes:

```bash
npm run build
npx netlify-cli deploy --prod --dir dist --site 91bbefbb-fd6c-469c-9473-0958839b0ee4
```

`netlify.toml` and `public/_redirects` route every path to `index.html`, so deep links and refreshes work.

## Sign in

| | |
|---|---|
| Email | `sanjana.rao@prestigelakeside.in` |
| Password | `Lakeside@2026` |

Or press **Use the demo account** on the login page. This is a front-end demo only — the credentials are checked
in the browser, not by a server. The real build would use Trinize's OTP login.

- Every section is protected; opening a link while signed out goes to `/login` and returns to that link afterwards.
- **Keep me signed in** keeps the session after the browser closes; unticked, it ends with the tab.
- Sign out from the user menu (top right) or the sidebar footer.

Work is saved in the browser (localStorage). **Reset demo data** in the user menu restores the original records.

## Sections

| Route | What it does |
|---|---|
| `/login` | Split-screen sign-in with validation, show/hide password, demo account |
| `/dashboard` | 7 KPIs that open their matching list, 14-day created-vs-resolved chart, open issues by category, **Needs attention** list, plain-words weekly summary |
| `/issues` | Status summary, search, CSV export; filter (All / Open / In progress / Resolved / SLA breached); click a row for the drawer: merged public + internal timeline, Acknowledge → Assign vendor → Start work → Mark resolved, public update or internal-only note |
| `/moderation` | Flag queue with AI analysis and recommended action; an internal reason is mandatory; editable message to the resident; resolved history |
| `/announcements` | Read rates per notice; publish with audience and priority |
| `/events-polls` | RSVP capacity bars and live poll tallies |
| `/users` | Member summary and search; warnings and status; restrict for 24h / reactivate |
| `/ai` | Feature and tone switches, moderation threshold, auto-hold severity, approved knowledge documents |
| `/audit` | Every admin and system action, newest first; filter people/system, search, CSV export |

The header search (Ctrl K) searches issues from anywhere. Filters and the open issue live in the URL (e.g. `/issues?filter=Open&open=ISS-1042`), so links can be shared.

## Structure

```
src/store/data.ts      types + demo records + status flow
src/store/store.tsx    StoreProvider and all admin actions (immer, persisted)
src/store/context.ts   useStore()
src/auth/              AuthProvider, RequireAuth route guard, demo account
src/pages/             one file per section
src/components/        Sidebar, Header (icons: Phosphor duotone, set once in main.tsx), IssueDrawer, Charts, Toast, small UI pieces
src/lib/               nav config, timeline merge, pill tones, avatars, CSV export
src/index.css          design tokens + layout (dark sidebar, light content)
```

The resident app in `../resident-app` is a separate demo; the two don't share a backend yet.
In a real build both would read and write the same API.
