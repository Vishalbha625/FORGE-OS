import type { HyroxRecord, RunRecord, Settings, StrengthRecord } from '../db/types';
import { bulkPut, getAll, nowISO, putRecord, uid } from '../db/database';
import type { PushApi } from './pushService';

// Strava import. Every Strava call goes through the coach server, which holds
// the client secret and the tokens (R4); this file only ever sees activity
// summaries without maps or GPS. Imported activities are written to this
// device (IndexedDB) and nowhere else (R1).

/** Where and as whom to talk to the coach server: the signed-in community session. */
export type StravaApi = PushApi;

/** An activity as the server returns it (already stripped to these fields). */
export interface StravaActivity {
  id: number;
  name?: string;
  type?: string;
  sport_type?: string;
  workout_type?: number;
  distance?: number;
  moving_time?: number;
  elapsed_time?: number;
  average_speed?: number;
  max_speed?: number;
  average_heartrate?: number;
  start_date?: string;
  start_date_local?: string;
  total_elevation_gain?: number;
}

export type MappedActivity =
  | { store: 'runs'; record: RunRecord }
  | { store: 'strength'; record: StrengthRecord }
  | { store: 'hyrox'; record: HyroxRecord };

export interface ExistingLogs {
  runs: RunRecord[];
  strength: StrengthRecord[];
  hyrox: HyroxRecord[];
}

export interface SyncResult {
  imported: { runs: number; strength: number; hyrox: number };
  /** Already in your logs (imported before, or logged by hand). */
  duplicates: number;
  /** Activity types Forge OS doesn't track (rides, walks, swims...). */
  ignored: number;
  error?: string;
  /** Strava access ended: connect again. */
  reconnect?: boolean;
}

const RUN_TYPES = new Set(['Run', 'TrailRun', 'VirtualRun']);
const STRENGTH_TYPES = new Set(['WeightTraining']);
const HYROX_TYPES = new Set(['Crossfit']);
/** Re-read the last week on every sync: Strava uploads from watches can arrive late. */
const OVERLAP_MS = 7 * 24 * 60 * 60_000;
const DISTANCE_TOLERANCE_KM = 0.1;
const DURATION_TOLERANCE_SEC = 120;

/** Which log an activity belongs in; null for types Forge OS doesn't track. */
export function stravaStore(a: Pick<StravaActivity, 'type' | 'sport_type'>): MappedActivity['store'] | null {
  const t = a.sport_type ?? a.type ?? '';
  if (RUN_TYPES.has(t)) return 'runs';
  if (STRENGTH_TYPES.has(t)) return 'strength';
  if (HYROX_TYPES.has(t)) return 'hyrox';
  return null;
}

/** An activity name as plain text: no control characters, no runs of spaces, at most 80 characters. */
export function sanitizeTitle(name: unknown, fallback: string): string {
  if (typeof name !== 'string') return fallback;
  // eslint-disable-next-line no-control-regex
  const clean = name.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return clean || fallback;
}

const positive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
const round = (n: number, dp = 0) => Math.round(n * 10 ** dp) / 10 ** dp;

/**
 * One Strava activity as a Forge OS log entry, or null when it can't be one
 * (a type we don't track, no date, a run without distance or time). Fields
 * Strava didn't send stay missing (R2).
 */
export function mapStravaActivity(a: StravaActivity, now: string = nowISO()): MappedActivity | null {
  const store = stravaStore(a);
  const day = (a.start_date_local ?? a.start_date ?? '').slice(0, 10);
  if (!store || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(a.id)) return null;
  const base = { id: uid(), createdAt: now, updatedAt: now, source: 'strava' as const, eventDate: day, stravaActivityId: String(a.id) };
  const seconds = positive(a.moving_time) ? Math.round(a.moving_time) : positive(a.elapsed_time) ? Math.round(a.elapsed_time) : undefined;

  if (store === 'runs') {
    if (!positive(a.distance) || seconds === undefined) return null;
    const distanceKm = round(a.distance / 1000, 2);
    const record: RunRecord = {
      ...base,
      kind: a.workout_type === 1 ? 'race' : a.workout_type === 2 ? 'long' : 'other',
      distanceKm,
      durationSec: seconds,
      avgPaceSecPerKm: Math.round(seconds / distanceKm),
      notes: sanitizeTitle(a.name, 'Strava run'),
    };
    if (typeof a.total_elevation_gain === 'number' && Number.isFinite(a.total_elevation_gain)) record.elevationM = Math.round(a.total_elevation_gain);
    if (positive(a.average_heartrate)) record.avgHr = Math.round(a.average_heartrate);
    return { store, record };
  }
  if (store === 'strength') {
    const record: StrengthRecord = { ...base, title: sanitizeTitle(a.name, 'Strength session'), exercises: [] };
    if (seconds !== undefined) record.durationMin = Math.round(seconds / 60);
    return { store, record };
  }
  const record: HyroxRecord = { ...base, title: sanitizeTitle(a.name, 'Hybrid session'), mode: 'combo', stations: [] };
  if (seconds !== undefined) record.totalTimeSec = seconds;
  return { store, record };
}

