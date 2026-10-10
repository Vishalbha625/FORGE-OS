=== PROJECT IMPLEMENTATION BRIEF ===

**[Project Name]:** Forge OS
**[Type]:** Web App: a mobile-first Progressive Web App (installable on phone, works offline), plus a small optional Node server
**[Tech Stack Summary]:** React 18 + TypeScript + Tailwind CSS 3 (ChaiUI design) + Vite  **+**  Node.js HTTP server (AI coach API, optional)  **+**  IndexedDB in the browser (today) / Supabase Postgres for the community (schema designed and tested, not yet wired)

Owner: Vishal Bhardwaj
Repository: https://github.com/Vishalbha625/FORGE-OS, branch `claude/vigilant-turing-wperw5`
Brief written: 10 Oct 2026, against commit `54e08ed`.

---

--- DETAILED SECTIONS ---

## 1. Project overview

**Project name:** Forge OS

**One-line description:** A personal athlete assistant that plans, logs and coaches HYROX, running, strength, nutrition, sleep and recovery training, using only the athlete's own real data.

**Detailed description:**

Forge OS is a phone-first app built for one athlete (Vishal, 23, vegetarian) preparing for **HYROX Men Open on 24 January 2027**, with training starting **12 October 2026**. It generates a complete 15-week periodised training calendar (Base, Build, Specific, Taper) from his preferred weekly split, combining running (30 to 40 km a week to start), strength (legs, chest/triceps, back/biceps, delts, abs) and HYROX station work. Each day shows what to do, and logging a run, gym session, HYROX circuit, meal, water, sleep, steps, weight or recovery check-in takes one or two taps.

