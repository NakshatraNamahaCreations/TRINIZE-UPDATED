# Trinize API

One backend for the three front-ends: the resident app (`resident-app/`), the Society Admin console
(`society-admin/`) and the Owner Portal (`owner-portal/`). TypeScript on Node 22, Fastify 5, PostgreSQL via
Drizzle ORM.

## Run

```bash
npm install
cp .env.example .env          # then edit — see below
npm run db:migrate            # creates the tables (skip for pglite: it migrates itself)
npm run db:seed               # the demo society: Prestige Lakeside Habitat (fresh database)
npm run db:seed:phases        # adds assistant documents + operator portfolio to an already-seeded database
npm run dev                   # http://localhost:4000
npm test                      # 39 API tests on an in-memory Postgres
```

`DATABASE_URL` can be:

- `postgres://user:pass@localhost:5432/trinize` — local Postgres 17 (or RDS in staging/production)
- `pglite:./.data` — an in-process Postgres stored in `.data/`; nothing to install, good for a quick demo

With `SMS_PROVIDER=console` the sign-in code is printed in the server log. `FIXED_OTP=123456` makes every code
123456 for staging demos; it is ignored when `NODE_ENV=production`.

## Demo accounts (seed)

| Who | Sign in |
|---|---|
| Ananya Iyer — owner, T4-1108 | phone 9876543210 + OTP |
| Karthik Iyer — family member, same flat | phone 9845012345 + OTP |
| Sanjana Rao — Secretary (Society Admin) | sanjana.rao@prestigelakeside.in / Lakeside@2026 |
| Ravi Kulkarni — Trinize operator (Owner Portal) | ravi.kulkarni@trinize.com / Trinize@2026 |

## API (v1, Phase 1)

All bodies are JSON. Errors look like `{ "error": { "code": "already_voted", "message": "…" } }`.
Authenticated routes take `Authorization: Bearer <accessToken>` (15 minutes); renew with the refresh token
(30 days, rotated on every use — reusing an old one signs that user out everywhere).

| Method | Path | |
|---|---|---|
| POST | `/v1/auth/otp/request` | `{ phone }` — registered numbers only; 30 s between codes, 5 per hour |
| POST | `/v1/auth/otp/verify` | `{ phone, code }` → `{ accessToken, refreshToken, user }`; 5 tries per code |
| POST | `/v1/auth/refresh` · `/v1/auth/logout` | `{ refreshToken }` |
| POST | `/v1/auth/staff/login` | `{ email, password }` → session + roles |
| GET | `/v1/auth/staff/me` | staff profile and roles |
| GET | `/v1/me` | resident, flat, role, society |
| GET | `/v1/announcements` · POST `/v1/announcements/:id/ack` | notices with your acknowledgement state |
| GET | `/v1/events?scope=upcoming\|past` | past = already ended; ordered by start |
| POST / DELETE | `/v1/events/:id/rsvp` | seat while there is one, else waitlist |
| GET | `/v1/polls` · POST `/v1/polls/:id/vote` | one vote per flat; owners-only polls; closes on its end date |
| GET | `/v1/directory` | committee, emergency, vendors |
| GET / POST | `/v1/issues` | your tickets / report one (`via: chat \| form`, optional `photoUrl`) |
| GET | `/v1/issues/:ref` | e.g. `ISS-1043` — timeline and your updates, never staff notes |
| POST | `/v1/issues/:ref/updates` · `/reopen` · `/rating` | comment/photo, reopen with a reason, 1–5 stars |
| POST | `/v1/uploads` | multipart photo (JPEG/PNG/WebP/HEIC, ≤ 8 MB) → `{ url }` |
| GET | `/v1/admin/:aid/issues[?status=]` · `/issues/:ref` | Society Admin queue, with internal notes |
| POST | `/v1/admin/:aid/issues/:ref/status` | `{ to, note?, vendorId? }` — only allowed moves; Assigned needs a vendor |
| POST | `/v1/admin/:aid/issues/:ref/notes` | staff-only note |
| GET | `/v1/admin/:aid/vendors` · `/units` · `/audit` | |
| GET / POST | `/v1/admin/:aid/announcements` | list with acknowledgement counts / publish |

### Phase 2 — community, safety, notifications

