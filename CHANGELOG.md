# Changelog

All notable changes to Forge OS. Dates are when the change reached `main`.

## 1.1.0 (2026-10-16)

Push notifications, a notification centre and Strava import. Every change is additive: existing data,
settings and the offline app work as before, and the server still starts with no new settings.

### Added

- **Push notifications** (Web Push with VAPID, no third-party push SDK).
  - Profile → Notifications: enable on this device, switch each of 8 categories on or off, disable all.
  - Reminder pushes (workout, missing log, meals, water, bedtime, weigh-in, weekly review, race
    countdown) are scheduled from the device's own plan and reminder times.
  - Social pushes for kudos, comments, follow requests and accepted follows.
  - The server writes every message and sends a social push only after the database confirms the event
    happened. Blocked members and muted categories get nothing. A push never contains health data.
  - A gentle in-app prompt (never on first load, hidden for 7 days when dismissed), a subscription
    check once per session, and tap-to-open on the right screen.
  - `supabase/push.sql`: `push_subscriptions`, owner-only.
- **Notification centre** at `/notifications`, with an unread count on the bell in the top bar.
  - Kudos, comments, follow requests and accepted follows from the last 90 days, newest first, with
    pull to refresh, mark all read and load more. Tapping an item opens the post or profile.
  - The count refreshes every 60 seconds and when the app comes back to the front (no Realtime).
  - `supabase/notifications.sql`: recipients read their own, can change only the read flag, and an
    insert is accepted only when the event really happened, the sender is the actor, neither side has
    blocked the other, and the same notification wasn't sent in the last 5 minutes.
- **Strava import**: Profile → Strava → Connect, then Sync now.
  - Runs (including trail and virtual runs) go to Runs, weight training to Strength, Crossfit to hybrid
    sessions, all labelled `source: 'strava'`. Rides, walks and other types are left out.
  - Duplicates are skipped: the same Strava activity, or a session you logged by hand on the same day
    within 0.1 km and 2 minutes.
  - The coach server does all the Strava talking and keeps the tokens (`supabase/strava.sql`, readable
    by the server only). Maps, GPS and splits never leave the server; activities are stored on the
    device only. Disconnect revokes access at Strava and keeps everything already imported.
- Server endpoints: `GET /api/push/config`, `POST /api/push/{subscribe,unsubscribe,send,schedule}`,
  `GET /api/strava/{auth-url,activities}`, `POST /api/strava/{exchange,disconnect}`. All but the
  config require a community sign-in.
- New server settings: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL`, `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`,
  `APP_URL`. See [DEPLOYMENT.md](DEPLOYMENT.md).
- `DEPLOYMENT.md`, this changelog.
- Tests: RLS tests 21 to 24, unit tests for the push, notification and Strava services and server
  routes, and a notification test against a real PostgREST.

### Changed

- The coach server is split into modules (`app`, `coach`, `auth`, `http`, `push`, `strava`).
  `coach-server.mjs` is still the entry point, and `/api/coach` behaves as before.
- `web-push` is a server-only dependency in `server/package.json`; Render installs it with
  `npm ci --omit=dev --prefix server`. No frontend dependency changed.
- The service worker loads `push-handlers.js` for push and notification clicks.
- `/api/health` also reports `push` and `strava`.

### Known limits

- Scheduled reminder pushes live in the server's memory: on Render's free plan they don't fire while
  the instance sleeps and are forgotten on restart until the app is opened again.
- New Strava applications connect only their owner (Single Player Mode) until Strava raises the limit.
- Strava sync is manual.

## 1.0.0 (2026-10-16)

The community release, built in eight phases on top of the personal app.

- **Phase 8:** integration tests for whole user journeys, GitHub Actions CI (types, tests, build, bundle
  size, RLS on Postgres, PostgREST), accessibility fixes, a maskable icon and security headers.
- **Phase 7:** analytics charts, reminder scheduling, polish.
- **Phase 6:** coach integration with the community, unblock, the feed header name.
- **Phase 5:** profiles, follows and follow requests, search, block and report.
- **Phase 4:** the community feed.
- **Phase 3:** the community service layer, with offline queueing and retries.
- **Phase 2:** community sign-in with Supabase Auth.
- **Phase 1:** the community foundation (Supabase schema and row-level security).

## 0.1.0 (2026-10-10)

The personal app: onboarding, the 15-week plan, logging with edit history, nutrition, health tracking,
the rule-based coach and an optional AI coach server, backups, installable offline PWA, ChaiUI design,
Vercel and Render configuration.
