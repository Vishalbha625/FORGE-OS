// Forge OS server
// ─────────────────────────────────────────────────────────────────────────────
// 1. POST /api/coach: the AI coach (coach.mjs). The API key never reaches the browser.
// 2. GET  /api/health: reports what is configured.
// 3. /api/push/*: Web Push (push.mjs), when VAPID keys and Supabase are set.
// 4. /api/strava/*: Strava import (strava.mjs), when Strava and Supabase are set.
// 5. Serves the built app from dist/ (with SPA fallback), so `npm start` runs
//    the whole thing on one localhost port.
//
// Credentials come from the environment; nothing is hardcoded. Every feature
// beyond the coach is optional: the server starts without it and says so.
//
// Run: npm start            (build + serve on http://localhost:8787)
//      npm run server       (serve an existing build / API only)
//
// Environment (see DEPLOYMENT.md):
//   ANTHROPIC_API_KEY, COACH_MODEL, COACH_EFFORT, COACH_ACCESS_TOKEN   AI coach
//   ALLOWED_ORIGINS=https://your-app.vercel.app                         CORS allow-list, comma-separated
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY          sign-in check and server-side reads
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_EMAIL                     push notifications
//   STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, APP_URL                      Strava import

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import { createApp } from './app.mjs';
import { createCoachHandler } from './coach.mjs';
import { createTokenVerifier } from './auth.mjs';
import { createPush } from './push.mjs';

const env = process.env;
const here = path.dirname(fileURLToPath(import.meta.url));
// Localhost only unless you opt in. Render needs 0.0.0.0, so default to that there.
const HOST = env.HOST ?? (env.RENDER ? '0.0.0.0' : '127.0.0.1');
const PORT = Number(env.PORT ?? 8787);
const MODEL = env.COACH_MODEL ?? 'claude-opus-5-5';
const EFFORT = env.COACH_EFFORT ?? 'medium';

// CORS: browser origins allowed to call /api (the PWA on Vercel, for example).
// Empty = same-origin only (the default when `npm start` serves app and API together).
const ALLOWED_ORIGINS = (env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((o) => o.trim().replace(/\/$/, ''))
  .filter(Boolean);
// Optional shared secret for /api/coach. CORS only restrains browsers; when the
// server is public this stops anyone else from spending your API credit.
const ACCESS_TOKEN = env.COACH_ACCESS_TOKEN ?? '';

const keyPresent = Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_PROFILE);
let anthropic = null;
// Lazy: lets the server start even when no credentials are set.
const getClient = () => (anthropic ??= new Anthropic());

// ── Supabase: who is calling, and server-side reads ─────────────────────────
const SUPABASE_URL = (env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY ?? '';
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const serverAuth = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const verifyUser = SUPABASE_URL && SUPABASE_ANON_KEY ? createTokenVerifier({ supabaseUrl: SUPABASE_URL, apiKey: SUPABASE_ANON_KEY }) : undefined;
const admin = SUPABASE_URL && SERVICE_KEY ? createClient(SUPABASE_URL, SERVICE_KEY, serverAuth) : null;
// The caller's own token: their writes go through row-level security (R6).
const asUser = (token) => createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { ...serverAuth, global: { headers: { Authorization: `Bearer ${token}` } } });

// ── Web Push ────────────────────────────────────────────────────────────────
const VAPID_PUBLIC_KEY = env.VAPID_PUBLIC_KEY ?? '';
let push = null;
let pushProblem = '';
if (!VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) pushProblem = 'no VAPID keys';
else if (!admin || !verifyUser) pushProblem = 'needs SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY';
else {
  try {
    // Server-only dependency (server/package.json), loaded only when push is configured.
    const { default: webpush } = await import('web-push');
    const email = (env.VAPID_EMAIL ?? '').trim();
    webpush.setVapidDetails(email.startsWith('mailto:') || email.startsWith('https://') ? email : `mailto:${email || 'admin@example.com'}`, VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
    push = createPush({ admin, asUser, webpush });
    // Scheduled reminder pushes live in memory (lost on restart, and a sleeping
    // free instance doesn't tick). The app's own reminders stay the reliable path.
    setInterval(() => push.tick().catch((err) => console.error('[push] tick failed:', err?.message ?? err)), 60_000);
  } catch (err) {
    pushProblem = `web-push is not installed (run npm ci --prefix server): ${err?.message ?? err}`;
  }
}

const server = createApp({
  distDir: path.resolve(here, '..', 'dist'),
  allowedOrigins: ALLOWED_ORIGINS,
  accessToken: ACCESS_TOKEN,
  coach: createCoachHandler({ model: MODEL, effort: EFFORT, getClient }),
  verifyUser,
  push,
  pushPublicKey: VAPID_PUBLIC_KEY,
  health: () => ({ model: MODEL, keyPresent, authRequired: Boolean(ACCESS_TOKEN), push: Boolean(push) }),
});

server.listen(PORT, HOST, () => {
  console.log(`\n  Forge OS running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/`);
  console.log(`  CORS: ${ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS.join(', ') : 'same-origin only'} · access token: ${ACCESS_TOKEN ? 'required' : 'not set'}`);
  console.log(
    `  AI coach: ${keyPresent
      ? `credentials found in environment (model ${MODEL})`
      : 'no ANTHROPIC_API_KEY in environment. The app works fully; the coach falls back to rule-based answers unless an `ant auth login` profile is available.'}`,
  );
  console.log(`  Push notifications: ${push ? 'on' : `off (${pushProblem})`}\n`);
});
