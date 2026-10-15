import type { IDBPDatabase } from 'idb';
import { uid } from '../db/database';

// Community writes that failed (offline, server down) wait here and are
// replayed in order when the connection returns. Health data never goes here.

export const OFFLINE_QUEUE_STORE = 'offlineQueue';
const DEFAULT_MAX_RETRIES = 5;

export interface OfflineQueueEntry<P = unknown> {
  id: string;
  operation: string;
  payload: P;
  createdAt: string; // ISO datetime, strictly increasing within a session
  retryCount: number;
  maxRetries: number;
  lastError?: string;
}

// Two writes in the same millisecond still replay in the order they were made.
let lastStamp = 0;
function nextCreatedAt(): string {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return new Date(lastStamp).toISOString();
}

export async function enqueue<P>(
  db: IDBPDatabase,
  operation: string,
  payload: P,
  maxRetries = DEFAULT_MAX_RETRIES,
): Promise<string> {
  const entry: OfflineQueueEntry<P> = {
    id: uid(),
    operation,
    payload,
    createdAt: nextCreatedAt(),
    retryCount: 0,
    maxRetries,
  };
  await db.put(OFFLINE_QUEUE_STORE, entry);
  return entry.id;
}

export async function dequeue(db: IDBPDatabase, id: string): Promise<void> {
  await db.delete(OFFLINE_QUEUE_STORE, id);
}

/** All entries, oldest first. */
export async function getAll(db: IDBPDatabase): Promise<OfflineQueueEntry[]> {
  const entries = (await db.getAll(OFFLINE_QUEUE_STORE)) as OfflineQueueEntry[];
  return entries.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export async function incrementRetry(
  db: IDBPDatabase,
  id: string,
  error: unknown,
): Promise<OfflineQueueEntry | null> {
  const entry = (await db.get(OFFLINE_QUEUE_STORE, id)) as OfflineQueueEntry | undefined;
  if (!entry) return null;
  const updated: OfflineQueueEntry = {
    ...entry,
    retryCount: entry.retryCount + 1,
    lastError: error instanceof Error ? error.message : String(error),
  };
  await db.put(OFFLINE_QUEUE_STORE, updated);
  return updated;
}

/** Entries that used up their retries and will not be replayed automatically. */
export async function getDeadLetters(db: IDBPDatabase): Promise<OfflineQueueEntry[]> {
  return (await getAll(db)).filter((e) => e.retryCount >= e.maxRetries);
}

export async function clearDeadLetters(db: IDBPDatabase): Promise<void> {
  const dead = await getDeadLetters(db);
  const tx = db.transaction(OFFLINE_QUEUE_STORE, 'readwrite');
  await Promise.all(dead.map((e) => tx.store.delete(e.id)));
  await tx.done;
}
