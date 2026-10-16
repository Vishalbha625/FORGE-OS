import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpError } from './http.mjs';

// Strava import. The server holds the client secret and every Strava token
// (R4): the app only ever sees activity summaries, stripped of maps and GPS.
//   GET  /api/strava/auth-url     -> { url }   Strava's consent screen, with a signed state
//   POST /api/strava/exchange     { code, state, scope } -> { connected, athleteName }
//   GET  /api/strava/activities   ?after=ISO -> { activities, count }
//   POST /api/strava/disconnect   -> { disconnected }
// Tokens live in strava_connections, which only the service role can touch.

/** The only activity fields that leave the server. No map, polyline, start/end coordinates or splits (R1). */
export const ACTIVITY_FIELDS = [
  'id', 'name', 'type', 'sport_type', 'workout_type', 'distance', 'moving_time', 'elapsed_time',
  'average_speed', 'max_speed', 'average_heartrate', 'start_date', 'start_date_local', 'total_elevation_gain',
];

const SCOPE = 'activity:read';
const STATE_TTL_MS = 10 * 60_000;
const PAGE_SIZE = 50;
const MAX_PAGES = 4; // up to 200 activities per sync
const DEFAULT_LOOKBACK_MS = 30 * 24 * 60 * 60_000;
const SYNC_COOLDOWN_MS = 2 * 60_000; // per member: Strava limits the whole app to 200 requests per 15 minutes
const REFRESH_MARGIN_S = 60;

const ok = (status, body) => ({ status, body });
const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Keeps only the listed fields; missing ones stay missing (R2). */
export function stripActivity(a) {
  const out = {};
  for (const k of ACTIVITY_FIELDS) if (a?.[k] !== undefined && a[k] !== null) out[k] = a[k];
  return out;
}

/**
 * @param {{
 *   admin: import('@supabase/supabase-js').SupabaseClient,
 *   clientId: string,
 *   clientSecret: string,
 *   redirectUri: string,
 *   fetchImpl?: typeof fetch,
 *   now?: () => number,
 *   log?: Pick<Console, 'warn' | 'error'>,
 *   oauthBase?: string,
 *   apiBase?: string,
 * }} deps
 */
