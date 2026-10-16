import { describe, it, expect, vi, afterEach } from 'vitest';
import { createStrava } from '../../server/strava.mjs';
import { call, startServer, type RunningServer } from './serverHarness';

const VISHAL = '11111111-1111-4111-8111-111111111111';
const RIYA = '22222222-2222-4222-8222-222222222222';
const T0 = Date.parse('2026-10-16T06:00:00Z');

// One activity as Strava sends it: maps, coordinates and splits included.
const RAW = {
  id: 9001,
  name: 'Morning run',
  type: 'Run',
  sport_type: 'Run',
  workout_type: 0,
  distance: 10020.5,
  moving_time: 3005,
  elapsed_time: 3100,
  average_speed: 3.33,
  max_speed: 4.9,
  average_heartrate: 152.4,
  start_date: '2026-10-15T01:30:00Z',
  start_date_local: '2026-10-15T07:00:00Z',
  total_elevation_gain: 42,
  map: { id: 'a9001', polyline: 'abc', summary_polyline: 'xyz' },
  start_latlng: [28.61, 77.2],
  end_latlng: [28.62, 77.21],
  splits_metric: [{ distance: 1000 }],
  athlete: { id: 77 },
};

let server: RunningServer;
let clock = T0;
let stravaFetch: ReturnType<typeof vi.fn>;
let activityStatus = 200;
let refreshStatus = 200;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers });

async function start() {
  stravaFetch = vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    if (u.pathname === '/oauth/token' && body.grant_type === 'authorization_code') {
      if (body.code !== 'good-code' || body.client_secret !== 'shh') return json({ message: 'Bad Request' }, 400);
      return json({ access_token: 'acc-1', refresh_token: 'ref-1', expires_at: Math.floor(clock / 1000) + 6 * 3600, athlete: { id: 77, firstname: 'Vishal', lastname: 'Bhardwaj' } });
    }
    if (u.pathname === '/oauth/token' && body.grant_type === 'refresh_token') {
      if (refreshStatus !== 200) return json({ message: 'Bad Request' }, refreshStatus);
      return json({ access_token: 'acc-2', refresh_token: 'ref-2', expires_at: Math.floor(clock / 1000) + 6 * 3600 });
    }
    if (u.pathname === '/oauth/deauthorize') return json({ access_token: body.access_token });
    if (u.pathname === '/api/v3/athlete/activities') {
      if (activityStatus === 429) return json({ message: 'Rate Limit Exceeded' }, 429);
      if (activityStatus !== 200) return json({ message: 'Authorization Error' }, activityStatus);
      return json([RAW]);
    }
    return json({ message: 'not found' }, 404);
  });
  server = await startServer(({ admin }) => ({
    strava: createStrava({
      admin,
      clientId: '123',
      clientSecret: 'shh',
      redirectUri: 'https://forge.test/settings/strava/callback',
      fetchImpl: stravaFetch as unknown as typeof fetch,
      now: () => clock,
      log: { warn: () => {}, error: () => {} },
      oauthBase: 'https://strava.test',
      apiBase: 'https://strava.test/api/v3',
    }),
  }));
  server.backend.addUser(VISHAL, 'Vishal Bhardwaj');
  server.backend.addUser(RIYA, 'Riya Sharma');
}

/** Runs the OAuth dance for Vishal and returns his token. */
async function connect() {
  const token = server.tokenFor(VISHAL);
  const auth = await call(`${server.url}/api/strava/auth-url`, { token });
  const state = new URL(String(auth.body?.url)).searchParams.get('state');
  const res = await call(`${server.url}/api/strava/exchange`, { token, body: { code: 'good-code', state, scope: 'read,activity:read' } });
  expect(res).toEqual({ status: 200, body: { connected: true, athleteName: 'Vishal Bhardwaj' } });
  return token;
}

afterEach(async () => {
  await server?.close();
  clock = T0;
  activityStatus = 200;
  refreshStatus = 200;
});

