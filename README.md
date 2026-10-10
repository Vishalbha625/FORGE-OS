# 🔥 Forge OS — Personal AI Athlete Assistant

A complete, functional, **mobile-first** athlete platform for HYROX, running, strength,
nutrition, sleep, steps, hydration, body metrics, recovery, progress analytics and a
fitness community — built as a **local-first Progressive Web App**.

Open it on your phone, understand your status in seconds, and log most daily activities
in one or two taps.

> Built with React + TypeScript + Tailwind + IndexedDB. No account or server required to
> use the full personal platform. Multi-user social and device sync are clearly marked as
> needing external setup (see [below](#-features-that-need-external-setup)).

---

## Quick start

```bash
npm install
npm start         # build + run everything on http://localhost:8787 (app + AI coach API)
# or, while developing:
npm run dev       # hot-reload UI at http://localhost:5173
npm run server    # (second terminal) coach API on :8787 — the dev UI proxies /api to it
npm test          # unit tests (39) — calculations, plan, coach honesty, dedupe, audit, reminders, backup import
```

Requirements: Node 18+ (built & tested on Node 22).

### Turn on the AI coach (optional)

The coach works offline with built-in rules. To get free-form answers from Claude:

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # stays on the server, never sent to the browser
npm start
```

Then in the app: **Coach → Use AI** (or Profile → AI coach). Each question sends a summarized
4-week snapshot of your logs (no photos) to your local server, which calls `claude-opus-5-5`
with server-side refusal fallback enabled. Override with `COACH_MODEL` / `COACH_EFFORT`
(default `medium`). If the server or key is missing, answers fall back to the rule-based coach
and say so.

### Install on your phone (PWA)

1. Deploy `dist/` to any static host (Netlify, Vercel, GitHub Pages, Cloudflare Pages) — or
   run `npm run preview -- --host` and open the Network URL on your phone (same Wi-Fi).
2. Open the URL in **Safari (iOS)** or **Chrome (Android)**.
3. **iOS:** Share → *Add to Home Screen*. **Android:** menu → *Install app* / *Add to Home screen*.
4. It launches full-screen like a native app, works offline, and keeps your data on-device.

A valid `manifest.webmanifest` + service worker (via `vite-plugin-pwa`) and app icons are
included.

---

## What's inside (all working, offline)

| Area | Highlights |
|---|---|
| **Onboarding** | 6-step wizard (basics, goals, training, nutrition, lifestyle, devices) with a progress bar. Pre-fills your previously reported values **as drafts to confirm** — never assumed current, nothing fabricated. |
| **Dashboard** | Daily command center: training phase/week, race countdown, transparent daily status (On track / Needs attention / Recovery recommended / Missing data), today's plan, metrics (steps, sleep, water, calories, protein, weight), top-3 priorities, one-tap quick log. |
| **Training planner** | Full **15-week calendar** from your start date (12 Oct 2026) through race day (24 Jan 2027). Periodized Base → Build → Specific → Taper with deload weeks, your exact preferred weekly split, warm-up/cool-down, exercise cues, RPE targets, reschedule & remove with confirmation. Planned and actual data are **kept separate**. |
| **Running** | Progression from your 30–40 km base, weekly target vs planned-sum **validation**, pace auto-calculated, weekly mileage, trends. |
| **Strength** | Log sets (reps/kg/RPE), previous performance shown inline, PRs, volume, muscle-group distribution. No arbitrary kg prescribed — progression uses *your* logged data + effort. |
| **HYROX** | All 8 stations with Men-Open defaults (clearly flagged *confirm for your event*), station/combo/simulation/race modes, best station times, mini-simulations in the Specific phase. |
| **Nutrition** | Food log with a built-in vegetarian-friendly reference + custom foods, macros, daily/weekly totals vs editable targets, water, supplements (tracked separately), and **"Ask My Nutrition Coach"**. Never fabricates nutrition values. |
| **Health** | Sleep (correct duration **across midnight**, 7-day avg, quality), steps (manual, source-labelled, de-duplicated per day), body metrics & weight trend (body-fat only if *you* measure it), recovery (fatigue/soreness/motivation/stress). |
| **AI Athlete Coach** | A dedicated, data-backed conversational coach. Answers from your real logs, **tags each answer** (fact / calculation / estimate / suggestion / missing), cites dates, and **acknowledges missing data instead of inventing it**. Rule-based — works with no API key. |
| **Community** | Local-first social feed: posts with privacy controls (private / followers / public), kudos, comments, edit/delete, PR badges, weekly recap cards, search. Nothing is shared automatically; health data & routes stay private by default. |
| **Progress analytics** | Running, strength, nutrition, recovery and HYROX charts + an on-demand weekly report. Shows *"Not enough data yet"* rather than inventing stats. |
| **Data** | IndexedDB persistence; every record has id, event date, created/updated timestamps, source & units. Backdated & multiple-same-day entries, edit/delete with confirm, **export / import / backup** (merge keeps newer records, never silently duplicates). Times shown in Asia/Kolkata. |

---

## Verified against the acceptance tests

Pure-logic checks (`scratchpad/selftest`) and a headless-browser end-to-end run
(`scratchpad/smoke`) confirm, among others:

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

---

## 🔌 Features that need external setup

The personal platform is fully functional offline. These require configuration you provide —
and the app is **honest about it** (it never pretends an integration is active):

1. **Multi-user social network** (other real athletes, follows, cross-device sync) →
   a backend such as **Supabase**: auth, Postgres, row-level security, file storage.
   The current feed is intentionally local-first and shows *no fake users*.
2. **LLM-powered coach** (free-form natural-language answers) → a **server-side** API key
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
  lib/           dates.ts · calc.ts · plan.ts (plan generator) · coach.ts (rule-based coach) · constants.ts
  store/         AppContext.tsx (in-memory store + persistence) · toast.tsx
  components/    ui.tsx · charts.tsx · Layout.tsx (nav + quick-action FAB)
  features/      onboarding · dashboard · training · nutrition · community · profile ·
                 coach · analytics · health (sleep/steps/body/recovery/hydration) · logging
```

Modular by design, so training, nutrition, social and integrations can evolve independently.

---

*Your data lives on your device. Export a backup regularly (Profile → Data & backup).*
