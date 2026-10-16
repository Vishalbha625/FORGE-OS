import type { AuditEntry, PlannedWorkout, Profile, Settings, StoreName } from '../db/types';
import { bulkPut, deleteRecord, getAll } from '../db/database';
import { generatePlan } from '../lib/plan';
import { DEFAULT_TZ, todayISO } from '../lib/dates';
import type { Snapshot } from '../lib/coach';
import type { DataArrays } from './AppContext';

// Reading and rebuilding the app's data, outside React so the app and the
// integration tests go through the same code.

export const EMPTY_DATA: DataArrays = {
  plannedWorkouts: [],
  runs: [],
  strength: [],
  hyrox: [],
  nutrition: [],
  water: [],
  sleep: [],
  steps: [],
  body: [],
  recovery: [],
  social: [],
};

export interface LoadedAppData {
  profile: Profile | null;
  settings: Settings | null;
  audit: AuditEntry[];
  data: DataArrays;
  today: string;
}

/** Everything the app shows, read from IndexedDB on this device. */
export async function loadAppData(): Promise<LoadedAppData> {
  const [prof, setts, aud] = await Promise.all([getAll('profile'), getAll('settings'), getAll('audit')]);
  const loaded: Partial<DataArrays> = {};
  for (const s of Object.keys(EMPTY_DATA) as (keyof DataArrays)[]) {
    loaded[s] = (await getAll(s as StoreName)) as never;
  }
  const profile = (prof[0] as Profile) ?? null;
  return {
    profile,
    settings: (setts[0] as Settings) ?? null,
    audit: (aud as AuditEntry[]).sort((a, b) => b.at.localeCompare(a.at)),
    data: { ...EMPTY_DATA, ...(loaded as DataArrays) },
    today: todayISO(profile?.timezone ?? DEFAULT_TZ),
  };
}

/** The read-only view the coach, analytics and dashboard work from. */
export function makeSnapshot(profile: Profile | null, data: DataArrays, today: string): Snapshot {
  return {
    profile,
    planned: data.plannedWorkouts,
    runs: data.runs,
    strength: data.strength,
    hyrox: data.hyrox,
    nutrition: data.nutrition,
    sleep: data.sleep,
    steps: data.steps,
    body: data.body,
    recovery: data.recovery,
    water: data.water,
    today,
  };
}

/**
 * Rebuild the generated plan between two dates. Days the athlete edited or
 * moved by hand keep their manual version; only generated (seed) sessions are
 * replaced. Actual logs live in other stores and are never touched (R3).
 */
export async function rebuildPlan(startDate: string, raceDate: string): Promise<void> {
  const existing = (await getAll('plannedWorkouts')) as PlannedWorkout[];
  const manualDates = new Set(existing.filter((w) => w.source !== 'seed').map((w) => w.eventDate));
  for (const w of existing) {
    if (w.source === 'seed') await deleteRecord('plannedWorkouts', w.id);
  }
  const plan = generatePlan({ startDate, raceDate }).filter((w) => !manualDates.has(w.eventDate));
  await bulkPut('plannedWorkouts', plan);
}