| Method | Path | |
|---|---|---|
| GET / POST | `/v1/posts` | feed / publish. Abuse → 422 `blocked`; borderline → 409 `needs_review`, resend with `confirm: true` to post it held for a moderator |
| GET / DELETE | `/v1/posts/:ref` | e.g. `D-232` with its replies / delete your own |
| POST | `/v1/posts/:ref/replies` · DELETE `/v1/replies/:id` | borderline replies are held, visible to the author only |
| PUT | `/v1/posts/:ref/reaction` | `{ kind }` or `{ kind: null }` — one per resident |
| POST | `/v1/reports` | `{ targetType, targetId }` — once per item; the reporter stays private |
| GET / POST / DELETE | `/v1/blocks` | hide a resident's posts and replies from you |
| GET / POST | `/v1/gratitudes` · GET `/v1/neighbours` | community wall and private thanks |
| GET | `/v1/notifications` · POST `/:id/read` · `/read-all` | in-app notifications, honouring each resident's switches |
| POST | `/v1/devices` | register a push token (delivery needs a Firebase project) |
| GET / PUT | `/v1/settings` | notification and privacy switches |
| GET / POST / DELETE | `/v1/family` | household members; owners add, the office verifies |
| GET / POST | `/v1/event-suggestions` | ideas for the committee |
| GET | `/v1/me/export` · DELETE `/v1/me` | data export; account deletion |
| GET | `/v1/admin/:aid/moderation[?state=]` · POST `/:id/action` | queue; Allowed / Warned author / Rewrite suggested / Hidden |
| PUT | `/v1/admin/:aid/moderation-threshold` | Lenient / Standard / Strict |
| POST | `/v1/admin/:aid/events` · `/polls` · `/polls/:id/close` | publish events and polls |
| GET / POST | `/v1/admin/:aid/event-suggestions` · `/:id/decision` | approve or decline ideas |
| GET / PUT | `/v1/admin/:aid/users` · `/users/:id/standing` | residents and their standing |
| POST | `/v1/admin/:aid/members/:id/verify` | verify a household member |

### Phase 3 — assistant and AI

Set `OPENAI_API_KEY` in `.env` to run these on OpenAI GPT: `AI_MODEL` answers questions (default `gpt-5.4-mini`), `AI_MODEL_FAST` does moderation and tone rewrite (default `gpt-5.4-nano`), both at `AI_REASONING=low`. Chosen by measurement — `npm run ai:bench -- <model[:effort]> …` runs 20 fixed checks against any models and prints accuracy and speed. Without a key they run on
built-in rules: answers are quoted passages from the approved documents, moderation is the word lists, and tone
rewrite is rule-based. Emergencies and abuse are always handled by fixed rules and never reach a model. If the
model declines or is unavailable, the request falls back to the rules instead of failing.

| Method | Path | |
|---|---|---|
| POST | `/v1/assistant/chat` | `{ text }` → answer with its source; understands Hindi, Hinglish and Kannada keywords |
| GET | `/v1/assistant/history?limit=&cursor=&before=` | the signed-in resident's own conversation, newest first, a page at a time (`limit` 1–50, default 20) → `{ items, nextCursor }`; pass `nextCursor` back as `cursor` for the page before |
| POST | `/v1/assistant/history` | `{ messages: [{ role, text }] }` (up to 10) — turns of the app's guided issue-report chat; stored as `flow`, not counted as questions |
| DELETE | `/v1/assistant/history` | removes it all; history is kept only while the resident's "assistant history" switch is on |
| POST | `/v1/assistant/rewrite` | `{ text, tone }` — Polite / Friendly / Funny / Short & Clear, facts kept |
| GET / PUT | `/v1/admin/:aid/ai-settings` | Q&A, issue creation, tone rewrite, summaries, per-tone switches |
| GET / POST / DELETE | `/v1/admin/:aid/knowledge` | the approved documents the assistant may answer from |

### Phase 4 — operator portal (Trinize operators only)

| Method | Path | |
|---|---|---|
| GET | `/v1/ops/summary` · `/activity` | MRR, ARR, overdue, health bands; activity feed |
| GET | `/v1/ops/associations` · `/associations/:id` | portfolio ranked by health, worst first / Association 360 |
| POST | `/v1/ops/associations` | onboard a society: association, subscription and (with `adminPassword`) its first console login |
| PUT | `/v1/ops/associations/:id/subscription` | plan, state, amount, renewal date |
| GET / POST | `/v1/ops/invoices` · POST `/:id/chase` · `/:id/payment` | collections |
| GET | `/v1/ops/tickets` · `/tickets/:id` · POST `/:id/assign` · `/:id/reply` | support tickets with SLA state |
| GET | `/v1/ops/modules` | modules by plan, with the share of associations that have each |
| GET / POST | `/v1/ops/vpms` · PUT `/:id/societies` · DELETE `/:id` | property managers (VPMs): create, change their societies, remove |

