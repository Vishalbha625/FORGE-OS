import { openDB, type IDBPDatabase } from 'idb';
import type { StoreMap, StoreName } from './types';

const DB_NAME = 'forge-os';
// v2 adds the `audit` store. Upgrades are additive: existing data is kept.
const DB_VERSION = 2;

// Stores keyed by `id`; most also index by eventDate for history queries.
const DATED_STORES: StoreName[] = [
  'plannedWorkouts',
  'runs',
  'strength',
  'hyrox',
  'nutrition',
  'water',
  'sleep',
  'steps',
  'body',
  'recovery',
  'social',
];
const SINGLETON_STORES: StoreName[] = ['profile', 'settings'];
// Keyed by id, no event-date index.
const PLAIN_STORES: StoreName[] = ['audit'];

// Use an untyped idb handle; store names are plain strings. Record shapes are
// enforced by the typed CRUD wrappers below (StoreMap), not the raw DB handle.
let dbp: Promise<IDBPDatabase> | null = null;

export function getDB(): Promise<IDBPDatabase> {
  if (!dbp) {
    dbp = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        for (const name of [...DATED_STORES, ...SINGLETON_STORES, ...PLAIN_STORES]) {
          if (!db.objectStoreNames.contains(name)) {
            const store = db.createObjectStore(name, { keyPath: 'id' });
            if (DATED_STORES.includes(name)) {
              store.createIndex('eventDate', 'eventDate');
            }
          }
        }
      },
    });
  }
  return dbp;
}

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export function nowISO(): string {
  return new Date().toISOString();
}

// ── Generic CRUD ──────────────────────────────────────────────────────────────

export async function putRecord<K extends StoreName>(
  store: K,
  value: StoreMap[K],
): Promise<StoreMap[K]> {
  const db = await getDB();
  await db.put(store, value as never);
  return value;
}

export async function getRecord<K extends StoreName>(
  store: K,
  id: string,
): Promise<StoreMap[K] | undefined> {
  const db = await getDB();
  return (await db.get(store, id)) as StoreMap[K] | undefined;
}

export async function getAll<K extends StoreName>(store: K): Promise<StoreMap[K][]> {
  const db = await getDB();
  return (await db.getAll(store)) as StoreMap[K][];
}

export async function deleteRecord<K extends StoreName>(store: K, id: string): Promise<void> {
  const db = await getDB();
  await db.delete(store, id);
}

export async function clearStore<K extends StoreName>(store: K): Promise<void> {
  const db = await getDB();
  await db.clear(store);
}

export async function bulkPut<K extends StoreName>(
  store: K,
  values: StoreMap[K][],
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(store, 'readwrite');
  await Promise.all(values.map((v) => tx.store.put(v as never)));
  await tx.done;
}

/** Records for a store within an inclusive date range, sorted by eventDate asc. */
export async function getByDateRange<K extends StoreName>(
  store: K,
  fromDate: string,
  toDate: string,
): Promise<StoreMap[K][]> {
  const db = await getDB();
  if (!DATED_STORES.includes(store)) return [];
  const range = IDBKeyRange.bound(fromDate, toDate);
  const result = (await db.getAllFromIndex(store, 'eventDate', range)) as StoreMap[K][];
  return result.sort((a, b) =>
    (a as { eventDate: string }).eventDate.localeCompare((b as { eventDate: string }).eventDate),
  );
}

// ── Export / import / backup ──────────────────────────────────────────────────

export interface BackupFile {
  app: 'forge-os';
  version: number;
  exportedAt: string;
  data: Record<string, unknown[]>;
}

const ALL_STORES: StoreName[] = [...SINGLETON_STORES, ...DATED_STORES, ...PLAIN_STORES];

export async function exportAll(): Promise<BackupFile> {
  const data: Record<string, unknown[]> = {};
  for (const store of ALL_STORES) {
    data[store] = await getAll(store);
  }
  return { app: 'forge-os', version: DB_VERSION, exportedAt: nowISO(), data };
}

export interface ImportResult {
  added: number;
  updated: number;
  skipped: number;
  byStore: Record<string, { added: number; updated: number; skipped: number }>;
}

/**
 * Import a backup. `mode` controls merge behaviour:
 *  - 'merge': add new records, update records whose updatedAt is newer, never
 *    silently duplicate (keyed by id).
 *  - 'replace': wipe each imported store first.
 * Returns a transparent per-store count so nothing is "silently" changed.
 */
export async function importAll(
  file: BackupFile,
  mode: 'merge' | 'replace' = 'merge',
): Promise<ImportResult> {
  if (!file || file.app !== 'forge-os' || !file.data) {
    throw new Error('Not a valid Forge OS backup file.');
  }
  const result: ImportResult = { added: 0, updated: 0, skipped: 0, byStore: {} };

  for (const store of ALL_STORES) {
    const incoming = (file.data[store] as StoreMap[StoreName][] | undefined) ?? [];
    const counts = { added: 0, updated: 0, skipped: 0 };

    if (mode === 'replace' && incoming.length) {
      await clearStore(store);
    }

    // Profile/settings hold exactly one record. Ids differ between installs,
    // so merge by recency rather than id to avoid ending up with two profiles.
    if (SINGLETON_STORES.includes(store) && mode === 'merge') {
      const newest = [...incoming].sort((a, b) =>
        ((b as { updatedAt?: string }).updatedAt ?? '').localeCompare((a as { updatedAt?: string }).updatedAt ?? ''),
      )[0];
      const local = (await getAll(store))[0] as { updatedAt?: string } | undefined;
      if (newest && (!local || ((newest as { updatedAt?: string }).updatedAt ?? '') > (local.updatedAt ?? ''))) {
        await clearStore(store);
        await putRecord(store, newest);
        if (local) counts.updated++;
        else counts.added++;
      } else if (newest) {
        counts.skipped++;
      }
      result.byStore[store] = counts;
      result.added += counts.added;
      result.updated += counts.updated;
      result.skipped += counts.skipped;
      continue;
    }

    const existing = new Map(
      (await getAll(store)).map((r) => [(r as { id: string }).id, r as { updatedAt?: string }]),
    );

    for (const rec of incoming) {
      const id = (rec as { id: string }).id;
      const prev = existing.get(id);
      if (!prev) {
        await putRecord(store, rec);
        counts.added++;
      } else if (mode === 'merge') {
        const prevT = prev.updatedAt ?? '';
        const nextT = (rec as { updatedAt?: string }).updatedAt ?? '';
        if (nextT > prevT) {
          await putRecord(store, rec);
          counts.updated++;
        } else {
          counts.skipped++; // keep local; never overwrite newer data
        }
      } else {
        await putRecord(store, rec);
        counts.updated++;
      }
    }
    result.byStore[store] = counts;
    result.added += counts.added;
    result.updated += counts.updated;
    result.skipped += counts.skipped;
  }
  return result;
}

export async function wipeAll(): Promise<void> {
  for (const store of ALL_STORES) {
    await clearStore(store);
  }
}
