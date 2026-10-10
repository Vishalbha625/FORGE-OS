import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type {
  Profile,
  Settings,
  StoreMap,
  StoreName,
  PlannedWorkout,
  RunRecord,
  StrengthRecord,
  HyroxRecord,
  NutritionEntry,
  WaterEntry,
  SleepRecord,
  StepRecord,
  BodyRecord,
  RecoveryRecord,
  SocialPost,
} from '../db/types';
import {
  getAll,
  putRecord,
  deleteRecord as dbDelete,
  bulkPut,
  exportAll,
  importAll,
  wipeAll,
  nowISO,
  uid,
  type BackupFile,
  type ImportResult,
} from '../db/database';
import { generatePlan } from '../lib/plan';
import { todayISO, DEFAULT_TZ } from '../lib/dates';
import type { Snapshot } from '../lib/coach';

interface DataArrays {
  plannedWorkouts: PlannedWorkout[];
  runs: RunRecord[];
  strength: StrengthRecord[];
  hyrox: HyroxRecord[];
  nutrition: NutritionEntry[];
  water: WaterEntry[];
  sleep: SleepRecord[];
  steps: StepRecord[];
  body: BodyRecord[];
  recovery: RecoveryRecord[];
  social: SocialPost[];
}

interface AppState {
  loading: boolean;
  profile: Profile | null;
  settings: Settings | null;
  data: DataArrays;
  today: string;
  snapshot: Snapshot;
  // actions
  saveProfile: (p: Profile) => Promise<void>;
  saveSettings: (s: Settings) => Promise<void>;
  save: <K extends keyof DataArrays>(store: K, rec: DataArrays[K][number]) => Promise<DataArrays[K][number]>;
  remove: <K extends keyof DataArrays>(store: K, id: string) => Promise<void>;
  regeneratePlan: (startDate: string, raceDate: string) => Promise<void>;
  reload: () => Promise<void>;
  exportData: () => Promise<BackupFile>;
  importData: (file: BackupFile, mode: 'merge' | 'replace') => Promise<ImportResult>;
  resetAll: () => Promise<void>;
}

const emptyData: DataArrays = {
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

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [data, setData] = useState<DataArrays>(emptyData);
  const [today, setToday] = useState(todayISO(DEFAULT_TZ));

  const reload = async () => {
    const [prof, setts] = await Promise.all([getAll('profile'), getAll('settings')]);
    const stores: (keyof DataArrays)[] = [
      'plannedWorkouts', 'runs', 'strength', 'hyrox', 'nutrition',
      'water', 'sleep', 'steps', 'body', 'recovery', 'social',
    ];
    const loaded: Partial<DataArrays> = {};
    for (const s of stores) {
      loaded[s] = (await getAll(s as StoreName)) as never;
    }
    setProfile((prof[0] as Profile) ?? null);
    setSettings((setts[0] as Settings) ?? null);
    setData({ ...emptyData, ...(loaded as DataArrays) });
    setToday(todayISO((prof[0] as Profile)?.timezone ?? DEFAULT_TZ));
    setLoading(false);
  };

  useEffect(() => {
    reload();
    // refresh "today" at a light interval in case the app stays open overnight
    const t = setInterval(() => setToday(todayISO(profile?.timezone ?? DEFAULT_TZ)), 60000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveProfile = async (p: Profile) => {
    p.updatedAt = nowISO();
    await putRecord('profile', p);
    setProfile(p);
    setToday(todayISO(p.timezone ?? DEFAULT_TZ));
  };

  const saveSettings = async (s: Settings) => {
    s.updatedAt = nowISO();
    await putRecord('settings', s);
    setSettings(s);
  };

  const save = async <K extends keyof DataArrays>(store: K, rec: DataArrays[K][number]) => {
    (rec as { updatedAt: string }).updatedAt = nowISO();
    await putRecord(store as StoreName, rec as StoreMap[StoreName]);
    setData((prev) => {
      const arr = prev[store] as DataArrays[K];
      const id = (rec as { id: string }).id;
      const idx = arr.findIndex((r) => (r as { id: string }).id === id);
      const next = idx >= 0 ? arr.map((r) => ((r as { id: string }).id === id ? rec : r)) : [...arr, rec];
      return { ...prev, [store]: next } as DataArrays;
    });
    return rec;
  };

  const remove = async <K extends keyof DataArrays>(store: K, id: string) => {
    await dbDelete(store as StoreName, id);
    setData((prev) => ({
      ...prev,
      [store]: (prev[store] as DataArrays[K]).filter((r) => (r as { id: string }).id !== id),
    }) as DataArrays);
  };

  const regeneratePlan = async (startDate: string, raceDate: string) => {
    const plan = generatePlan({ startDate, raceDate });
    // Remove only seed planned workouts (preserve any user-created plan edits with source !== seed)
    const existing = await getAll('plannedWorkouts');
    for (const w of existing as PlannedWorkout[]) {
      if (w.source === 'seed') await dbDelete('plannedWorkouts', w.id);
    }
    await bulkPut('plannedWorkouts', plan);
    await reload();
  };

  const exportData = () => exportAll();
  const importData = async (file: BackupFile, mode: 'merge' | 'replace') => {
    const res = await importAll(file, mode);
    await reload();
    return res;
  };
  const resetAll = async () => {
    await wipeAll();
    await reload();
  };

  const snapshot: Snapshot = useMemo(
    () => ({
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
    }),
    [profile, data, today],
  );

  const value: AppState = {
    loading,
    profile,
    settings,
    data,
    today,
    snapshot,
    saveProfile,
    saveSettings,
    save,
    remove,
    regeneratePlan,
    reload,
    exportData,
    importData,
    resetAll,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

// Helpers for creating new records with identity + timestamps.
export function newRecord<T extends object>(fields: T): T & { id: string; createdAt: string; updatedAt: string } {
  const ts = nowISO();
  return { id: uid(), createdAt: ts, updatedAt: ts, ...fields };
}

export { uid };