### Phase 5 — hardening done locally

- Staff two-step sign-in (authenticator app): `POST /v1/auth/staff/2fa/setup`, `/2fa/enable`; once on, `/staff/login` returns `{ mfaRequired, mfaToken }` and `POST /v1/auth/staff/mfa` finishes the sign-in.
- Security headers on every response; rate limits on sign-in, posting and uploads; uploads checked by file signature.
- Still needs accounts: real SMS (MSG91 + DLT), push delivery (Firebase), S3 for photos, hosting, backups, monitoring.
## Layout

```
src/
  app.ts            Fastify app: CORS, rate limits, uploads, error format, routes
  server.ts         entry point
  config.ts         environment, validated at start-up
  db/schema.ts      tables (Drizzle) — migrations are generated into drizzle/
  db/seed.ts        demo society
  lib/              auth (tokens, who-is-calling), OTP/password crypto, SMS providers, issue rules, audit
  routes/           auth, resident, issues, uploads, admin
test/               API tests (vitest + in-memory Postgres)
```

After changing `src/db/schema.ts`, run `npm run db:generate` and commit the new file in `drizzle/`.

## What is left

Everything that needs an outside account: MSG91 (real SMS), Firebase (push delivery), an OpenAI API key (AI on GPT instead of
rules), AWS (hosting, S3, backups, monitoring), a mail provider (invoice reminders), a payment gateway. And connecting the three
front-ends to these APIs — the resident app uses sign-in, notices, events, polls and issues so far.

## Visitor & delivery management

Three sides. Guards are added by the society office and sign in on the mobile app with their mobile number + OTP, like residents.

| Who | Method | Path | What |
|---|---|---|---|
| Guard | GET | `/v1/gate/me` · `/gate/units?q=` · `/gate/lookup?phone=` | post and counts / find a flat / repeat visitor, regular, watch list |
| Guard | POST | `/v1/gate/visits` | a visitor or delivery arrives — the flat is asked unless a rule answers (block list, standing permission, emergency) |
| Guard | GET | `/v1/gate/visits?tab=waiting|inside|parcels|today` | the gate lists |
| Guard | POST | `/v1/gate/pass` · `/gate/visits/:id/enter` · `/exit` | check a 6-digit pass / let in / mark exit (optional proof photo) |
| Guard | POST | `/v1/gate/visits/:id/decision` · `/keep` · `/collect` | record the flat's answer given by phone / parcel taken by security / handover by the resident's code or a name |
| Resident | GET / POST | `/v1/visits` · `/visits/:id` · POST `/:id/decision` · `/:id/cancel` | my flat's gate, pre-approve (pass code), approve / reject / leave at gate |
| Resident | GET / POST / DELETE | `/v1/frequent-visitors` | regular visitors, optionally let in without asking |
| Office | GET | `/v1/admin/:aid/visits` · `/visits/summary` · POST `/visits/:id/decision` | society-wide register with filters / today's counts / answer for a flat |
| Office | GET / POST / PUT / DELETE | `/v1/admin/:aid/guards` · `/watchlist` | guards and their gates / block and watch list |
| Office | GET / POST / DELETE | `/v1/admin/:aid/gate-codes` | QR stickers for the gates; each carries `PUBLIC_URL/visit/<token>`. Deleting one stops a printed sticker working |
| Visitor (no sign-in) | GET | `/visit/:token` | the self check-in page the QR opens |
| Visitor (no sign-in) | GET / POST | `/v1/checkin/:token` · `/units?q=` · `/visits` | society and gate / find a flat by number (no resident details) / ask the flat. The number is unverified, so the flat is always asked; the block list still refuses |
| Visitor (no sign-in) | GET | `/v1/checkin-status/:ticket` | the flat's answer, for the phone that made the request (ticket valid 24 h) |
| Visitor (no sign-in) | POST | `/v1/checkin-status/:ticket/cancel` | withdraw the request, until the guard has let them in |
| Visitor (no sign-in) | WebSocket | `/v1/checkin-status/:ticket/live` | the same answer, pushed the moment it changes |
| Guard | WebSocket | `/v1/gate/live` | first message `{ "token": "<access token>" }`, then `{ "type": "changed" }` whenever anything at the gate changes. A reverse proxy in front must pass WebSocket upgrades; one server process only (see `lib/gate-live.ts`) |

