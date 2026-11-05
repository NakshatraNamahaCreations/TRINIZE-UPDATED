# Trinize Resident App (React Native)

React Native (Expo SDK 58 + Expo Router) build of the **Resident app** from the
[Trinize Community simulation](https://trinize-community-sim.vercel.app/). You play
Ananya Iyer (Owner, T4-1108, Prestige Lakeside Habitat). All data is fictional and lives in memory.

## Run

```bash
npm install
npx expo start          # press a = Android, i = iOS, w = web — or scan the QR with Expo Go
```

`npm run typecheck` and `npx expo lint` should both pass.

## Screens & flows

| Tab / route | What it does |
|---|---|
| **Home** `/` | Greeting hero, impact stats, quick links, gratitude wall, announcements, guidelines, community moments |
| `/discussions` · `/compose` | Feed with reactions, "My posts", held-for-review state · new post with **AI tone rewrite** (suggest-only) and the **abuse guard** (warn → rewrite / edit / post-and-hold, or block) |
| `/events` | RSVP with capacity, waitlist when full, change RSVP |
| `/polls` | One vote per unit; results shown only after voting |
| `/directory` | Committee, emergency, vendors — search + real tap-to-call |
| `/announcements/[id]` | Detail + "I've read this" acknowledgement for high-priority notices |
| `/notifications` | Bell — All / Unread / My issues / Community, deep-links to the right screen |
| **Assistant** `/assistant` | Grounded Q&A with sources, emergency handoff, weekly summary, and the guided **issue report**: describe → location → urgency → preview → confirm (double-tap safe) |
| **My Issues** `/issues/[id]` | Status, SLA, vendor, public timeline, private rating on resolved issues |
| **Profile** `/profile` · `/tour` | Preferences, plus the "Seven things to try" demo guide with progress |
| **+** button | Create sheet: new discussion, report issue, send gratitude (moderated, private by default), suggest event |

## Structure

```
src/app/                 routes (Expo Router)
  (tabs)/_layout.tsx     tabs with custom bar + raised "+" button
  (tabs)/(home)/         home stack: index, discussions, compose, events, polls, directory, announcements, notifications, tour
  (tabs)/assistant.tsx   Community Assistant chat
  (tabs)/issues/         My Issues stack
  (tabs)/profile.tsx
src/store/data.ts        types + demo records
src/store/logic.ts       safety check, tone rewrite, record mutators, assistant engine (pure, immer drafts)
src/store/store.tsx      StoreProvider + resident actions
src/components/          UI kit, header, tab bar, sheets, toast + confetti
src/theme.ts             CFM purple tokens + Plus Jakarta Sans weights
```

The store also keeps `modqueue` and `audit` records — the shared data a Society Admin
console would read. AI, moderation and notifications are mocked client-side; in a real
build they belong on the server.