const close = (a: number | undefined, b: number | undefined, tolerance: number) => a !== undefined && b !== undefined && Math.abs(a - b) <= tolerance;

/** Already in your logs: the same Strava activity, or the same session logged by hand (same day, ±0.1 km, ±2 min). */
export function isDuplicate(m: MappedActivity, existing: ExistingLogs): boolean {
  const sid = m.record.stravaActivityId;
  if ([...existing.runs, ...existing.strength, ...existing.hyrox].some((r) => r.stravaActivityId !== undefined && r.stravaActivityId === sid)) return true;
  const day = m.record.eventDate;
  if (m.store === 'runs') {
    const run = m.record;
    return existing.runs.some((r) => r.eventDate === day && close(r.distanceKm, run.distanceKm, DISTANCE_TOLERANCE_KM) && close(r.durationSec, run.durationSec, DURATION_TOLERANCE_SEC));
  }
  if (m.store === 'strength') {
    const s = m.record;
    return existing.strength.some((r) => r.eventDate === day && close(r.durationMin, s.durationMin, DURATION_TOLERANCE_SEC / 60));
  }
  const h = m.record;
  return existing.hyrox.some((r) => r.eventDate === day && close(r.totalTimeSec, h.totalTimeSec, DURATION_TOLERANCE_SEC));
}

/** Sorts a batch into new entries, duplicates and types we don't track. Duplicates within the batch count too. */
export function planImport(activities: StravaActivity[], existing: ExistingLogs, now: string = nowISO()) {
  const seen: ExistingLogs = { runs: [...existing.runs], strength: [...existing.strength], hyrox: [...existing.hyrox] };
  const add: MappedActivity[] = [];
  let duplicates = 0;
  let ignored = 0;
  for (const a of activities) {
    const m = mapStravaActivity(a, now);
    if (!m) {
      ignored++;
      continue;
    }
    if (isDuplicate(m, seen)) {
      duplicates++;
      continue;
    }
    add.push(m);
    if (m.store === 'runs') seen.runs.push(m.record);
    else if (m.store === 'strength') seen.strength.push(m.record);
    else seen.hyrox.push(m.record);
  }
  return { add, duplicates, ignored };
}

/** "Imported 3 runs, skipped 2 duplicates". */
export function syncSummary(r: SyncResult): string {
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const parts: string[] = [];
  if (r.imported.runs) parts.push(plural(r.imported.runs, 'run'));
  if (r.imported.strength) parts.push(plural(r.imported.strength, 'strength session'));
  if (r.imported.hyrox) parts.push(plural(r.imported.hyrox, 'hybrid session'));
  const head = parts.length ? `Imported ${parts.join(', ')}` : 'Nothing new to import';
  return r.duplicates ? `${head}, skipped ${plural(r.duplicates, 'duplicate')}` : head;
}

// ── Server calls ─────────────────────────────────────────────────────────────

interface ApiResult<T> {
  data?: T;
  error?: string;
  status: number;
  reconnect?: boolean;
}

async function call<T>(api: StravaApi, method: 'GET' | 'POST', path: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${api.baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${api.accessToken}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const error = typeof json.error === 'string' && json.error ? json.error : `The server answered ${res.status}.`;
      return { status: res.status, error, reconnect: json.reconnect === true };
    }
    return { status: res.status, data: json as T };
  } catch {
    return { status: 0, error: "Couldn't reach the coach server. Check your connection." };
  }
}