Seeded guard: `9822200007` (Ramesh Kumar, Main gate). Pass and collection codes are shown only to the resident; the guard and the office never receive them.

## Communication hub

One place for everything the office sends. A message has a type, a priority, an audience (all / blocks / flats / owners or tenants / chosen residents) and one or more channels; every copy gets a delivery record.

| Method | Path | What |
|---|---|---|
| GET | `/v1/admin/:aid/comms/audience` · POST `/comms/audience/count` | blocks, flats and residents to choose from / how many a choice reaches |
| POST | `/v1/admin/:aid/comms/polish` | rewrite a rough draft in a tone (AI when a key is set, rules otherwise) |
| GET / POST | `/v1/admin/:aid/comms/messages` | dashboard with filters / send now, schedule or save a draft |
| GET / PUT | `/v1/admin/:aid/comms/messages/:id` · POST `/send` · `/cancel` · `/board` | deliveries per resident and channel / edit a draft / send, cancel, pin or take off the notice board |
| GET | `/v1/admin/:aid/comms/report` · `/comms/history/:userId` | delivery, read and failure report / one resident's history |
| GET / POST | `/v1/admin/:aid/conversations` · `/:id` · `/:id/messages` · `/:id/status` | the office's side of direct messages |
| GET / POST | `/v1/conversations` · `/:id` · `/:id/messages` | the resident's side |
| POST | `/v1/announcements/:id/seen` | the resident opened a notice (read tracking) |

Channels: `portal` (notice board, with start, expiry and pin) and `push` (in-app alert) are real. `whatsapp`, `sms` and `email` go through `src/lib/messenger.ts`; with `MESSAGING=console` (the default) they are written to the server log and recorded as **Logged**, never as sent. Scheduled messages go out within a minute of their time.

## Accounting

A double-entry ledger is the single source of truth. Billing a flat, taking a payment, waiving, booking and paying an expense each post one balanced journal entry; every report is read back from those lines. Amounts are whole rupees.

| Method | Path (under `/v1/admin/:aid/finance`) | What |
|---|---|---|
| GET | `/dashboard` | collection, pending and overdue dues, income and expenses, bank and cash, cash flow, reconciliation |
| GET / POST / PUT | `/accounts` · `/settings` · `/units` · `/units/:id/opening` | chart of accounts, dues rules, flat area and type, opening balances |
| POST | `/bills/preview` · `/bills/run` · `/bills` | work out a month's bills (by area, flat type or one amount), generate them, or bill one flat |
| GET / POST | `/bills` · `/bills/:id/waive` · `/bills/:id/cancel` · `/late-fees/run` · `/reminders` | bills, waivers, cancellation, late fees, overdue reminders |
| GET / POST | `/payments` · `/payments/:id` · `/:id/reverse` · `/:id/cheque` | receipts (UPI, transfer, cash, cheque, card), reversal, cheque cleared or bounced |
| GET | `/ledger/:unitId` | one flat's account with a running balance (`?format=csv`) |
| GET / POST | `/expenses` · `/:id/decision` · `/:id/pay` | book, approve or reject, pay; a vendor invoice approved in Maintenance is booked automatically |
| GET / POST | `/journal` · `/journal/:id/reverse` | manual entries (must balance) |
| GET / POST | `/bank/import` · `/bank` · `/bank/:id/match` · `/unmatch` · `/categorize` · `/ignore` | upload a statement CSV, auto-match, match or post by hand |
| GET / POST / DELETE | `/periods` · `/periods/:period/lock` | close a month (nothing dated in it can change) and reopen it |
| GET | `/reports/:name` | collection, defaulters, income, expense, vendors, pnl, balance-sheet, cash-flow, trial-balance, reconciliation, daybook, audit (`?format=csv`) |
| GET / POST / DELETE | `/auditors` | read-only logins to the books |
| GET / POST | `/v1/dues` · `/v1/dues/receipts/:id` · `/v1/dues/pay` | the resident: balance, bills, ledger, receipts, paying |

Paying in the app needs a payment gateway merchant account. `PAYMENTS=off` (the default) answers "not set up"; `PAYMENTS=mock` stands in for the gateway in development and tests and is refused in production.

## Owner portal

A read-only window for flat owners (anyone recorded as the Owner of a flat), in the mobile app. Rent collected for a let flat is a debt to the owner (account 2200), approved repairs on that flat come out of it, and payouts are capped at what is held.

