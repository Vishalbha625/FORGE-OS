# 🔥 Forge OS — Personal AI Athlete Assistant

[![CI](https://github.com/Vishalbha625/FORGE-OS/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Vishalbha625/FORGE-OS/actions/workflows/ci.yml)

A complete, functional, **mobile-first** athlete platform for HYROX, running, strength,
nutrition, sleep, steps, hydration, body metrics, recovery, progress analytics and a
fitness community — built as a **local-first Progressive Web App**.

Open it on your phone, understand your status in seconds, and log most daily activities
in one or two taps.

> Built with React + TypeScript + Tailwind + IndexedDB. No account or server required to
> use the full personal platform. The community runs on Supabase and the AI coach on a small
> Node server; device sync is clearly marked as needing external setup
> (see [below](#-features-that-need-external-setup)).

---

## Quick start

```bash
npm install
npm start         # build + run everything on http://localhost:8787 (app + AI coach API)
# or, while developing:
npm run dev       # hot-reload UI at http://localhost:5173
npm run server    # (second terminal) coach API on :8787 — the dev UI proxies /api to it
npm test          # 180 unit and integration tests (see "Quality checks and CI" below)
```

Requirements: **Node 22+**. `@supabase/supabase-js` 2.118 needs Node's built-in WebSocket, which
Node 20 doesn't have.

### Turn on the AI coach (optional)

The coach works offline with built-in rules. To get free-form AI answers:

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # stays on the server, never sent to the browser
npm start
```

Then in the app: **Coach → AI** (or Profile → AI coach). Each question sends a short summary of your
logs (weekly totals and averages, latest check-in; never individual workouts, meals, nights, notes or
photos, see `src/lib/coachContext.ts`) to the coach server, which calls `claude-opus-5-5`
with server-side refusal fallback enabled. Override with `COACH_MODEL` / `COACH_EFFORT`
(default `medium`). If the server or key is missing, answers fall back to the rule-based coach
and say so.

### Deploy to Vercel

`vercel.json` is included. Import the repo in Vercel (framework preset **Vite**, build `npm run build`,
output `dist`). It rewrites every route except `/assets/*` and `/api/*` to `index.html` (so deep links
like `/training` work), caches hashed assets for a year, and never caches `sw.js` (so app updates reach
installed phones). After the first deploy, check that `https://<your-app>/sw.js` returns JavaScript, not HTML.

Vercel serves the app only. The AI coach server (`server/coach-server.mjs`) is a long-running Node
process, so host it separately (for example on Render) or the coach stays in its offline rule-based mode.

### Coach server on Render (app on Vercel)

The app and the coach server are then on different domains, so the server sends CORS headers
(`GET, POST, OPTIONS`; `Content-Type, Authorization`) and answers `OPTIONS` preflight with `204`,
but only for the origins you allow.

`render.yaml` sets this up: Render → New → **Blueprint** → pick this repo, then enter
`ANTHROPIC_API_KEY` when asked. It deploys `main`, installs only runtime dependencies
(`npm ci --omit=dev`), starts `npm run server`, checks `/api/health`, allows
`https://forge-os-black.vercel.app` and generates `COACH_ACCESS_TOKEN` for you.
Don't build the frontend on Render: `vite build` runs out of memory on the free plan, and Vercel
already serves the app.

To set it up by hand instead:

1. Render → New **Web Service** from this repo, branch `main`. Build `npm ci --omit=dev`, start
   `npm run server`, health check path `/api/health`.
   (The server binds `0.0.0.0` automatically when Render's `RENDER` variable is set.)
2. Render environment:
   - `ANTHROPIC_API_KEY` = your key
   - `ALLOWED_ORIGINS` = `https://your-app.vercel.app` (comma-separate several; no trailing slash needed)
   - `COACH_ACCESS_TOKEN` = a long random string, e.g. `openssl rand -hex 32`. CORS only restrains
     browsers; without a token anyone who finds the URL can spend your API credit with curl.
3. Vercel environment: `VITE_COACH_URL` = `https://<your-service>.onrender.com`, then redeploy.
4. On your phone: **Profile → AI coach**, paste the access token (stored on that device only), tap
   **Check coach server**, then turn the AI coach on. The server URL can also be set there instead of
   `VITE_COACH_URL`.

Render's free tier sleeps when idle, so the first question after a while can take ~30 s; the app
falls back to the rule-based coach if the request fails.

### Community accounts (Supabase Auth)

Health features never need an account. Only `/community` asks you to sign in. Signing out ends the
community session and never deletes anything on the device.

1. Create a Supabase project and run `supabase/schema.sql`, `supabase/storage.sql`, `supabase/photos.sql`,
   `supabase/social.sql` and `supabase/unblock.sql` (in that order) in its SQL editor.
2. Vercel environment: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (Supabase → Project settings →
   API; the anon key is public by design, RLS enforces access). Redeploy: Vite bakes these in at build time.
3. Supabase → Authentication → URL configuration: Site URL `https://forge-os-black.vercel.app`, and add
   `https://forge-os-black.vercel.app/auth/callback` and `https://forge-os-black.vercel.app/auth/reset`
   to the redirect URLs.
4. Google sign-in (optional): Authentication → Providers → Google, with a Google Cloud OAuth client whose
   authorised redirect URI is `https://<project>.supabase.co/auth/v1/callback`.

Sign-in uses PKCE, so confirmation and reset links must be opened in the same browser that asked for them.

Database checks: `bash supabase/tests/run.sh` runs the row-level security tests on a throwaway Postgres.
`bash supabase/tests/api.sh` runs the community service against a real PostgREST 12 over the same schema
(set `POSTGREST=/path/to/postgrest` if it isn't on your PATH).

### Quality checks and CI

Every push and pull request to `main` runs [GitHub Actions](.github/workflows/ci.yml) on Node 22:

| Job | What it checks |
|---|---|
| `quality` | `tsc --noEmit` (strict, no `any`), all unit and integration tests, `npm run build`, main bundle under 150 KB, coach server syntax |
| `database` | the row-level security tests on a real Postgres (`supabase/tests/run.sh`) and the community service against a real PostgREST 12 (`supabase/tests/api.sh`) |

The integration tests in `src/__tests__/integration/` walk whole journeys through the same code the
screens use: a new member from sign-up to their first charts, posting with photos, kudos, comments and
offline posting, follows, blocks and reports, the coach in rule-based and AI mode, and the data rules
(R1 health data stays on the device, R2 missing is undefined, R3 planned and actual stay separate,
backups hold only your own data). Health data lives in a real IndexedDB (fake-indexeddb); the community
backend is an in-memory stand-in (`fakeBackend.ts`) that applies the same access rules as the SQL policies,
which are themselves tested against real Postgres in the `database` job.

To run everything CI runs, locally:

```bash
npx tsc --noEmit && npx vitest run && npm run build
bash supabase/tests/run.sh                                  # needs Postgres server binaries
POSTGREST=/path/to/postgrest bash supabase/tests/api.sh     # needs PostgREST v12
```

### Install on your phone (PWA)

1. Deploy `dist/` to any static host (Netlify, Vercel, GitHub Pages, Cloudflare Pages) — or
   run `npm run preview -- --host` and open the Network URL on your phone (same Wi-Fi).
2. Open the URL in **Safari (iOS)** or **Chrome (Android)**.
3. **iOS:** Share → *Add to Home Screen*. **Android:** menu → *Install app* / *Add to Home screen*.
4. It launches full-screen like a native app, works offline, and keeps your data on-device.

A valid `manifest.webmanifest` + service worker (via `vite-plugin-pwa`) and app icons are
included.

---

## Design: ChaiUI

The interface follows the **ChaiUI** design system (the chaicode.com look), using the
`chaiui` and `chaiui-review` guides in `design/`. Because this is a Tailwind 3 project,
the theme is ported per `references/tailwind3.md`: ChaiUI tokens as CSS variables in
`src/index.css` (dark by default, light via the half-circle switch), Manrope / Montserrat / Onest,
warm hairline cards with no shadow, one solid asymmetric button per screen, outline status
chips, neutral progress, and orange only in the logo, link hovers and the badge glint.
Destructive actions use a ChaiUI confirm dialog that focuses the safe choice first.

## What's inside (all working, offline)

| Area | Highlights |
|---|---|
| **Onboarding** | 6-step wizard (basics, goals, training, nutrition, lifestyle, devices) with a progress bar. Pre-fills your previously reported values **as drafts to confirm** — never assumed current, nothing fabricated. |
| **Dashboard** | Daily command center: training phase/week, race countdown, a status badge (Recovery recommended when the latest check-in shows high fatigue or soreness or sleep has averaged under 6 h for 7 days; Needs attention when 2 or more planned sessions were missed this week; otherwise On track), today's plan or rest day, this week's distance, strength sessions, average sleep and calories, links to analytics and the coach, top-3 priorities, one-tap quick log. |
| **Training planner** | Full **15-week calendar** from your start date (12 Oct 2026) through race day (24 Jan 2027). Periodized Base → Build → Specific → Taper with deload weeks, your exact preferred weekly split, warm-up/cool-down, exercise cues, RPE targets, reschedule & remove with confirmation. Planned and actual data are **kept separate**. |
| **Running** | Progression from your 30–40 km base, weekly target vs planned-sum **validation**, pace auto-calculated, weekly mileage, trends. |
| **Strength** | Log sets (reps/kg/RPE), previous performance shown inline, PRs, volume, muscle-group distribution. No arbitrary kg prescribed — progression uses *your* logged data + effort. |
| **HYROX** | All 8 stations with Men-Open defaults (clearly flagged *confirm for your event*), station/combo/simulation/race modes, best station times, mini-simulations in the Specific phase. |
| **Nutrition** | Food log with a built-in vegetarian-friendly reference + custom foods, macros, daily/weekly totals vs editable targets, water, supplements (tracked separately), and **"Ask My Nutrition Coach"**. Never fabricates nutrition values. |
| **Health** | Sleep (correct duration **across midnight**, 7-day avg, quality), steps (manual, source-labelled, de-duplicated per day), body metrics & weight trend (body-fat only if *you* measure it), recovery (fatigue/soreness/motivation/stress). |
| **AI Athlete Coach** | A dedicated, data-backed conversational coach. Answers from your real logs, **tags each answer** (fact / calculation / estimate / suggestion / missing), cites dates, and **acknowledges missing data instead of inventing it**. Rule-based — works with no API key. |
| **Community** | Local-first social feed: posts with privacy controls (private / followers / public), kudos, comments, edit/delete, PR badges, weekly recap cards, search. Nothing is shared automatically; health data & routes stay private by default. |
| **Progress analytics** | A weekly review (week X of 15, distance against the plan so far with an On track / Needs attention / Behind badge, sets, calories, sleep, readiness) and six charts for this week, this month or the last 4 weeks: running (daily km, total so far vs plan), strength sets per muscle group, HYROX station times, macro calories vs target, recovery check-ins with a 7-day trend, and sleep with a 7-day average and the 7 to 8 h band. Every chart has a table view and a colour-blind-safe palette in both themes. All computed on the device; days with nothing logged stay empty, never zero. |
| **Reminders** | While the app is open: workout, meals (3 a day), water every 2 hours while awake, bedtime, a Monday weigh-in, the Sunday weekly review, race countdown and missing logs. Each has its own switch and time, respects quiet hours, and shows its next time in Profile. |
| **Data** | IndexedDB persistence; every record has id, event date, created/updated timestamps, source & units. Backdated & multiple-same-day entries, edit/delete with confirm, **export / import / backup** (merge keeps newer records, never silently duplicates). Times shown in Asia/Kolkata. |

---

## Verified against the acceptance tests

Unit tests (`npm test`) and a headless-browser end-to-end run confirm, among others:

- ✅ Onboard with existing profile and correct old values
- ✅ Phone-sized layout; log a run in one–two taps
- ✅ 5 km in 30:00 → **6:00 min/km**
- ✅ Completed workout **persists after refresh**
- ✅ Backdated entries land on the correct date; planned ≠ actual kept separate
- ✅ Steps labelled with source; **sleep duration correct across midnight**
- ✅ Meal totals compute; missing nutrition is **not fabricated**
- ✅ Strength shows previous performance; HYROX history keeps load/reps/distance/time
- ✅ Weekly mileage consistent with records; plan changes never erase completed workouts
- ✅ Coach **acknowledges missing data** instead of inventing it
- ✅ Social post publishes with an explicit privacy setting
- ✅ Export/import without silent duplication
- ✅ Every visible button performs its action
- ✅ No automated accessibility violations (axe, WCAG 2.1 AA) on 26 screens in both themes
- ✅ Installs as a PWA and reopens offline with your data

---

## 🔌 Features that need external setup

The personal platform is fully functional offline. These require configuration you provide —
and the app is **honest about it** (it never pretends an integration is active):

1. **Community** (feed, photos, kudos, comments, follows, blocks, reports) → a **Supabase** project
   (auth, Postgres with row-level security, storage). Built and tested; see
   [Community accounts](#community-accounts-supabase-auth). Health data never goes there.
2. **AI coach** (free-form answers) → the coach server with a **server-side** API key
   (never in frontend code). The built-in coach is rule-based and needs no key.
3. **Device / health sync** (steps, sleep, HR, HRV, GPS routes) → platform APIs and your
   authorization: Apple Health & Health Connect (native app), Garmin / Fitbit / Strava
   (developer API access + OAuth). Until connected, data is manual and source-labelled.
4. **Background push reminders** → notification permission + a push service. Reminder
   preferences & quiet hours are configurable now; delivery needs that service.

See **Profile → Setup notes & limitations** inside the app for the same summary.

---

## Architecture

```
src/
  db/            types.ts (full data model) · database.ts (IndexedDB CRUD, export/import)
  lib/           dates.ts · calc.ts · plan.ts (plan generator) · coach.ts (rule-based coach) · analytics.ts · reminders.ts · constants.ts
  store/         AppContext.tsx (in-memory store + persistence) · appData.ts (load, snapshot, plan rebuild) · AuthContext.tsx · toast.tsx
  components/    ui.tsx · charts.tsx · Layout.tsx (nav + quick-action FAB) · ErrorBoundary.tsx · Skeleton.tsx · PageTransition.tsx
  features/      onboarding · dashboard · training · nutrition · community · profile ·
                 coach · analytics · health (sleep/steps/body/recovery/hydration) · logging · auth
  __tests__/     unit tests · integration/ (user journeys)
server/          coach-server.mjs (AI coach API, also serves dist/ for npm start)
supabase/        schema, storage, photos, social, unblock SQL · tests/ (RLS + PostgREST)
.github/         workflows/ci.yml
```

Modular by design, so training, nutrition, social and integrations can evolve independently.

---

*Your data lives on your device. Export a backup regularly (Profile → Data & backup).*

---

© 2026 Vishal Bhardwaj. Forge OS is created and owned by Vishal Bhardwaj.
