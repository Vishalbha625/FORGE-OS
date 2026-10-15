import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fakeSupabase, argsOf, methods, type RecordedQuery, type FakeResponse } from './fakeSupabase';

vi.mock('../lib/supabase', () => ({ getSupabase: vi.fn() }));

import { getSupabase } from '../lib/supabase';
import { supabaseCircuit } from '../lib/circuitBreaker';
import {
  blockUser, clearPhotoUrlCache, createPost, fetchFeed, getCachedPhotoUrl, getProfile, parseCursor,
  photoUrlCacheSize, toggleKudos, NOT_CONFIGURED,
} from '../lib/communityService';

const mocked = vi.mocked(getSupabase);
const ME = '11111111-1111-1111-1111-111111111111';
const profileRow = { id: ME, display_name: 'Vishal', bio: null, goals: ['hyrox'], avatar_path: null, created_at: '2026-10-01T00:00:00+00:00' };
const postRow = (id: string, createdAt: string, extra: Record<string, unknown> = {}) => ({
  id, author_id: ME, event_date: '2026-10-15', title: 'Sled push', activity_type: 'HYROX', caption: null,
  distance_km: '5.20', duration_sec: 1800, pace_sec_per_km: null, elevation_m: null, station_detail: null,
  route_text: null, photo_path: null, is_pr: false, visibility: 'public', created_at: createdAt, updated_at: createdAt,
  author: profileRow, kudos: [{ count: 3 }], comments: [{ count: 1 }], my_kudos: [{ user_id: ME }], ...extra,
});
const okRes = (data: unknown = null, status = 200): FakeResponse => ({ data, error: null, status });

function use(respond: (q: RecordedQuery) => FakeResponse) {
  const fake = fakeSupabase(respond);
  mocked.mockReturnValue(fake.client);
  return fake;
}

beforeEach(() => {
  mocked.mockReset();
  supabaseCircuit.reset();
  clearPhotoUrlCache();
});
afterEach(() => vi.restoreAllMocks());