async function readSettings(): Promise<Settings | undefined> {
  return (await getAll('settings'))[0];
}

async function writeStrava(patch: Settings['strava']): Promise<void> {
  const s = await readSettings();
  if (!s) return;
  await putRecord('settings', { ...s, strava: patch, updatedAt: nowISO() });
}

/** Sends the browser to Strava's consent screen. Resolves with an error if the server can't start it. */
export async function connectStrava(api: StravaApi, go: (url: string) => void = (u) => window.location.assign(u)): Promise<{ error?: string }> {
  const res = await call<{ url?: unknown }>(api, 'GET', '/api/strava/auth-url');
  const url = res.data?.url;
  if (typeof url !== 'string' || !/^https:\/\//.test(url)) return { error: res.error ?? 'Strava import is not set up on this server.' };
  go(url);
  return {};
}

/** Finishes the connection after Strava sends the athlete back. Saves the connection on this device. */
export async function exchangeStravaCode(api: StravaApi, code: string, state: string, scope?: string): Promise<{ connected: boolean; athleteName?: string; error?: string }> {
  const res = await call<{ connected?: boolean; athleteName?: unknown }>(api, 'POST', '/api/strava/exchange', { code, state, scope });
  if (!res.data?.connected) return { connected: false, error: res.error ?? 'Strava did not connect.' };
  const athleteName = typeof res.data.athleteName === 'string' && res.data.athleteName ? res.data.athleteName : undefined;
  const prev = (await readSettings())?.strava;
  await writeStrava({ connected: true, ...(athleteName ? { athleteName } : {}), ...(prev?.lastSyncAt ? { lastSyncAt: prev.lastSyncAt } : {}) });
  return { connected: true, athleteName };
}

/** Imports new activities into this device's logs and records when. */
export async function syncActivities(api: StravaApi, now: () => number = Date.now): Promise<SyncResult> {
  const empty = { imported: { runs: 0, strength: 0, hyrox: 0 }, duplicates: 0, ignored: 0 };
  const settings = await readSettings();
  const last = settings?.strava?.lastSyncAt ? Date.parse(settings.strava.lastSyncAt) : NaN;
  const query = Number.isFinite(last) ? `?after=${encodeURIComponent(new Date(last - OVERLAP_MS).toISOString())}` : '';
  const res = await call<{ activities?: unknown }>(api, 'GET', `/api/strava/activities${query}`);
  if (res.reconnect || res.status === 404) {
    await writeStrava(undefined);
    return { ...empty, error: res.error ?? 'Strava is not connected.', reconnect: true };
  }
  if (!res.data || !Array.isArray(res.data.activities)) return { ...empty, error: res.error ?? 'Strava sent something unexpected.' };

  const activities = res.data.activities.filter((a): a is StravaActivity => typeof a === 'object' && a !== null && typeof (a as StravaActivity).id === 'number');
  const stamp = new Date(now()).toISOString();
  const existing: ExistingLogs = { runs: await getAll('runs'), strength: await getAll('strength'), hyrox: await getAll('hyrox') };
  const { add, duplicates, ignored } = planImport(activities, existing, stamp);
  const runs = add.flatMap((m) => (m.store === 'runs' ? [m.record] : []));
  const strength = add.flatMap((m) => (m.store === 'strength' ? [m.record] : []));
  const hyrox = add.flatMap((m) => (m.store === 'hyrox' ? [m.record] : []));
  if (runs.length) await bulkPut('runs', runs);
  if (strength.length) await bulkPut('strength', strength);
  if (hyrox.length) await bulkPut('hyrox', hyrox);
  const current = (await readSettings())?.strava;
  await writeStrava({ ...(current ?? { connected: true }), connected: true, lastSyncAt: stamp });
  return { imported: { runs: runs.length, strength: strength.length, hyrox: hyrox.length }, duplicates, ignored: ignored + (res.data.activities.length - activities.length) };
}

/** Disconnects at Strava and on the server. Activities already imported stay in your logs. */
export async function disconnectStrava(api: StravaApi): Promise<{ error?: string }> {
  const res = await call<{ disconnected?: boolean }>(api, 'POST', '/api/strava/disconnect');
  if (!res.data?.disconnected) return { error: res.error ?? 'Could not disconnect Strava.' };
  await writeStrava(undefined);
  return {};
}
