import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getAll, putRecord, wipeAll } from '../db/database';
import type { RunRecord, Settings } from '../db/types';
import {
  connectStrava, disconnectStrava, exchangeStravaCode, mapStravaActivity, planImport, sanitizeTitle, syncActivities, syncSummary, type StravaActivity,
} from '../lib/stravaService';

const API = { baseUrl: 'https://coach.test', accessToken: 'tok' };
const NOW = Date.parse('2026-10-16T06:00:00Z');

const settings = (extra: Partial<Settings> = {}): Settings => ({
  id: 'settings', createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', source: 'manual',
  reminders: [], integrations: [], waterServingMl: 250, theme: 'dark', ...extra,
});

const activity = (id: number, extra: Partial<StravaActivity> = {}): StravaActivity => ({
  id, name: 'Morning run', type: 'Run', sport_type: 'Run', workout_type: 0, distance: 10020, moving_time: 3000, elapsed_time: 3100,
  average_speed: 3.34, average_heartrate: 151.6, start_date: '2026-10-15T01:30:00Z', start_date_local: '2026-10-15T07:00:00Z', total_elevation_gain: 41.6, ...extra,
});

const manualRun = (extra: Partial<RunRecord> = {}): RunRecord => ({
  id: 'manual-1', eventDate: '2026-10-15', createdAt: '2026-10-15T09:00:00Z', updatedAt: '2026-10-15T09:00:00Z', source: 'manual',
  kind: 'easy', distanceKm: 10, durationSec: 3060, ...extra,
});