Everything is stored on the device (IndexedDB), works offline and can be installed to the home screen. Planned workouts and completed workouts are kept strictly separate, every record carries its real event date and data source, edits and deletions are kept in an audit history, and nothing is ever filled in or invented: missing data is shown as missing. A built-in rule-based "My Athlete Coach" answers questions from the logs (today's workout, weekly kilometres, protein today, recovery, on track for HYROX), and an optional server-side AI coach gives free-form answers without exposing an API key in the browser.

A Strava-inspired community feed lets the athlete share runs, sessions, PRs and weekly recaps with private / followers / public visibility. Today it is local-first (single user, on device). A Supabase backend with row-level privacy rules has been written and tested against a real Postgres database, but is not yet connected to the app. The interface follows the ChaiUI design system (the chaicode.com look).

**Target audience / end users:** Primary: one amateur hybrid athlete (HYROX + running + strength) who wants a single personal tool. Secondary (future): other athletes and friends in a shared community feed.

**Problem it solves:**
- Training plan, run logs, gym logs, food, sleep and body data usually live in 4 to 6 different apps that don't talk to each other.
- Generic apps don't understand HYROX (8 stations + 8 km of running) or a mixed run + lift schedule.
- Most "AI" fitness apps guess or fabricate numbers; this one only uses logged data and says when data is missing.
- Plan changes in other apps often overwrite history; here planned and actual are separate and history is never rewritten.

**Project type:** Web App (mobile-first PWA). Optional Node API server. Planned Supabase backend.

---

## 2. Tech stack and architecture

| Area | Choice |
|---|---|
| Frontend framework | React 18.3 with TypeScript 5.9 |
| Routing | react-router-dom 6 (BrowserRouter, lazy-loaded routes) |
| UI library | Custom component kit in `src/components/ui.tsx` built to the **ChaiUI** design system; icons from **lucide-react**; charts from **Recharts** |
| CSS framework | Tailwind CSS 3.4 (+ PostCSS, Autoprefixer); ChaiUI tokens as CSS variables in `src/index.css` |
| Backend | Node.js (>= 18) built-in `http` module, no framework: `server/coach-server.mjs` |
| Backend AI | Anthropic SDK (`@anthropic-ai/sdk` 0.133), model `claude-opus-5-5`, server-side refusal fallback enabled |
| Database (now) | **IndexedDB** in the browser via `idb` 8 (NoSQL object stores, one per record type) |
| Database (planned) | **Supabase Postgres** (SQL) for the shared community, with row-level security. Files: `supabase/schema.sql`, `supabase/storage.sql` |
| Authentication | **None today** (single-user, on-device). Planned: Supabase Auth (JWT sessions; email + OAuth providers such as Google). `auth.uid()` drives all row-level policies |
| State management | React Context API (`AppContext`, `ThemeProvider`, `ToastProvider`, `ConfirmProvider`, `LogProvider`); all records loaded into memory from IndexedDB |
| API style | REST (JSON): `GET /api/health`, `POST /api/coach`. Supabase would add its auto-generated REST (PostgREST) API |
| Architecture pattern | Local-first client monolith, feature-module folders; pure logic in `src/lib` (unit-tested); thin optional server for secrets |
| Build tools | npm, Vite 5, `tsc --noEmit` typecheck, vite-plugin-pwa (Workbox service worker), Vitest 2 |
| Deployment target | Any static host for the PWA (Vercel, Netlify, Cloudflare Pages, GitHub Pages). For the AI coach, any Node host or VPS running `npm start` (serves app + API on one port). Supabase cloud for the community later |

---

## 3. Features and functionality

Status key: **Done** = built and tested. **Partial** = works but with a stated gap. **Not built** = still to do.

### 3.1 Onboarding wizard: Must-have, Done
- **What:** 7-step wizard: Welcome, Basics, Goals, Training background, Nutrition, Lifestyle, Devices, Confirm. Progress bar.
- **Flow:** Start onboarding, then fill or confirm each step (optional fields are labelled), Continue / Back, then review the summary, then "Create my dashboard", which saves the profile and settings and generates the 15-week plan.
- **Rules:** Previously reported values (age 23, 5 ft 11 in, ~69 kg, vegetarian, 30 to 40 km/week, ~6.5 h sleep, ~6,000 steps, ~3 L water, race and start dates) are **drafts to confirm**, never assumed current. No birth date, body fat or PB is invented. Supplements (creatine, mass gainer, BCAA, pre-workout) start unselected; the athlete ticks what they still take.
- **Gap (Partial):** the profile has fields with no input yet: profile photo upload, working weights for main lifts, gym equipment, preferred training days, cooking access, budget, stress level, recovery days.

### 3.2 Home dashboard (command centre): Must-have, Done
- **What:** Answers "what do I do today, how am I recovering, am I eating and sleeping enough, how am I progressing, what next".
- **Shows:** greeting + plan week/phase, status (On track / Needs attention / Recovery recommended / Missing data) with the reason, days to race, today's plan card with Log buttons, what's been logged today, steps / water rings, sleep, weight, calories, protein, top-3 priorities, quick-log grid.
- **Rules:** status is rule-based from logged data only; with no data the status is "Missing data", not a made-up score. Starting from a plan pre-fills targets but nothing counts as done until the athlete saves a log.

### 3.3 Quick logging (one or two taps): Must-have, Done
- **What:** The floating + button (and Home grid) opens a sheet for: run, gym sets, HYROX, meal, water, weight/body, sleep, steps, recovery.
- **Flow:** tap +, pick the activity, fill the form (defaults to today and remembered preferences), Save.
- **Rules:**
  - Pace = time / distance (5 km in 30:00 = 6:00 /km).
  - Sleep is dated by the morning you woke up and handles crossing midnight.
  - Validation: run distance under 200 km, weight 30 to 250 kg, steps 0 to 150,000, water 1 to 5,000 ml.
  - **Duplicate detection** asks before saving a likely double (same-day run within ±0.05 km and ±5 s; same meal name in the same slot; same strength title the same day; a second sleep record for a night).
  - Steps and recovery are one record per day; a second save updates it.
  - Every entry can be **edited** later (id and creation time preserved).

### 3.4 Training planner and calendar: Must-have, Done
- **What:** Full calendar from 12 Oct 2026 to 24 Jan 2027 (15 weeks, 105 days), week and month views.
- **Weekly split:**

  | Day | Sessions |
  |---|---|
  | Mon | Legs + abs + easy run |
  | Tue | Tempo + chest + triceps |
  | Wed | Long run + back + biceps |
  | Thu | Tempo or intervals (alternating) + delts |
  | Fri | Easy run + abs + HYROX conditioning |
  | Sat | Chest + triceps accessory + easy run |
  | Sun | Easy aerobic run, or a mini simulation in the Specific phase |

- **Periodisation:** Base weeks 1 to 5, Build 6 to 10, Specific 11 to 13, Taper / Race 14 to 15.
  - Deload weeks: 4, 8, 14 and 15.
  - Weekly km targets: 32, 35, 38, 27, 40, 42, 45, 32, 46, 48, 44, 46, 40, 30, 18.
  - The last day is race-day mode.
- **Flow:** Training tab, then browse weeks or months, then tap a day to see warm-up, runs (distance + RPE), exercises (sets × reps, RPE, rest, cues), HYROX stations and cool-down. From there: Log run / Log sets / Log HYROX, Edit prescription, Move (reschedule), Remove.
- **Rules:**
  - Effort-based guidance: easy and long runs at RPE 3 to 4, tempo 6 to 7, HYROX 6 to 7.
  - No kilogram loads are prescribed.
  - The sum of daily planned runs is checked against the weekly target and flagged if it's off by more than 2 km; extra runs are never invented.
  - Moving to a day that already has a session asks first.
  - "Rebuild plan" keeps days the athlete edited, and never touches logged workouts.
  - Missed = a past planned day with no log.

### 3.5 Strength tracker: Must-have, Done
- **What:** Log exercises with sets (reps, kg, RPE). The form shows the previous best for each exercise. History shows sessions, volume (kg × reps), and PRs (heaviest set, tie broken by reps).
- **Gap:** RIR and rest periods exist in the data model but aren't in the form.

### 3.6 HYROX station tracker: Must-have, Partial
- **What:** All 8 stations with Men Open defaults, each flagged "confirm for your event":

  | Station | Target | Default load |
  |---|---|---|
  | SkiErg | 1000 m | |
  | Sled push | 50 m | 152 kg |
  | Sled pull | 50 m | 103 kg |
  | Burpee broad jumps | 80 m | |
  | Row | 1000 m | |
  | Farmer's carry | 200 m | 2×24 kg |
  | Sandbag lunges | 100 m | 20 kg |
  | Wall balls | 100 reps | 6 kg |

  Modes: stations, combo, simulation, race. Each station records time, load, breaks, distance or reps, RPE and a note. Best time per station is shown with its distance, load and date, so like is compared with like.
- **Gap:** run segments between stations and transition times are in the data model but have no form yet, so "running before and after stations" analytics isn't built.

### 3.7 Running analytics: Must-have, Done
- Weekly and monthly km, easy and tempo pace trends, longest run, run count, best ~5 km effort. Charts say "Not enough data yet" rather than showing fake points.

### 3.8 Nutrition tracker: Must-have, Done
- **What:** Day-by-day food log (breakfast, lunch, dinner, snack) with calories, protein, carbs, fat and fibre, plus remaining-to-target. Search covers saved meals and a built-in list of 18 vegetarian-friendly foods; custom foods can also be added. Entries can be backdated, edited and deleted. Saved favourite meals log in one tap.
- **Targets:** estimated only when weight, height and age exist (Mifflin–St Jeor, activity factor, protein 1.8 g/kg, fat 0.9 g/kg, carbs fill the rest). Fat-loss deficit is capped at a mild 12%. All targets can be edited.
- **"Ask My Nutrition Coach":** answers from the actual food log; asks for data when there is none.
- **Rules:** blank values stay blank (never guessed). Supplements are tracked separately with no dosing advice.
- **Gap:** no recipes or ingredients, no external food database, no electrolyte field.

### 3.9 Hydration: Must-have, Done
- One-tap +serving / +500 / +750 / +1000 ml (serving size configurable), custom amounts, undo, daily ring and 7-day chart.

### 3.10 Sleep and recovery: Must-have, Done
- **Sleep:** bedtime, wake time, duration (handles midnight), quality 1 to 5, optional resting HR and HRV, 7-day average, history, edit and delete.
- **Recovery:** fatigue, soreness, motivation and stress (1 to 5), plus a pain note. 14-day trends.
- **Rules:**
  - Rule-based guidance: fatigue or soreness at 4 or more, or last sleep under 6 h, suggests easing off.
  - No diagnosis and no "train through pain".
  - Sleep stages and HRV are never inferred.

### 3.11 Steps and movement: Must-have, Partial
- Manual daily steps, distance and active minutes against a goal, a 7-day chart, and the source label on every record.
- **Gap:** no automatic phone or device sync (needs native integrations), no sedentary periods.

### 3.12 Body metrics and progress photos: Must-have, Done
- Weight, waist, chest, arm and thigh, plus body fat % only if measured. Weekly-average weight trend and goal distance.
- Private progress photos (downscaled, stored only on the device) in a gallery.
- **Rule:** weight changes are never labelled as fat or muscle.

### 3.13 My Athlete Coach: Must-have, Done
- **Rule-based mode (default, offline):** answers ~13 intents (workout today and yesterday, km this week, protein today, last squat, sleep this week, on track for HYROX, pace trend, recovery, priorities, 7-day summary, month comparison, what to eat, next week). Each answer is tagged fact / calculation / estimate / suggestion / missing.
- **AI mode (opt-in, consent dialog):** the app sends the question plus a 4-week summarised snapshot (no photos) to `POST /api/coach`; the server calls the Anthropic API. If the server or key is missing, the app falls back to the rule-based answer and says so.
- **On-demand weekly report:**
  - planned vs completed sessions;
  - planned vs actual km;
  - strength count;
  - nutrition days logged;
  - average sleep and steps;
  - recovery concerns;
  - improvements and setbacks;
  - three priorities.
- **Rules:** never fabricate; cite dates; correlation is not causation; never edit the plan silently (it recommends, the athlete applies).

### 3.14 Community feed: Must-have (local) Done; multi-user Not built
- **Now:**
  - Create, edit and delete posts: title, type, caption, distance, route text, photo.
  - Visibility: private, followers or public (new posts default to private).
  - Optionally attach a recent run, which brings its real time and pace.
  - PR badge, kudos, comments, search, and a weekly recap post.
  - Nothing is published automatically.
- **Not built:**
  - real accounts and other users;
  - follow requests and follower lists;
  - report and block UI;
  - a feed across devices;
  - route maps from GPS;
  - shareable image cards.

  The Supabase schema supports all of these (see section 4B).

### 3.15 Progress analytics: Must-have, Done
- Tabs: Run, Lift (sessions per week, weekly volume, muscle-group split), Food (14-day calories and protein against target), Recover (sleep, fatigue), HYROX (per-station time trends once a station has 2 or more results). Weekly report card on top.

### 3.16 Reminders: Nice-to-have, Partial
- **What:** 8 reminders (workout, bedtime, water, meal, weigh-in, weekly review on Sundays, race countdown, missing workout log), each with a time, plus quiet hours (can span midnight), a test button and notification permission handling.
- **Rules:** fires once a day at or after its time; "workout" and "missing log" only fire when a planned session is unlogged.
- **Gap:** only while the app is open. Background push needs a push service.

### 3.17 Data, history and backup: Must-have, Done
- Every record has an id, event date, created and updated timestamps, source and units.
- History is sorted by event date. Backdating and several workouts on the same day are supported.
- Audit history keeps before and after for every edit and delete (Profile, Edit history).
- Export to JSON. Import with **Merge** (no duplicates; newer wins; local newer edits kept) or **Replace** (with its own warning).
- Erase-all asks for confirmation.

### 3.18 Settings and profile: Must-have, Done
- Edit profile, goals and primary goal, race and start dates, step goal, water target, nutrition targets, active supplements, water serving size, AI coach toggle and server check, reminders, theme (dark/light), integration status.

### 3.19 Device integrations: Nice-to-have, Not built
- Apple Health, Health Connect, Google Fit, Garmin, Fitbit, Strava are listed as "Not available". All need native apps or partner API access + OAuth.

---

## 4. Database schema / data model

### 4A. On-device database: IndexedDB `forge-os`, version 2 (implemented)

Key-value object stores keyed by `id` (string UUID). Every store holding dated records has an index on `eventDate`. There are no foreign keys: links are optional ids. Types live in `src/db/types.ts`.

**Common fields** (every record): `id: string (UUID, PK)`, `createdAt: ISO datetime`, `updatedAt: ISO datetime`, `source: 'manual'|'imported'|'device'|'seed'|'coach'`, `notes?: string`. Dated records add `eventDate: 'YYYY-MM-DD'` (indexed).

| Store | Key fields (types) | Notes / constraints |
|---|---|---|
| `profile` (one record) | displayName, dob?, age?, heightCm?, weightKg?, goalWeightKg?, country, timezone, units{distance,weight,pace}, photo? (data URL), goals: GoalKey[], primaryGoal, runningExperience?, weeklyVolumeKm?, best5kSec?, best10kSec?, longestRunKm?, easyPaceSecPerKm?, tempoPaceSecPerKm?, strengthRoutine?, lifts[], hyroxExperience?, raceDivision, raceDate, trainingStartDate, equipment[], preferredDays[], sessionMinutes?, injuries?, diet, allergies?, mealSchedule?, foodPreferences?, dislikedFoods?, typicalCalories?, typicalProtein?, cookingAccess?, budget?, supplements[{name,serving?,timing?,active}], avgSleepHours?, bedtime?, wakeTime?, workSchedule?, activityLevel?, stepGoal (default 8000), typicalSteps?, waterTargetMl (default 3000), typicalWaterMl?, stressLevel?, recoveryDays?, calorieTarget?, proteinTarget?, carbTarget?, fatTarget?, onboarded: bool, historicalSource? | Import keeps only the newest |
| `settings` (one record) | reminders[{key,label,time?,enabled}], quietHours?{start,end}, integrations[{key,label,provides,connected,implemented}], waterServingMl (default 250), theme, savedMeals[{id,name,meal,servingSize?,calories?,protein?,carbs?,fat?,fiber?}]?, aiCoachEnabled? | |
| `plannedWorkouts` | eventDate, phase, weekIndex (1-based), title, types[SessionType], focus, warmup?, cooldown?, runs[{kind,distanceKm?,durationMin?,targetRPE?,description?}], exercises[{name,group,sets,reps,targetWeightKg?,targetRPE?,restSec?,instructions?}], hyroxStations[{station,target,loadKg?,notes?}], deload, description? | `source: 'seed'` = generated, `'manual'` = edited by athlete (kept on rebuild) |
| `runs` | eventDate, kind (easy/tempo/long/interval/race/other), distanceKm (> 0), durationSec (> 0), avgPaceSecPerKm?, rpe?, elevationM?, route?, linkedPlanId? | Plan ↔ run: optional link, one plan to many logs |
| `strength` | eventDate, title, exercises[{name,group,sets[{reps?,weightKg?,rpe?,rir?,completed}]}], durationMin?, rpe?, linkedPlanId? | |
| `hyrox` | eventDate, title, mode (station/combo/simulation/race), stations[{station,distanceM?,reps?,loadKg?,timeSec?,breaks?,rpe?,notes?}], runSegments?[{label,distanceM,timeSec}], totalTimeSec?, rpe?, linkedPlanId? | runSegments has no UI yet |
| `nutrition` | eventDate, meal (breakfast/lunch/dinner/snack/supplement), name, time?, servingSize?, calories?, protein?, carbs?, fat?, fiber?, isSupplement? | Blank stays undefined (never 0) |
| `water` | eventDate, amountMl (1 to 5000) | |
| `sleep` | eventDate (wake day), bedtime (ISO), wakeTime (ISO), durationMin, quality? (1 to 5), restingHr?, hrv? | |
| `steps` | eventDate, steps (0 to 150,000), distanceKm?, activeMinutes?, dedupeKey? (`manual:<date>`), syncedAt? | One manual record per day |
| `body` | eventDate, weightKg?, heightCm?, waistCm?, hipsCm?, chestCm?, armCm?, thighCm?, bodyFatPct? (measured only), photo? (private) | |
| `recovery` | eventDate, fatigue?, soreness?, motivation?, stress? (1 to 5), pain? | One per day |
| `social` | eventDate, author, title, activityType, caption?, distanceKm?, durationSec?, paceSecPerKm?, elevationM?, stationDetail?, photo?, visibility (private/followers/public), kudos, kudosedByMe, comments[{id,author,text,createdAt}], pr?, routeText? | Local single-user |
| `audit` (no date index) | id, at (ISO), store, recordId, action (update/delete), eventDate?, summary, before?, after? (photos stripped) | Written on every edit/delete of training, food, sleep, steps, body, recovery, plan |

### 4B. Community backend: Supabase Postgres (designed and tested, **not wired to the app**)

File `supabase/schema.sql` (+ `storage.sql`). Health data is deliberately **not** stored here.

| Table | Fields | Relationships / constraints / indexes |
|---|---|---|
| `profiles` | id uuid PK → auth.users(id) on delete cascade; display_name text not null (1 to 60 chars); bio text (≤ 300); goals text[] default '{}'; avatar_path text; created_at, updated_at timestamptz default now() | One-to-one with auth user |
| `follows` | follower_id uuid, followee_id uuid (both → profiles, cascade); status text default 'pending' check in (pending, accepted); created_at | PK (follower_id, followee_id); check follower ≠ followee. Many-to-many profiles ↔ profiles |
| `blocks` | blocker_id, blocked_id (→ profiles); created_at | PK (blocker_id, blocked_id); check not self |
| `posts` | id uuid PK default gen_random_uuid(); author_id → profiles; event_date date not null; title (1 to 120); activity_type (≤ 40); caption (≤ 2000); distance_km numeric(6,2) 0 to 1000; duration_sec int 0 to 172800; pace_sec_per_km int > 0; elevation_m int; station_detail (≤ 2000); route_text (≤ 200); photo_path; is_pr bool default false; visibility enum (private/followers/public) default 'private'; created_at, updated_at | One-to-many profile → posts. Indexes: (author_id, event_date desc); partial (event_date desc) where public |
| `comments` | id uuid PK; post_id → posts cascade; author_id → profiles; body (1 to 1000); created_at | Index (post_id, created_at) |
| `kudos` | post_id → posts; user_id → profiles; created_at | PK (post_id, user_id): one per user per post |
| `reports` | id uuid PK; reporter_id → profiles; post_id? / comment_id? / user_id? (set null); reason (1 to 500); created_at | Check at least one target |
| storage bucket `post-photos` | private; path `<author uuid>/<post uuid>/<file>` | |

**Privacy (row-level security):**
- private = the author only;
- followers = the author plus **accepted** followers;
- public = any signed-in user;
- a block in either direction hides profiles, posts, comments and kudos;
- anonymous visitors get nothing;
- reports are write-only;
- users can only write their own rows, and a trigger stops edits to `author_id` / `created_at`.

Helper functions: `is_blocked_between`, `can_view_post`, `can_view_post_id` (SECURITY DEFINER, pinned search_path). The privacy tests (13 scenarios) pass on Postgres 16 (`bash supabase/tests/run.sh`).

---

## 5. API endpoints

### Implemented: `server/coach-server.mjs` (default `http://127.0.0.1:8787`)

| Method | Path | Request | Response (example) | Auth |
|---|---|---|---|---|
| GET | `/api/health` | none | `200 {"ok":true,"model":"claude-opus-5-5","keyPresent":false}` | No (server binds to localhost by default) |
| POST | `/api/coach` | JSON `{ "question": string ≤ 2000 chars, "context": object ≤ 120,000 chars serialized, "history"?: [{ "role": "user"\|"assistant", "text": string ≤ 8000 }] (≤ 10) }`, body ≤ 200 KB | `200 {"answer":"This week (12 Oct–18 Oct) you've run 12.5 km…","model":"claude-opus-5-5","truncated":false}`. Refusal: `200 {"answer":"I can't help with that one…","refused":true}`. Errors: `400 {"error":"`question` is required."}`, `405`, `413 {"error":"Request too large."}`, `429`, `502`, `503 {"error":"Coach server is not configured. Set ANTHROPIC_API_KEY and restart."}` | Optional `Authorization: Bearer <COACH_ACCESS_TOKEN>`; `401` when the server sets a token and it is missing or wrong. CORS only for origins in `ALLOWED_ORIGINS`; `OPTIONS` preflight returns `204`. The Anthropic key is server-side only |
| GET | `/*` | none | Built app from `dist/` with SPA fallback to `index.html`; `/assets/*` cached for a year | No |

Notes: there are no role-based permissions (single user). Path traversal outside `dist/` is blocked. The server sends the summarised context as data inside the user message, with a system prompt that enforces the coaching rules.

### Planned (Supabase, once wired)
Supabase auto-generates REST endpoints per table (`/rest/v1/posts`, `/rest/v1/follows`, …) and Storage endpoints. Authentication would be a Supabase JWT, and authorisation comes from the row-level policies above. A suggested set of app-level operations:
- create, update and delete a post;
- list a feed (own posts plus posts the user may see);
- request, accept and remove a follow;
- block and unblock;
- add and delete a comment;
- give and remove kudos;
- report;
- upload a photo.

---

## 6. UI/UX details

**Screens:** 12 routed screens plus onboarding (8 steps), and about 12 sheets or dialogs.

| Screen | Route | Main components |
|---|---|---|
| Onboarding | shown at `/` until onboarded | Logo + theme switch; hero (animated badge, headline, lead with highlight, Start + "How your data is used"); progress bar; step forms (fields, chips, segmented controls); confirm summary; sticky Back / Continue |
| Home | `/` | Header; centred greeting + lead; status card with days-to-race; today's plan card (log buttons); logged-today card; steps/water rings; sleep, weight, calories, protein tiles; links to recovery, sleep and body; today's focus list; quick-log grid |
| Training | `/training` | Tabs (Plan, Strength, HYROX, Runs); Week/Month toggle; week nav; planned/target/actual km card; day list with status chips; month grid with legend; day sheet (prescription, Log, Edit, Move, Remove); history lists with Edit/Delete; PRs; best station times |
| Nutrition | `/nutrition` | Day nav; target ring + macro bars or "set targets" card; Ask My Nutrition Coach; meals by slot with Edit/Delete; saved-meal chips; hydration bar; supplement chips |
| Community | `/community` | Profile card; search; local-first note; feed of post cards (visibility, PR, stats, kudos, comments, options menu); New post / Weekly recap; composer sheet |
| Profile | `/profile` | Identity card; race and plan (Rebuild); nutrition targets; supplements; reminders + quiet hours + test; AI coach toggle + server check; integrations; edit history; data and backup (Export, Import, Erase); setup notes; edit-profile and targets sheets; import sheet |
| My Athlete Coach | `/coach` | Mode line + Use AI toggle; chat messages with tags; weekly report button; suggestions; input + Send |
| Progress | `/analytics` | Weekly report card; tabs Run / Lift / Food / Recover / HYROX with charts and stat tiles |
| Sleep | `/sleep` | 7-day average and last-night tiles; 7-day bar chart (7 h target line); history with Edit/Delete |
| Steps and movement | `/steps` | Ring; 7-day average and active minutes; chart; manual-source note; history with source labels |
| Body and progress | `/body` | Current, weekly average, goal and height tiles; weekly-average weight line; private photo gallery; measurement history with Edit/Delete |
| Recovery | `/recovery` | Today's guidance; 4 seven-day average tiles; fatigue and soreness 14-day lines; history |
| Hydration | `/hydration` | Ring + quick add buttons; 7-day chart; today's entries with Undo |

**Global:**
- sticky transparent header (blurs on scroll) with logo, theme switch and Coach;
- bottom tab bar (Home, Training, Nutrition, Community, Profile);
- floating + quick-log menu (hidden on Coach);
- bottom sheets for forms;
- ChaiUI confirm dialogs;
- toasts.

**Design (ChaiUI, from `design/chaiui`):**
- **Theme:** dark by default (#0a0a0a background, near-white text, neutral greys), with a light mode behind a half-circle switch.
- **Fonts:** Manrope for everything, Montserrat for numbers, titles and the highlight phrase, Onest for the wordmark.
- **Accent:** a pale-cream highlight phrase, one per paragraph.
- **Orange:** only in the logo, link hover and the badge glint. Never a fill.
- **Cards:** warm hairline borders, no shadows.
- **Buttons:**
  - one solid white button per screen, with asymmetric corners;
  - outline buttons with the mirrored corners;
  - soft buttons on cards.
- **Status:** shown as text plus a thin outline, never a filled pill.
- **Progress and charts:** neutral.
- **Copy:** no em dashes, sentence case, no all-caps except data labels.
- **Icons:** lucide.

**Responsive:** designed for phones (390 px tested, no sideways scroll), centred `max-w-md` column on larger screens. Respects safe areas, `prefers-reduced-motion`, keyboard focus and ARIA labels on icon buttons.

**Design files:** no Figma. Reference: the ChaiUI skill (https://ui.chaicode.com) and the screenshots shared in the build chat.

---

## 7. Folder / project structure

```
FORGE-OS/
├── design/                     ChaiUI design system guides (chaiui, chaiui-review)
├── docs/PROJECT_BRIEF.md        this document
├── public/                      favicon.svg, icon-192.png, icon-512.png, apple-touch-icon.png
├── server/coach-server.mjs      Node API (coach) + static server for dist/
├── supabase/
│   ├── schema.sql               community tables + row-level security
│   ├── storage.sql              private photo bucket policies
│   └── tests/                   run.sh, supabase_shim.sql, rls_test.sql (13 privacy tests)
├── src/
│   ├── main.tsx, App.tsx        entry, providers, lazy routes
│   ├── index.css                ChaiUI tokens + component classes
│   ├── db/                      types.ts (data model), database.ts (IndexedDB CRUD, export/import)
│   ├── lib/                     pure logic: dates, calc, plan, coach, coachContext, dedupe, audit, reminders, constants
│   ├── store/                   AppContext (data + persistence), theme, toast, confirm
│   ├── components/              ui.tsx (kit), Layout.tsx (header, nav, +), charts.tsx, icons.ts, ReminderRunner.tsx
│   ├── features/<area>/         onboarding, dashboard, training, nutrition, community, profile,
│   │                            coach, analytics, health (sleep, steps, body, recovery, hydration), logging (forms, QuickLog)
│   └── __tests__/               Vitest unit tests (39)
├── index.html, vite.config.ts, tailwind.config.js, postcss.config.js, tsconfig.json
├── package.json, package-lock.json, skills-lock.json, README.md
```

**Naming conventions:**
- React components and their files: PascalCase (`Dashboard.tsx`). Lib modules: camelCase (`coachContext.ts`).
- Hooks are `useX`; record types are `XRecord` / `XEntry`.
- Store names are camelCase plurals. Dates are `YYYY-MM-DD` strings; timestamps are ISO UTC.
- SQL is snake_case.

**Module organisation:**
- By feature, under `src/features/<area>`.
- Shared UI is in `components`; pure, testable logic in `lib`; persistence in `db`; cross-cutting state in `store`.
- Features don't import each other, except the shared logging forms and `downscaleImage`.

---

## 8. Third-party integrations

| Integration | Status |
|---|---|
| Payment gateway | None (not needed) |
| Email service | None |
| Cloud storage | None today. Planned: Supabase Storage (private `post-photos` bucket) |
| AI | **Anthropic API** via `@anthropic-ai/sdk`, server-side, opt-in |
| Backend-as-a-service | **Supabase** (Postgres, Auth, Storage): schema ready, not connected |
| Health/fitness APIs | Apple Health, Health Connect, Google Fit, Garmin, Fitbit, Strava: **not implemented** (need native app or partner API + OAuth) |
| Fonts | Google Fonts (Manrope, Montserrat, Onest) loaded from fonts.googleapis.com |
| Analytics | None (privacy-first). Can be added |
| Food database | Built-in list of 18 items only. No external API (e.g. USDA FoodData Central, Open Food Facts) yet |
| Push notifications | None (would need Web Push + a push service / VAPID keys) |

---

## 9. Environment and configuration

**Environment variables (server only; never in the frontend):**

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | For AI coach | Anthropic API key. Alternatives the SDK also reads: `ANTHROPIC_AUTH_TOKEN`, or an `ant auth login` profile (`ANTHROPIC_PROFILE`) |
| `COACH_MODEL` | No | Model id. Default `claude-opus-5-5` |
| `COACH_EFFORT` | No | `low` / `medium` / `high` / `xhigh` / `max`. Default `medium` |
| `PORT` | No | Server port. Default `8787` |
| `HOST` | No | Bind address. Default `127.0.0.1` (localhost only), or `0.0.0.0` when `RENDER` is set (Render sets it automatically); set `0.0.0.0` to expose on the network |
| `ALLOWED_ORIGINS` | When app and server are on different domains | Comma-separated origins allowed by CORS, e.g. `https://your-app.vercel.app`. Unset means same-origin only (no CORS headers) |
| `COACH_ACCESS_TOKEN` | Strongly recommended on a public server | Shared secret the app must send as `Authorization: Bearer …` to `/api/coach`. CORS alone doesn't stop scripts or curl from spending your API credit |
| `VITE_COACH_URL` | Build-time, frontend | Coach server base URL baked into the app (e.g. `https://forge-coach.onrender.com`). Can be overridden per device in Profile → AI coach. Not secret |
| `PGTEST_PORT` | No | Port for the throwaway Postgres in the RLS tests. Default `54329` |
| *(future)* `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | When wiring Supabase | Public project URL and anon key (safe in frontend; privacy is enforced by RLS) |

**Configuration files:**
- `vite.config.ts`: PWA manifest, service worker (Workbox; `/api` excluded), `/api` proxy to 8787 in dev and preview, chunk splitting.
- `tailwind.config.js`: ChaiUI colour tokens, fonts, radii, dark mode via the `dark` class.
- `postcss.config.js`, `tsconfig.json` (strict), `index.html` (fonts, theme script).
- `skills-lock.json`: ChaiUI skill versions.

**Development vs production:**
- **Development:** `npm run dev` (Vite hot reload on :5173) plus `npm run server` in a second terminal for the AI coach (proxied).
- **Production:** `npm start`, which runs typecheck + build and then serves `dist/` + `/api` from one Node process on :8787. Or deploy `dist/` alone to a static host (the AI coach then needs the Node server somewhere, or falls back to rule-based).
- The service worker caches the app for offline use in production builds.

---

## 10. Dependencies and packages

**Runtime (installed versions):**
- react 18.3.1, react-dom 18.3.1
- react-router-dom 6.30.6
- idb 8.0.4 (IndexedDB wrapper)
- recharts 2.15.4 (charts)
- lucide-react 0.460.0 (icons)
- @anthropic-ai/sdk 0.133.0 (server only; not bundled into the app)

**Dev / build:**
- vite 5.4.21, @vitejs/plugin-react 4.7.0, vite-plugin-pwa 0.20.5
- typescript 5.9.3, @types/react 18.3.31, @types/react-dom 18.3.7
- tailwindcss 3.4.19, postcss 8.5.29, autoprefixer 10.6.1
- vitest 2.1.9, fake-indexeddb 6.2.5

**Backend:** Node.js 18+ built-ins (`http`, `fs`, `path`) + @anthropic-ai/sdk. **Database tooling:** Postgres 16 for the RLS tests (any recent Postgres works).

**Not yet added (likely needed later):** `@supabase/supabase-js`, a food-database client, a Web Push library.

---

## 11. Existing code / repo

- **Existing codebase:** Yes.
- **Repo:** https://github.com/Vishalbha625/FORGE-OS
- **Branch strategy:** all work so far is on `claude/vigilant-turing-wperw5` (the only branch; no `main` yet). Suggested next step: open a pull request into a new `main`, then use short-lived feature branches merged by pull request.
- **Commits so far:**
  1. Build the app.
  2. Edit history, AI coach server, reminders, Supabase schema, tests.
  3. ChaiUI skill added (by the owner).
  4. Vite bump + skills lock.
  5. ChaiUI restyle.
- **Current state:** a **working, tested single-user app** (~8,400 lines across `src`, `server` and `supabase`). Core athlete platform complete; community is local-only; device integrations and background push not started. Run with `npm install && npm start`, then open http://localhost:8787.

---

## 12. Implementation constraints and requirements

**Timeline:**
- Training starts **12 Oct 2026**, so the core app had to be usable by then, which it is.
- Race is **24 Jan 2027**.
- No other deadline was given.

**Coding standards:**
- TypeScript `strict` with no unused locals or parameters.
- Pure logic goes in `src/lib` with unit tests.
- Match the existing style: function components and Tailwind classes.
- UI copy must follow the ChaiUI rules: no em dashes, sentence case, one highlight per paragraph, one solid button per screen, no orange fills, no shadows.
- Run the `chaiui-review` checks before shipping UI.

**Data rules (non-negotiable, from the original brief):**
- Never fabricate workouts, meals, sleep, steps, measurements, PBs or body fat.
- Missing ≠ zero.
- Planned and actual stay separate.
- Plan changes never overwrite history.
- Sort by event date.
- Every edit and delete goes through confirmation and the audit log.
- Show times in Asia/Kolkata.
- Label the source of every record.

**Performance:**
- First load ~90 KB gzipped (routes code-split; charts load separately).
- Works offline.
- Every interaction is instant, because data is local.

**Security:**
- API keys only on the server.
- The server binds to localhost by default and enforces body limits and input validation, with no path traversal.
- The AI coach is opt-in with a consent dialog and sends no photos.
- Progress photos never leave the device.
- Community privacy is enforced in the database (RLS), not the client.
- No health data in the shared backend.

**Testing:**
- Unit (Vitest, 39 tests): calculations, dates and IST, plan coverage and weekly targets, coach honesty, AI context excludes photos, duplicates, audit, reminders, backup merge.
- Database privacy (13 RLS scenarios on Postgres).
- End-to-end browser checks (34, Playwright; script kept outside the repo so far).
- `npm run build` must typecheck clean.

**Browser and device support:**
- Modern Chrome / Edge / Safari / Firefox, plus iOS Safari and Android Chrome (PWA install).
- Needs IndexedDB, CSS `oklch()` and `backdrop-filter` (browsers from roughly 2023 onwards).

---

## 13. Known challenges and edge cases

**Handled already:**
- Sleep crossing midnight (dated by wake day).
- Backdated entries and several workouts on the same day.
- Duplicates (asks first).
- Steps double-counting (one manual record per day).
- Blank vs zero nutrition.
- Rebuilding the plan without losing manual edits or logs.
- Moving a session onto a busy day.
- Merge-importing a backup from another device (keeps one profile).
- An oversized or invalid coach request.
- The coach server down or with no key (falls back, with a note).
- Model refusal (polite answer, plus a server-side fallback model).
- Quiet hours spanning midnight.
- Today before the plan start (the calendar opens on week 1).

**Still tricky or open:**
1. **Timezone consistency:** most dates use the profile timezone (default Asia/Kolkata), but a few screens (Nutrition day picker, some time labels) still use the fixed IST helper. That's fine for this athlete; it needs unifying if anyone travels or other users join.
2. **Units:** the profile stores km/mi and kg/lb choices, but the app only displays km and kg.
3. **Device sync:** needs a native wrapper (Capacitor or React Native) for Apple Health / Health Connect, and partner API approval for Garmin, Fitbit and Strava (Strava's terms limit how data can be shown and shared).
4. **Multi-user community:** wiring Supabase means:
   - adding authentication;
   - migrating local posts;
   - adding follow-request UI, report and block UI, and image upload to Storage;
   - deciding whether the local feed and the cloud feed coexist.
5. **Background reminders:** need Web Push (service worker + VAPID + a push server); iOS only allows it for installed PWAs.
6. **IndexedDB durability:** browsers can evict storage, and clearing site data wipes everything. Regular exports (or cloud backup) are the safety net, and `navigator.storage.persist()` should be requested.
7. **Photos as data URLs** in IndexedDB grow the database and backup file; they're downscaled, but a long-term store would be better.
8. **HYROX standards** vary by event and season; loads and distances are defaults to confirm.
9. **AI coach cost and privacy:** each AI question sends a 4-week summary to Anthropic. It's opt-in, but per-question cost and data sharing should be explained if other users get it.
10. **The original requirement list includes items not yet built** (see the gaps in section 3): onboarding inputs for photo, lifts, equipment, days, cooking, budget, stress and recovery days; recipes; electrolytes; HYROX run segments and transitions; sedentary periods; scheduled weekly-report delivery; route maps; shareable image cards; report/block; follower lists.

---

--- IMPLEMENTATION PRIORITY ORDER ---

**Already done** (foundation through advanced single-user):
1. Data model + IndexedDB persistence + export/import
2. Onboarding + profile
3. 15-week plan generator + calendar
4. One-tap logging (all 9 types) with edit, duplicates, audit
5. Dashboard
6. Health pages (sleep, steps, body, recovery, hydration)
7. Nutrition + targets + nutrition coach
8. Strength + HYROX trackers
9. Analytics + weekly report
10. Rule-based coach + optional AI coach server
11. Local community feed
12. Reminders (foreground)
13. ChaiUI design
14. Supabase schema + RLS tests

**Suggested next, in order:**
1. **Housekeeping:** open a pull request into a new `main`; add GitHub Actions CI (typecheck, unit tests, RLS tests); move the end-to-end browser tests into the repo; request persistent storage.
2. **Close the small single-user gaps:**
   - unify the timezone helpers;
   - add the missing onboarding inputs;
   - add RIR and rest to the strength form;
   - add HYROX run segments and transitions (and their analytics);
   - add an electrolytes field.
3. **Deploy:** the PWA to a static host, and the coach server to a small Node host (or a serverless function) with HTTPS.
4. **Supabase Phase 1:** authentication (email + Google), profiles, and cloud backup and sync of the athlete's own data (keep health data private to the owner with owner-only RLS, or keep it local; see question 3).
5. **Supabase Phase 2, the community:** posts with photo upload, follow requests, feed, comments, kudos, block, report, and shareable image cards.
6. **Web Push** for background reminders and the scheduled weekly report.
7. **Native wrapper** (Capacitor) for Apple Health / Health Connect steps and sleep; then Strava, Garmin and Fitbit via OAuth.
8. **Food database** integration, and recipes with ingredients.
9. **Nice-to-haves:** unit switching (mi/lb), GPS route maps, more coach intents, analytics.

---

--- QUESTIONS FOR IMPLEMENTATION HELPER ---

1. **Branching:** should `claude/vigilant-turing-wperw5` become `main`, or be merged into a new `main` via a pull request?
2. **Hosting:** where should the app and the coach server live (Vercel / Netlify + Render / Railway / a VPS)? A custom domain?
3. **Health data in the cloud:** keep all health data on-device only (current design), or add an encrypted / owner-only cloud backup in Supabase? This decides the privacy model.
4. **Community scope:** friends-only (invite / approve follows) or open public profiles? Is a moderator needed for reports?
5. **Auth providers:** email + password, magic link, Google, Apple, GitHub?
6. **AI coach:** keep it opt-in per device? Spending cap per month? Is `claude-opus-5-5` at `medium` effort the right cost/quality trade-off, or should a cheaper model be tested?
7. **Device integrations:** which matters first (Apple Health vs Health Connect vs Strava vs Garmin)? Is a native wrapper (Capacitor) acceptable?
8. **Food data:** use an external database (which: USDA, Open Food Facts, an Indian food database?) or keep manual entry plus saved meals?
9. **Units:** does anyone need miles or pounds, or is metric-only fine?
10. **Remaining onboarding fields:** which still matter (lift weights, equipment, preferred days, cooking access, budget, stress, recovery days, profile photo)?
11. **Background reminders:** worth the Web Push setup now, or are foreground reminders enough until the native app exists?
12. **ChaiUI background:** the ChaiUI hexagon background image isn't in the skill. Provide the SVG, or keep the plain background?
13. **Multi-athlete future:** is Forge OS only ever for one athlete, or should it support coaches managing several athletes later? This affects the data model.