| Method | Path | What |
|---|---|---|
| GET | `/v1/owner/me` · `/owner/dashboard` | my flats and what I may see / this month in numbers and words |
| GET | `/v1/owner/statement` · `/transactions` · `/expenses` · `/society-accounts` | reports for a period and flat (`?format=csv` on the first three) |
| GET / POST | `/v1/owner/requests` · `/:ref` · `/:ref/approval` · `/:ref/comment` | repairs on my flats, approving an estimate, a note for the office |
| GET / POST | `/v1/owner/documents` · `/:id/opened` | documents shared with me |
| GET / PUT | `/v1/admin/:aid/owners/settings` | what owners see; the amount above which an owner must approve a repair |
| GET / PUT / POST | `/v1/admin/:aid/owners` · `/owners/units/:id` · `/owners/payouts` · `/owners/activity` | flats, occupancy and rent, paying an owner, what owners opened |
| GET / POST / PUT / DELETE | `/v1/admin/:aid/documents` | documents for one flat or every owner |

## Emergencies

An SOS raised from the app tells the guards and the office at once and goes on the incident log (`src/routes/emergency.ts`). The office sees and closes alerts under Gate → Emergency alerts.

| Method | Path | What |
|---|---|---|
| GET / POST | `/v1/emergency` · `/v1/sos` · `/v1/emergency/:id/ack` | resident or guard: numbers to call, raise an SOS, a guard responding |
| GET / POST | `/v1/admin/:aid/incidents` · `/incidents/:id/ack|resolve` · `/incidents/reach` | the office: the incident log, respond, close with what was done |

## AI assistant for staff and the AI audit log

The resident assistant (Phase 3) answers from documents. The staff assistant answers from records. A question is matched to fixed, tested look-ups ("tools", `src/lib/copilot.ts`), each belonging to a domain; a role may use only its own domains, so data a role may not see is never fetched. An action is only ever proposed — it runs when the same person confirms it. With `OPENAI_API_KEY` set the model words the answers, chooses look-ups for free wording, reads complaints and writes drafts; without it the built-in rules do all of that.

| Method | Path (under `/v1/admin/:aid`) | What |
|---|---|---|
| GET | `/assistant/about` | my role, what it may see, example questions |
| POST | `/assistant/ask` | a question (answer + the tables behind it), or an action proposed for a yes |
| POST | `/assistant/actions/:id/confirm|cancel` | carry out or drop a proposed action: send overdue reminders, create a work order |
| POST | `/assistant/draft` | draft a message of one of nine kinds; unknown facts are left in [brackets] |
| POST / GET | `/assistant/triage` · `/issues/:ref/suggestion` | read a complaint: trade, priority, response time, least-loaded vendor |
| GET | `/search?q=` | flats and people, vendors, work orders, bills and console pages — scoped to the role |
| GET | `/ai-audit[?only=actions]` | who asked what, the answer, records read, action, whether it needed a yes, status |
| POST | `/v1/assistant/ask-office` | resident: pass a question the assistant could not answer to the office as a message |

Roles: admin, VPM, committee and operator see everything; auditor money only; guard the gate only; moderator community only. Only admin, VPM and operator can confirm actions. `/v1/assistant/chat` now also answers from the resident's own account (dues, receipts, visitors, lease) and returns `link` (the screen to open) and `offer: "ask_office"`.

## Inspections

A checklist is copied into the inspection when it starts. Each item gets a rating (Good, Fair, Poor, Damaged, Missing), a note and up to eight photos. Submitting is refused while anything is unrated or a required photo is missing. Findings come from the rules (`ruleFinding`) or, with an AI key, from a vision model looking at the photos (`analyse` in `src/lib/inspections.ts`); the inspector's rating is never overwritten.

| Method | Path (under `/v1/admin/:aid/inspections`) | What |
|---|---|---|
| GET | `/options` | types, built-in checklists (flat, common areas, fire & safety), the society's own, flats |
| POST / DELETE | `/templates` · `/templates/:id` | a society's own checklist |
| POST / GET | `/` · `/:id` | start one; list; the full report with what is missing |
| PUT | `/:id/items/:item` | rate, note, photos |
| POST | `/:id/analyse` · `/:id/submit` | write findings so far; finish and write the summary |
| PUT | `/:id/share` | share with the flat's owner and/or tenant — they are notified |
| POST | `/:id/work-orders` | findings → work orders with photos and notes; an estimate goes through the usual approvals |
| GET | `/:id/report.csv` | the report as a spreadsheet |
| GET / POST | `/v1/inspections` · `/v1/inspections/:id` · `/v1/inspections/:id/ack` | resident or owner: shared reports, and acknowledging one |

