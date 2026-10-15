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
  AuditEntry,
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
import { auditSummary, stripForAudit } from '../lib/audit';
import type { Snapshot } from '../lib/coach';
import { AUTH_LINKED_EVENT, type AuthLinkedDetail } from '../lib/authService';

export interface DataArrays {
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

// Stores whose edits/deletions are worth an audit trail. Social posts are
// excluded: kudos and comments would flood the history with noise.
const AUDITED: (keyof DataArrays)[] = [
  'plannedWorkouts', 'runs', 'strength', 'hyrox', 'nutrition', 'water',
  'sleep', 'steps', 'body', 'recovery',
];

interface AppState {
  loading: boolean;
  profile: Profile | null;
  settings: Settings | null;
  data: DataArrays;
  audit: AuditEntry[];
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
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [today, setToday] = useState(todayISO(DEFAULT_TZ));

  const reload = async () => {
    const [prof, setts, aud] = await Promise.all([getAll('profile'), getAll('settings'), getAll('audit')]);
    const stores = Object.keys(emptyData) as (keyof DataArrays)[];
    const loaded: Partial<DataArrays> = {};
    for (const s of stores) {
      loaded[s] = (await getAll(s as StoreName)) as never;
    }
    setProfile((prof[0] as Profile) ?? null);
    setSettings((setts[0] as Settings) ?? null);
    setAudit((aud as AuditEntry[]).sort((a, b) => b.at.localeCompare(a.at)));
    setData({ ...emptyData, ...(loaded as DataArrays) });
    setToday(todayISO((prof[0] as Profile)?.timezone ?? DEFAULT_TZ));
    setLoading(false);
  };

  useEffect(() => {
    reload();
    // refresh "today" in case the app stays open overnight
    const t = setInterval(() => setToday(todayISO(profile?.timezone ?? DEFAULT_TZ)), 60000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const writeAudit = async (entry: Omit<AuditEntry, 'id' | 'at'>) => {
    const full: AuditEntry = { id: uid(), at: nowISO(), ...entry };
    await putRecord('audit', full);
    setAudit((prev) => [full, ...prev]);
  };

  const saveProfile = async (p: Profile) => {
    p.updatedAt = nowISO();
    await putRecord('profile', p);
    setProfile(p);
    setToday(todayISO(p.timezone ?? DEFAULT_TZ));
  };

  // A community account was created or signed in on this device: remember its
  // id on the local profile. Reads the stored profile so it is never stale.
  useEffect(() => {
    const onLinked = async (e: Event) => {
      const supabaseUserId = (e as CustomEvent<AuthLinkedDetail>).detail?.supabaseUserId;
      if (!supabaseUserId) return;
      const current = (await getAll('profile'))[0];
      if (!current || current.supabaseUserId === supabaseUserId) return;
      await saveProfile({ ...current, supabaseUserId });
    };
    window.addEventListener(AUTH_LINKED_EVENT, onLinked);
    return () => window.removeEventListener(AUTH_LINKED_EVENT, onLinked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveSettings = async (s: Settings) => {
    s.updatedAt = nowISO();
    await putRecord('settings', s);
    setSettings(s);
  };

  const save = async <K extends keyof DataArrays>(store: K, rec: DataArrays[K][number]) => {
    const id = (rec as { id: string }).id;
    const before = (data[store] as { id: string }[]).find((r) => r.id === id);
    (rec as { updatedAt: string }).updatedAt = nowISO();
    await putRecord(store as StoreName, rec as StoreMap[StoreName]);
    setData((prev) => {
      const arr = prev[store] as DataArrays[K];
      const idx = arr.findIndex((r) => (r as { id: string }).id === id);
      const next = idx >= 0 ? arr.map((r) => ((r as { id: string }).id === id ? rec : r)) : [...arr, rec];
      return { ...prev, [store]: next } as DataArrays;
    });
    // Only edits of an existing record are audited; creation is the record itself.
    if (before && AUDITED.includes(store)) {
      await writeAudit({
        store,
        recordId: id,
        action: 'update',
        eventDate: (rec as { eventDate?: string }).eventDate,
        summary: auditSummary(store, rec, 'update'),
        before: stripForAudit(before),
        after: stripForAudit(rec),
      });
    }
    return rec;
  };

  const remove = async <K extends keyof DataArrays>(store: K, id: string) => {
    const before = (data[store] as { id: string }[]).find((r) => r.id === id);
    await dbDelete(store as StoreName, id);
    setData((prev) => ({
      ...prev,
      [store]: (prev[store] as DataArrays[K]).filter((r) => (r as { id: string }).id !== id),
    }) as DataArrays);
    if (before && AUDITED.includes(store)) {
      await writeAudit({
        store,
        recordId: id,
        action: 'delete',
        eventDate: (before as { eventDate?: string }).eventDate,
        summary: auditSummary(store, before, 'delete'),
        before: stripForAudit(before),
      });
    }
  };

  const regeneratePlan = async (startDate: string, raceDate: string) => {
    const existing = (await getAll('plannedWorkouts')) as PlannedWorkout[];
    // Days the athlete has edited or moved by hand keep their manual version;
    // only generated (seed) sessions are rebuilt. Actual logs live in other
    // stores and are never touched here.
    const manualDates = new Set(existing.filter((w) => w.source !== 'seed').map((w) => w.eventDate));
    for (const w of existing) {
      if (w.source === 'seed') await dbDelete('plannedWorkouts', w.id);
    }
    const plan = generatePlan({ startDate, raceDate }).filter((w) => !manualDates.has(w.eventDate));
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
    audit,
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