describe('communityService', () => {
  it('sanitizes the title (and caption) before inserting a post', async () => {
    const { queries } = use((q) => (methods(q).includes('insert') ? okRes(null, 201) : okRes(postRow('p', '2026-10-15T06:00:00.123456+00:00'))));
    const res = await createPost(ME, {
      title: '<b>Sled</b>\n\n push <script>alert(1)</script>',
      activity_type: 'HYROX',
      caption: '<img src=x onerror=alert(1)>Felt strong',
      visibility: 'public',
    });
    expect(res.error).toBeNull();
    const inserted = argsOf(queries.find((q) => methods(q).includes('insert')), 'insert')?.[0] as Record<string, unknown>;
    expect(inserted.title).toBe('Sled push');
    expect(inserted.caption).toBe('Felt strong');
    expect(inserted.author_id).toBe(ME);
    expect(inserted.distance_km).toBeUndefined(); // missing stays missing, never 0
  });

  it('returns { data, error: null } on success and { data: null, error } on failure', async () => {
    use(() => okRes(profileRow));
    expect(await getProfile(ME)).toEqual({ data: { id: ME, display_name: 'Vishal', bio: undefined, goals: ['hyrox'], avatar_path: undefined, created_at: profileRow.created_at }, error: null });

    use(() => ({ data: null, error: { message: 'permission denied', code: '42501' }, status: 403 }));
    expect(await getProfile(ME)).toEqual({ data: null, error: "You don't have permission to do that." });

    mocked.mockReturnValue(null);
    expect(await getProfile(ME)).toEqual({ data: null, error: NOT_CONFIGURED });
  });

  it('reuses a cached photo URL instead of signing it again', async () => {
    const { bucket } = use(() => okRes());
    const [a, b] = await Promise.all([getCachedPhotoUrl(`${ME}/p1`), getCachedPhotoUrl(`${ME}/p1`)]);
    const c = await getCachedPhotoUrl(`${ME}/p1`);
    expect(a).toBe(b);
    expect(c).toBe(a);
    expect(bucket.createSignedUrl).toHaveBeenCalledTimes(1);
    expect(bucket.createSignedUrl).toHaveBeenCalledWith(`${ME}/p1/thumb.webp`, 86400);
    await getCachedPhotoUrl(`${ME}/p1`, 'full');
    expect(bucket.createSignedUrl).toHaveBeenCalledTimes(2);
  });

  it('pages the feed with a stable (created_at, id) cursor', async () => {
    const rows = [
      postRow('cccccccc-0000-4000-8000-000000000003', '2026-10-15T08:00:00.300001+00:00'),
      postRow('bbbbbbbb-0000-4000-8000-000000000002', '2026-10-15T08:00:00.200002+00:00'),
      postRow('aaaaaaaa-0000-4000-8000-000000000001', '2026-10-15T08:00:00.100003+00:00'),
    ];
    const { queries: all } = use((q) => (q.table === 'follows' ? okRes([]) : okRes(rows)));
    const page = await fetchFeed(ME, undefined, 2);
    const queries = all.filter((q) => q.table === 'posts');
    expect(page.data?.data.map((p) => p.id)).toEqual([rows[0].id, rows[1].id]);
    expect(page.data?.hasMore).toBe(true);
    expect(page.data?.nextCursor).toBe(`${rows[1].created_at}|${rows[1].id}`); // microseconds kept
    expect(argsOf(queries[0], 'limit')).toEqual([3]); // pageSize + 1
    expect(argsOf(queries[0], 'or')).toEqual([`visibility.eq.public,author_id.eq.${ME}`]);

    await fetchFeed(ME, page.data!.nextCursor!, 2, []);
    const ors = all.filter((q) => q.table === 'posts')[1].calls.filter(([m]) => m === 'or').map(([, a]) => a[0]);
    expect(ors[1]).toBe(`created_at.lt."${rows[1].created_at}",and(created_at.eq."${rows[1].created_at}",id.lt.${rows[1].id})`);

    const post = page.data!.data[0];
    expect(post).toMatchObject({ kudos_count: 3, comment_count: 1, user_has_kudosed: true, distance_km: 5.2 });
    expect(post.caption).toBeUndefined();
    expect(parseCursor('garbage')).toBeNull();
    expect((await fetchFeed(ME, 'not-a-cursor')).error).toBe('Invalid page cursor.');
  });

  it('client errors never trip the circuit; server errors on writes are retried', async () => {
    use(() => ({ data: null, error: { message: 'denied', code: '42501' }, status: 403 }));
    for (let i = 0; i < 5; i++) await getProfile(ME);
    expect(supabaseCircuit.getState()).toBe('CLOSED');

    let attempts = 0;
    use(() => (++attempts === 1 ? { data: null, error: { message: 'upstream' }, status: 503 } : okRes(null, 201)));
    expect(await toggleKudos('post-1', ME, false)).toEqual({ data: true, error: null });
    expect(attempts).toBe(2);
  });

  it('treats a duplicate kudos as already given', async () => {
    use(() => ({ data: null, error: { message: 'duplicate key', code: '23505' }, status: 409 }));
    expect(await toggleKudos('post-1', ME, false)).toEqual({ data: true, error: null });
  });

  it('removes follows both ways, in order, before inserting the block', async () => {
    const OTHER = '22222222-2222-2222-2222-222222222222';
    const { queries } = use(() => okRes(null, 204));
    expect((await blockUser(ME, OTHER)).error).toBeNull();
    expect(queries.map((q) => `${q.table}:${methods(q)[0]}`)).toEqual(['follows:delete', 'follows:delete', 'blocks:insert']);
    expect(queries[0].calls.filter(([m]) => m === 'eq').map(([, a]) => a)).toEqual([['follower_id', ME], ['followee_id', OTHER]]);
    expect(queries[1].calls.filter(([m]) => m === 'eq').map(([, a]) => a)).toEqual([['follower_id', OTHER], ['followee_id', ME]]);
  });

  it('keeps at most 200 photo URLs and evicts the one expiring first', async () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now++);
    const { bucket } = use(() => okRes());
    for (let i = 0; i <= 200; i++) await getCachedPhotoUrl(`${ME}/post-${i}`);
    expect(photoUrlCacheSize()).toBe(200);
    await getCachedPhotoUrl(`${ME}/post-200`); // newest: still cached
    expect(bucket.createSignedUrl).toHaveBeenCalledTimes(201);
    await getCachedPhotoUrl(`${ME}/post-0`); // oldest: evicted, signed again
    expect(bucket.createSignedUrl).toHaveBeenCalledTimes(202);
  });
});