A move-out inspection is compared item by item with the flat's latest move-in.

## Platform housekeeping (plans, societies, super admins, support)

Routes in `src/routes/platform.ts`; plan rules in `src/lib/plans.ts`; settings table in `src/db/schema12.ts`.

| Route | Who | What it does |
| --- | --- | --- |
| `GET/PUT /v1/ops/plans` | super admin | Each plan's tagline, description and list price, and the plan every module starts at. Applies to all societies at once. |
| `PUT /v1/ops/associations/:id` | super admin | Corrects a society's name, city, type, size and contact. |
| `DELETE /v1/ops/associations/:id` | super admin | Removes a society and all of its records. The body must carry `{ "confirm": "<exact name>" }`. |
| `GET/POST /v1/ops/operators`, `PUT …/:id/password`, `DELETE …/:id` | super admin | The people who can sign in to the Owner Portal. Nobody can remove themselves or the last super admin. |
| `POST /v1/auth/staff/password` | any staff login | Change your own password (`current`, `next`). |
| `GET /v1/admin/:aid/plan` | society staff | The society's plan, state and which console sections it includes. |
| `GET/POST /v1/admin/:aid/support`, `GET …/:id`, `POST …/:id/reply` | society staff | Issues raised with Trinize. They appear in the Owner Portal's Support issues. |

**Plan enforcement.** `planGuard` runs before every `/v1/admin/:aid/…` route. A suspended society gets `403 subscription_suspended` on everything except `plan` and `support`. A section the plan does not include gets `403 plan_required`. The sections and their routes are listed in `FEATURES` in `src/lib/plans.ts`. Resident-app routes are not held to the plan.

**Payment reminders.** `POST /v1/ops/invoices/:id/chase` sends an email to the society's contact through the messenger and returns `delivery` (`Sent`, `Logged`, `Skipped` or `Failed`). Until a mail provider is configured the messenger only records the message, so the answer is `Logged`.

## Gallery (Community moments)

Routes in `src/routes/gallery.ts`; tables in `src/db/schema13.ts` (migration `0012_gallery`).

| Route | Who | What it does |
| --- | --- | --- |
| `GET /v1/admin/:aid/gallery` | society staff | Every album with its photos, including hidden and empty ones. |
| `POST /v1/admin/:aid/gallery` | admin, committee | Creates an album (`title`, `eventDate`, optional `description`, `published`, `photos`). |
| `PUT /v1/admin/:aid/gallery/:id` | admin, committee | Renames it, changes its date, hides or shows it, or sets `coverPhotoId`. |
| `DELETE /v1/admin/:aid/gallery/:id` | admin, committee | Deletes the album, its photos and their files. |
| `POST /v1/admin/:aid/gallery/:id/photos` | admin, committee | Adds photos already uploaded through `POST /v1/uploads` (up to 30 a call, 200 an album). |
| `PUT` / `DELETE /v1/admin/:aid/gallery/:id/photos/:photoId` | admin, committee | Sets a caption, or removes a photo and its file. |
| `GET /v1/gallery` | resident | Published albums that have at least one photo, newest event first. |

Photos are stored as a path (`/files/<name>`), not a full address, so each app reaches them through whatever address it uses for the server. Residents are notified once per album, the first time it is visible with photos.

## Lists that are read a page at a time

Lists that grow with the society take `page` (from 1), `limit` (1–100, default 10), `q` (search) and `sort`, plus their own filters, and answer `{ items, total, page, limit, pages }` — the database does the searching, sorting and slicing (`src/lib/paging.ts`). Without `page` they still return the whole list, for the few callers that need every row.

| Path | Search | Filters | Sort |
|---|---|---|---|
| `/v1/admin/:aid/owners` | flat number, owner's or tenant's name or phone | `occ`, `owner=Yes|No` | `rent`, `lease` |
| `/v1/admin/:aid/visits` | `q`: name, phone, vehicle, partner | `from`, `to`, `unit`, `kind`, `status` | newest first |
| `/v1/assistant/history` | — | `before` | newest first, by cursor |

## Taken out of the product

Leasing (applications, screening, eSign), Workflows and tasks, Insights and the monthly report page, message templates, and the WhatsApp and SMS message channels were removed. Their routes are gone; their tables are still in the schema and hold whatever was recorded before.