describe('strava server', () => {
  it('refuses every Strava endpoint without a valid sign-in', async () => {
    await start();
    expect((await call(`${server.url}/api/strava/exchange`, { body: { code: 'good-code', state: 'x' } })).status).toBe(401);
    expect((await call(`${server.url}/api/strava/exchange`, { token: 'forged', body: { code: 'good-code', state: 'x' } })).status).toBe(401);
    expect((await call(`${server.url}/api/strava/auth-url`)).status).toBe(401);
    expect((await call(`${server.url}/api/strava/activities`)).status).toBe(401);
    expect((await call(`${server.url}/api/strava/disconnect`, { body: {} })).status).toBe(401);
    expect(stravaFetch).not.toHaveBeenCalled();
    expect(server.backend.tables.strava_connections).toEqual([]);
  });

  it('returns activities stripped of maps, GPS and splits, and keeps the tokens on the server', async () => {
    await start();
    const token = await connect();
    expect(server.backend.tables.strava_connections).toEqual([expect.objectContaining({ user_id: VISHAL, strava_athlete_id: 77, access_token: 'acc-1', refresh_token: 'ref-1' })]);

    const res = await call(`${server.url}/api/strava/activities`, { token });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/acc-1|ref-1|polyline|latlng|splits|athlete|28\.61/);
    expect(res.body).toEqual({
      count: 1,
      activities: [
        {
          id: 9001, name: 'Morning run', type: 'Run', sport_type: 'Run', workout_type: 0, distance: 10020.5, moving_time: 3005, elapsed_time: 3100,
          average_speed: 3.33, max_speed: 4.9, average_heartrate: 152.4, start_date: '2026-10-15T01:30:00Z', start_date_local: '2026-10-15T07:00:00Z', total_elevation_gain: 42,
        },
      ],
    });
    // Asked Strava with the stored token, for the last 30 days by default.
    const [url, init] = stravaFetch.mock.calls.at(-1) as [string, RequestInit];
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer acc-1');
    expect(new URL(url).searchParams.get('after')).toBe(String(Math.floor((T0 - 30 * 86400_000) / 1000)));
    expect(server.backend.tables.strava_connections[0].last_sync_at).toBe(new Date(T0).toISOString());
  });

  it('only accepts a state it signed, for the same member, before it expires', async () => {
    await start();
    const vishal = server.tokenFor(VISHAL);
    const riya = server.tokenFor(RIYA);
    const state = new URL(String((await call(`${server.url}/api/strava/auth-url`, { token: vishal })).body?.url)).searchParams.get('state');
    expect((await call(`${server.url}/api/strava/exchange`, { token: riya, body: { code: 'good-code', state } })).status).toBe(400);
    expect((await call(`${server.url}/api/strava/exchange`, { token: vishal, body: { code: 'good-code', state: `${state}x` } })).status).toBe(400);
    expect((await call(`${server.url}/api/strava/exchange`, { token: vishal, body: { code: 'good-code', state, scope: 'read' } })).status).toBe(400);
    clock += 11 * 60_000;
    expect((await call(`${server.url}/api/strava/exchange`, { token: vishal, body: { code: 'good-code', state } })).status).toBe(400);
    expect(server.backend.tables.strava_connections).toEqual([]);
  });

  it('refreshes an expired token, and asks to reconnect when Strava refuses', async () => {
    await start();
    const token = await connect();
    clock += 7 * 3600_000;
    expect((await call(`${server.url}/api/strava/activities`, { token })).status).toBe(200);
    expect(server.backend.tables.strava_connections[0]).toMatchObject({ access_token: 'acc-2', refresh_token: 'ref-2' });

    clock += 7 * 3600_000;
    refreshStatus = 400;
    expect(await call(`${server.url}/api/strava/activities`, { token })).toEqual({ status: 401, body: { error: 'Strava access has ended. Connect Strava again.', reconnect: true } });
    expect(server.backend.tables.strava_connections).toEqual([]);
    expect((await call(`${server.url}/api/strava/activities`, { token: server.tokenFor(RIYA) })).status).toBe(404);
  });

  it('passes on Strava rate limits and spaces out syncs', async () => {
    await start();
    const token = await connect();
    activityStatus = 429;
    const limited = await call(`${server.url}/api/strava/activities`, { token });
    expect(limited.status).toBe(429);
    expect(limited.body?.retryAfter).toEqual(expect.any(Number));
    activityStatus = 200;
    clock += 3 * 60_000;
    expect((await call(`${server.url}/api/strava/activities`, { token })).status).toBe(200);
    const again = await call(`${server.url}/api/strava/activities`, { token });
    expect(again.status).toBe(429);
    expect(again.body?.error).toBe('Synced just now. Try again in a couple of minutes.');
  });

  it('disconnects at Strava and forgets the tokens', async () => {
    await start();
    const token = await connect();
    expect(await call(`${server.url}/api/strava/disconnect`, { token, body: {} })).toEqual({ status: 200, body: { disconnected: true } });
    const deauth = stravaFetch.mock.calls.find(([u]) => String(u).endsWith('/oauth/deauthorize')) as [string, RequestInit];
    expect(JSON.parse(String(deauth[1].body))).toEqual({ access_token: 'acc-1' });
    expect(server.backend.tables.strava_connections).toEqual([]);
  });

  it('says so when Strava is not set up', async () => {
    server = await startServer(() => ({}));
    expect(await call(`${server.url}/api/strava/auth-url`, { token: server.tokenFor(VISHAL) })).toEqual({ status: 503, body: { error: 'Strava import is not set up on this server.' } });
  });
});
