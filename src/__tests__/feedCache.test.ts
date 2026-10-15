import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { getDB } from '../db/database';
import { getCachedFeed, setCachedFeed, mergeFeedUpdate, removeFromCache, getCacheMeta, isCacheStale } from '../lib/feedCache';
import type { CommunityPost } from '../lib/communityService';

const post = (id: string, created_at: string): CommunityPost => ({
  id, author_id: 'u1', event_date: '2026-10-15', title: `Post ${id}`, activity_type: 'Run', is_pr: false,
  visibility: 'public', created_at, updated_at: created_at, kudos_count: 0, comment_count: 0, user_has_kudosed: false,
  author: { id: 'u1', display_name: 'Vishal', goals: [], created_at: '2026-10-01T00:00:00Z' },
});

beforeEach(async () => {
  await (await getDB()).clear('socialCache');
});
afterEach(() => vi.restoreAllMocks());

describe('feed cache', () => {
  it('returns cached posts newest first, without the meta record', async () => {
    const db = await getDB();
    await mergeFeedUpdate(db, [post('b', '2026-10-14T10:00:00Z'), post('c', '2026-10-15T10:00:00Z'), post('a', '2026-10-13T10:00:00Z')]);
    await setCachedFeed(db, await getCachedFeed(db), null);
    expect((await getCachedFeed(db)).map((p) => p.id)).toEqual(['c', 'b', 'a']);
  });

  it('round-trips a page of 5 and replaces the previous cache', async () => {
    const db = await getDB();
    await setCachedFeed(db, [post('old', '2026-10-01T00:00:00Z')], null);
    const page = [1, 2, 3, 4, 5].map((n) => post(`p${n}`, `2026-10-1${n}T00:00:00Z`));
    await setCachedFeed(db, page, 'cursor-1', 'u1');
    const cached = await getCachedFeed(db);
    expect(cached).toHaveLength(5);
    expect(cached.map((p) => p.id)).toEqual(['p5', 'p4', 'p3', 'p2', 'p1']);
    expect(await getCacheMeta(db)).toMatchObject({ nextCursor: 'cursor-1', userId: 'u1' });
  });

  it('is stale with no meta or when older than the stale time', () => {
    const now = Date.parse('2026-10-15T12:00:00Z');
    vi.spyOn(Date, 'now').mockReturnValue(now);
    expect(isCacheStale(null)).toBe(true);
    expect(isCacheStale({ lastFetched: '2026-10-15T11:56:00Z', nextCursor: null })).toBe(false); // 4 min
    expect(isCacheStale({ lastFetched: '2026-10-15T11:54:00Z', nextCursor: null })).toBe(true); // 6 min
    expect(isCacheStale({ lastFetched: '2026-10-15T11:59:00Z', nextCursor: null }, 30_000)).toBe(true);
  });

  it('merges updates in place, moves the cursor, and removes single posts', async () => {
    const db = await getDB();
    await setCachedFeed(db, [post('a', '2026-10-13T00:00:00Z')], 'c1', 'u1');
    await mergeFeedUpdate(db, [{ ...post('a', '2026-10-13T00:00:00Z'), kudos_count: 4 }, post('b', '2026-10-12T00:00:00Z')], 'c2');
    expect((await getCachedFeed(db)).map((p) => [p.id, p.kudos_count])).toEqual([['a', 4], ['b', 0]]);
    expect((await getCacheMeta(db))?.nextCursor).toBe('c2');
    await removeFromCache(db, 'a');
    expect((await getCachedFeed(db)).map((p) => p.id)).toEqual(['b']);
  });
});
