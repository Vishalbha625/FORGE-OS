import type { IDBPDatabase } from 'idb';
import type { CommunityPost } from './communityService';

// The community feed, cached on the device so it shows instantly and offline.
// Community posts only: never health data.

const STORE = 'socialCache';
const META_ID = '__meta__';

export interface FeedCacheMeta {
  lastFetched: string; // ISO datetime
  nextCursor: string | null;
  /** Whose feed this is: a different account on the same device must not see it. */
  userId?: string;
}

interface MetaRecord extends FeedCacheMeta {
  id: typeof META_ID;
}

const newestFirst = (a: CommunityPost, b: CommunityPost) =>
  b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id);

export async function getCachedFeed(db: IDBPDatabase): Promise<CommunityPost[]> {
  const all = (await db.getAll(STORE)) as (CommunityPost | MetaRecord)[];
  return (all.filter((r) => r.id !== META_ID) as CommunityPost[]).sort(newestFirst);
}

/** Replace the cache with a fresh first page. */
export async function setCachedFeed(db: IDBPDatabase, posts: CommunityPost[], nextCursor: string | null, userId?: string): Promise<void> {
  const tx = db.transaction(STORE, 'readwrite');
  await tx.store.clear();
  for (const post of posts) await tx.store.put(post);
  const meta: MetaRecord = { id: META_ID, lastFetched: new Date().toISOString(), nextCursor, userId };
  await tx.store.put(meta);
  await tx.done;
}

/** Upsert posts by id without dropping the rest (background refresh, load more). */
export async function mergeFeedUpdate(db: IDBPDatabase, newPosts: CommunityPost[], nextCursor?: string | null): Promise<void> {
  const tx = db.transaction(STORE, 'readwrite');
  for (const post of newPosts) await tx.store.put(post);
  if (nextCursor !== undefined) {
    const meta = (await tx.store.get(META_ID)) as MetaRecord | undefined;
    if (meta) await tx.store.put({ ...meta, nextCursor });
  }
  await tx.done;
}

export async function removeFromCache(db: IDBPDatabase, postId: string): Promise<void> {
  await db.delete(STORE, postId);
}

export async function getCacheMeta(db: IDBPDatabase): Promise<FeedCacheMeta | null> {
  const meta = (await db.get(STORE, META_ID)) as MetaRecord | undefined;
  if (!meta) return null;
  return { lastFetched: meta.lastFetched, nextCursor: meta.nextCursor, userId: meta.userId };
}

export function isCacheStale(meta: FeedCacheMeta | null, staleTimeMs = 5 * 60 * 1000): boolean {
  if (!meta) return true;
  const fetched = Date.parse(meta.lastFetched);
  return Number.isNaN(fetched) || Date.now() - fetched > staleTimeMs;
}