export function createStrava({ admin, clientId, clientSecret, redirectUri, fetchImpl = fetch, now = Date.now, log = console, oauthBase = 'https://www.strava.com', apiBase = 'https://www.strava.com/api/v3' }) {
  /** @type {Map<string, number>} */
  const lastSync = new Map();

  // The OAuth state: who started the connection and until when, signed with
  // the client secret, so a callback can't attach someone else's Strava.
  const sign = (payload) => b64u(createHmac('sha256', clientSecret).update(payload).digest());
  function makeState(userId) {
    const payload = b64u(JSON.stringify({ u: userId, e: now() + STATE_TTL_MS, n: b64u(randomBytes(9)) }));
    return `${payload}.${sign(payload)}`;
  }
  function checkState(state, userId) {
    if (typeof state !== 'string' || !state.includes('.')) return false;
    const [payload, mac] = state.split('.');
    const expected = Buffer.from(sign(payload));
    const given = Buffer.from(mac ?? '');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
    try {
      const { u, e } = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
      return u === userId && typeof e === 'number' && e > now();
    } catch {
      return false;
    }
  }

  async function tokenRequest(params) {
    const res = await fetchImpl(`${oauthBase}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, ...params }),
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  }

  async function connectionOf(userId) {
    const { data, error } = await admin.from('strava_connections').select('*').eq('user_id', userId).maybeSingle();
    if (error) throw new HttpError(503, 'Could not read your Strava connection.');
    return data;
  }

  const forget = (userId) => admin.from('strava_connections').delete().eq('user_id', userId);
  const reconnect = () => ok(401, { error: 'Strava access has ended. Connect Strava again.', reconnect: true });
  const rateLimited = (res) => {
    // Strava resets its short window every 15 minutes, on the quarter hour.
    const quarter = 15 * 60_000;
    const wait = Math.ceil((quarter - (now() % quarter)) / 1000);
    return ok(429, { error: `Strava is busy. Try again in ${Math.max(1, Math.ceil(wait / 60))} minutes.`, retryAfter: Number(res.headers.get('retry-after')) || wait });
  };

  /** A valid access token, refreshed if it is about to expire; null if Strava refused. */
  async function accessToken(conn) {
    const expires = Date.parse(conn.token_expires_at) / 1000;
    if (expires - REFRESH_MARGIN_S > now() / 1000) return conn.access_token;
    const { status, body } = await tokenRequest({ grant_type: 'refresh_token', refresh_token: conn.refresh_token });
    if (status === 400 || status === 401 || !body?.access_token) {
      log.warn('[strava] token refresh refused:', status);
      return null;
    }
    await admin
      .from('strava_connections')
      .update({ access_token: body.access_token, refresh_token: body.refresh_token ?? conn.refresh_token, token_expires_at: new Date(body.expires_at * 1000).toISOString() })
      .eq('user_id', conn.user_id);
    return body.access_token;
  }

  return {
    'GET /api/strava/auth-url': async (caller) => {
      const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', approval_prompt: 'auto', scope: SCOPE, state: makeState(caller.userId) });
      return ok(200, { url: `${oauthBase}/oauth/authorize?${q}` });
    },

    'POST /api/strava/exchange': async (caller, body) => {
      if (typeof body.code !== 'string' || !body.code || body.code.length > 200) return ok(400, { error: '`code` is required.' });
      if (!checkState(body.state, caller.userId)) return ok(400, { error: 'This Strava link has expired or belongs to another account. Connect again.' });
      if (typeof body.scope === 'string' && !body.scope.split(',').includes(SCOPE)) {
        return ok(400, { error: 'Forge OS needs permission to view your activities. Connect again and keep that box ticked.' });
      }
      const { status, body: token } = await tokenRequest({ grant_type: 'authorization_code', code: body.code });
      if (status === 429) return ok(429, { error: 'Strava is busy. Try again in a few minutes.' });
      if (status !== 200 || !token?.access_token || !token.athlete?.id) {
        log.warn('[strava] code exchange refused:', status);
        return ok(400, { error: 'Strava did not accept the connection. Try connecting again.' });
      }
      const athleteName = [token.athlete.firstname, token.athlete.lastname].filter(Boolean).join(' ').trim().slice(0, 80) || undefined;
      const { error } = await admin.from('strava_connections').upsert(
        {
          user_id: caller.userId,
          strava_athlete_id: token.athlete.id,
          access_token: token.access_token,
          refresh_token: token.refresh_token,
          token_expires_at: new Date(token.expires_at * 1000).toISOString(),
          athlete_name: athleteName ?? null,
          scope: typeof body.scope === 'string' ? body.scope.slice(0, 200) : null,
          connected_at: new Date(now()).toISOString(),
        },
        { onConflict: 'user_id' },
      );
      if (error) {
        log.error('[strava] could not save the connection:', error.message);
        return ok(500, { error: 'Could not save the Strava connection.' });
      }
      return ok(200, { connected: true, athleteName });
    },

    'GET /api/strava/activities': async (caller, _body, url) => {
      const afterParam = url.searchParams.get('after');
      const afterMs = afterParam ? Date.parse(afterParam) : NaN;
      if (afterParam && !Number.isFinite(afterMs)) return ok(400, { error: '`after` must be an ISO date.' });
      const last = lastSync.get(caller.userId);
      if (last !== undefined && now() - last < SYNC_COOLDOWN_MS) return ok(429, { error: 'Synced just now. Try again in a couple of minutes.', retryAfter: Math.ceil((SYNC_COOLDOWN_MS - (now() - last)) / 1000) });

      const conn = await connectionOf(caller.userId);
      if (!conn) return ok(404, { error: 'Strava is not connected.' });
      const token = await accessToken(conn);
      if (!token) {
        await forget(caller.userId);
        return reconnect();
      }
      lastSync.set(caller.userId, now());

      const since = Number.isFinite(afterMs) ? afterMs : conn.last_sync_at ? Date.parse(conn.last_sync_at) : now() - DEFAULT_LOOKBACK_MS;
      const activities = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const q = new URLSearchParams({ after: String(Math.floor(since / 1000)), per_page: String(PAGE_SIZE), page: String(page) });
        const res = await fetchImpl(`${apiBase}/athlete/activities?${q}`, { headers: { Authorization: `Bearer ${token}` } });
        if (res.status === 401) {
          await forget(caller.userId);
          return reconnect();
        }
        if (res.status === 429) return rateLimited(res);
        if (!res.ok) {
          log.warn('[strava] activities failed:', res.status);
          return ok(502, { error: 'Strava did not answer. Try again later.' });
        }
        const list = await res.json().catch(() => []);
        if (!Array.isArray(list)) return ok(502, { error: 'Strava sent something unexpected.' });
        activities.push(...list.map(stripActivity));
        if (list.length < PAGE_SIZE) break;
      }
      await admin.from('strava_connections').update({ last_sync_at: new Date(now()).toISOString() }).eq('user_id', caller.userId);
      return ok(200, { activities, count: activities.length });
    },

    'POST /api/strava/disconnect': async (caller) => {
      const conn = await connectionOf(caller.userId);
      if (conn) {
        // Best effort: revoke at Strava too, then forget the tokens either way.
        try {
          await fetchImpl(`${oauthBase}/oauth/deauthorize`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ access_token: conn.access_token }) });
        } catch (err) {
          log.warn('[strava] deauthorize failed:', err?.message ?? err);
        }
        await forget(caller.userId);
      }
      lastSync.delete(caller.userId);
      return ok(200, { disconnected: true });
    },
  };
}