/** The coach server, answering /api/strava/*. */
function server(routes: Record<string, (body: Record<string, unknown>, url: URL) => [number, unknown]>) {
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const handler = routes[`${init?.method ?? 'GET'} ${url.pathname}`];
    const [status, body] = handler ? handler(init?.body ? JSON.parse(String(init.body)) : {}, url) : [404, { error: 'no route' }];
    return new Response(JSON.stringify(body), { status });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(async () => {
  await wipeAll();
  await putRecord('settings', settings({ strava: { connected: true, athleteName: 'Vishal Bhardwaj' } }));
});
afterEach(() => vi.unstubAllGlobals());

describe('stravaService', () => {
  it('maps a Strava run into the runs log with the right units', () => {
    const m = mapStravaActivity(activity(9001), '2026-10-16T06:00:00.000Z');
    expect(m?.store).toBe('runs');
    expect(m?.record).toMatchObject({
      eventDate: '2026-10-15', distanceKm: 10.02, durationSec: 3000, avgPaceSecPerKm: 299, avgHr: 152, elevationM: 42, kind: 'other', notes: 'Morning run',
    });
    expect(mapStravaActivity(activity(1, { workout_type: 1 }))?.record).toMatchObject({ kind: 'race' });
    expect(mapStravaActivity(activity(2, { workout_type: 2 }))?.record).toMatchObject({ kind: 'long' });
    // Missing data stays missing (R2): no heart rate, no elevation.
    const bare = mapStravaActivity(activity(3, { average_heartrate: undefined, total_elevation_gain: undefined }))?.record;
    expect(bare && 'avgHr' in bare).toBe(false);
    expect(bare && 'elevationM' in bare).toBe(false);
    // Strength and Crossfit sessions; types we don't track are left out.
    expect(mapStravaActivity(activity(4, { type: 'WeightTraining', sport_type: 'WeightTraining', distance: 0, name: 'Push day' }))).toMatchObject({ store: 'strength', record: { title: 'Push day', exercises: [], durationMin: 50 } });
    expect(mapStravaActivity(activity(5, { type: 'Crossfit', sport_type: 'Crossfit' }))).toMatchObject({ store: 'hyrox', record: { mode: 'combo', stations: [], totalTimeSec: 3000 } });
    for (const type of ['Ride', 'Walk', 'Hike', 'Swim', 'Yoga']) expect(mapStravaActivity(activity(6, { type, sport_type: type }))).toBeNull();
    expect(mapStravaActivity(activity(7, { distance: undefined }))).toBeNull();
    expect(sanitizeTitle('  <b>Tempo</b>\n\tthursday ', 'x')).toBe('b Tempo /b thursday');
  });

  it('imports new activities with source strava and the Strava id, and records the sync', async () => {
    const fetchMock = server({ 'GET /api/strava/activities': () => [200, { activities: [activity(9001), activity(9002, { start_date_local: '2026-10-14T06:00:00Z', distance: 5000, moving_time: 1500 })], count: 2 }] });
    const res = await syncActivities(API, () => NOW);
    expect(res).toEqual({ imported: { runs: 2, strength: 0, hyrox: 0 }, duplicates: 0, ignored: 0 });
    const runs = await getAll('runs');
    expect(runs.map((r) => [r.source, r.stravaActivityId, r.eventDate]).sort()).toEqual([['strava', '9001', '2026-10-15'], ['strava', '9002', '2026-10-14']]);
    expect((await getAll('settings'))[0].strava).toEqual({ connected: true, athleteName: 'Vishal Bhardwaj', lastSyncAt: '2026-10-16T06:00:00.000Z' });
    expect(new Headers((fetchMock.mock.calls[0][1] as RequestInit).headers).get('Authorization')).toBe('Bearer tok');
    expect(syncSummary(res)).toBe('Imported 2 runs');

    // The next sync asks from a week before the last one, and adds nothing twice.
    const again = await syncActivities(API, () => NOW + 3600_000);
    expect(new URL(String(fetchMock.mock.calls[1][0])).searchParams.get('after')).toBe('2026-10-09T06:00:00.000Z');
    expect(again).toEqual({ imported: { runs: 0, strength: 0, hyrox: 0 }, duplicates: 2, ignored: 0 });
    expect(await getAll('runs')).toHaveLength(2);
  });

  it('skips a run already logged by hand: same day, within 0.1 km and 2 minutes', async () => {
    await putRecord('runs', manualRun());
    server({
      'GET /api/strava/activities': () => [200, {
        activities: [
          activity(1), // 10.02 km in 50:00 vs 10 km in 51:00 by hand: the same run
          activity(2, { distance: 10200 }), // 0.2 km longer: a different run
          activity(3, { moving_time: 3200 }), // 2:20 slower: a different run
          activity(4, { start_date_local: '2026-10-14T07:00:00Z' }), // another day
          activity(5, { type: 'Ride', sport_type: 'Ride' }),
        ],
      }],
    });
    const res = await syncActivities(API, () => NOW);
    expect(res).toEqual({ imported: { runs: 3, strength: 0, hyrox: 0 }, duplicates: 1, ignored: 1 });
    expect(syncSummary(res)).toBe('Imported 3 runs, skipped 1 duplicate');
    const runs = await getAll('runs');
    expect(runs.find((r) => r.id === 'manual-1')).toEqual(manualRun()); // the hand-logged run is untouched
    expect(runs.filter((r) => r.source === 'strava').map((r) => r.stravaActivityId).sort()).toEqual(['2', '3', '4']);
    // Duplicates inside one batch count too.
    expect(planImport([activity(8), activity(8)], { runs: [], strength: [], hyrox: [] }).add).toHaveLength(1);
  });

  it('disconnect clears the connection but keeps every imported activity', async () => {
    server({ 'GET /api/strava/activities': () => [200, { activities: [activity(9001)] }], 'POST /api/strava/disconnect': () => [200, { disconnected: true }] });
    await syncActivities(API, () => NOW);
    expect(await disconnectStrava(API)).toEqual({});
    expect((await getAll('settings'))[0].strava).toBeUndefined();
    expect((await getAll('runs')).map((r) => r.stravaActivityId)).toEqual(['9001']);
  });

  it('keeps the connection when the server could not disconnect', async () => {
    server({ 'POST /api/strava/disconnect': () => [503, { error: 'Strava import is not set up on this server.' }] });
    expect(await disconnectStrava(API)).toEqual({ error: 'Strava import is not set up on this server.' });
    expect((await getAll('settings'))[0].strava?.connected).toBe(true);
  });

  it('forgets the connection when Strava access has ended', async () => {
    server({ 'GET /api/strava/activities': () => [401, { error: 'Strava access has ended. Connect Strava again.', reconnect: true }] });
    const res = await syncActivities(API, () => NOW);
    expect(res).toMatchObject({ reconnect: true, error: 'Strava access has ended. Connect Strava again.' });
    expect((await getAll('settings'))[0].strava).toBeUndefined();
  });

  it('connects: goes to the URL the server signs, then saves the athlete after the exchange', async () => {
    await putRecord('settings', settings());
    const fetchMock = server({
      'GET /api/strava/auth-url': () => [200, { url: 'https://www.strava.com/oauth/authorize?client_id=1&state=abc' }],
      'POST /api/strava/exchange': (body) => (body.code === 'c0de' && body.state === 'abc' ? [200, { connected: true, athleteName: 'Vishal Bhardwaj' }] : [400, { error: 'bad' }]),
    });
    const go = vi.fn();
    expect(await connectStrava(API, go)).toEqual({});
    expect(go).toHaveBeenCalledWith('https://www.strava.com/oauth/authorize?client_id=1&state=abc');
    expect(await exchangeStravaCode(API, 'c0de', 'abc', 'read,activity:read')).toEqual({ connected: true, athleteName: 'Vishal Bhardwaj' });
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))).toEqual({ code: 'c0de', state: 'abc', scope: 'read,activity:read' });
    expect((await getAll('settings'))[0].strava).toEqual({ connected: true, athleteName: 'Vishal Bhardwaj' });
    expect(await exchangeStravaCode(API, 'wrong', 'abc')).toEqual({ connected: false, error: 'bad' });
  });
});
