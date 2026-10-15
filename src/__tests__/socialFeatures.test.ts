import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeSupabase, argsOf, methods, type RecordedQuery, type FakeResponse } from './fakeSupabase';

vi.mock('../lib/supabase', () => ({ getSupabase: vi.fn() }));
const order: string[] = [];
vi.mock('../lib/imageCompressor', () => ({
  compressThumb: vi.fn(), compressFull: vi.fn(),
  compressAvatar: vi.fn(async () => {
    order.push('compressAvatar');
    return { blob: new Blob(['x'], { type: 'image/webp' }), width: 200, height: 200, sizeKB: 9, type: 'image/webp', withinLimit: true };
  }),
}));

import { getSupabase } from '../lib/supabase';
import { supabaseCircuit } from '../lib/circuitBreaker';
import {
  blockUser, clearPhotoUrlCache, escapeLike, feedVisibilityFilter, getFollowCounts, getFollowStatus, getProfilePosts,
  searchProfiles, uploadAvatar,
} from '../lib/communityService';
import { getDB } from '../db/database';
import { getCachedFeed, mergeFeedUpdate, removeAuthorFromCache } from '../lib/feedCache';
import type { CommunityPost } from '../lib/communityService';

const mocked = vi.mocked(getSupabase);
const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const okRes = (data: unknown = null, status = 200): FakeResponse => ({ data, error: null, status });
const profile = (id: string, name: string) => ({ id, display_name: name, bio: null, goals: [], avatar_path: null, created_at: '2026-10-01T00:00:00+00:00' });
const eqs = (q: RecordedQuery | undefined) => (q?.calls ?? []).filter(([m]) => m === 'eq').map(([, a]) => a);

function use(respond: (q: RecordedQuery) => FakeResponse) {
  const fake = fakeSupabase(respond);
  mocked.mockReturnValue(fake.client);
  return fake;
}

beforeEach(() => {
  mocked.mockReset();
  supabaseCircuit.reset();
  clearPhotoUrlCache();
  order.length = 0;
});

describe('social features', () => {
  it('searchProfiles finds athletes whose name contains the query, never yourself', async () => {
    const { queries } = use(() => okRes([profile(OTHER, 'Vishal B')]));
    const res = await searchProfiles('  vis ', ME);
    expect(res).toEqual({ data: [expect.objectContaining({ id: OTHER, display_name: 'Vishal B', bio: undefined })], error: null });
    expect(argsOf(queries[0], 'ilike')).toEqual(['display_name', '%vis%']);
    expect(argsOf(queries[0], 'neq')).toEqual(['id', ME]);
    expect(argsOf(queries[0], 'limit')).toEqual([20]);
  });

  it('searchProfiles returns an empty list for no match, and sends nothing for a blank query', async () => {
    const { queries } = use(() => okRes([]));
    expect(await searchProfiles('zzz', ME)).toEqual({ data: [], error: null });
    expect(await searchProfiles('   ', ME)).toEqual({ data: [], error: null });
    expect(queries).toHaveLength(1);
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\'); // typed wildcards are literal text
  });

  it("getFollowStatus is 'none' when there is no follow row", async () => {
    const { queries } = use(() => okRes(null));
    expect(await getFollowStatus(ME, OTHER)).toEqual({ data: 'none', error: null });
    expect(eqs(queries[0])).toEqual([['follower_id', ME], ['followee_id', OTHER]]);
  });

  it("getFollowStatus is 'accepted' (or 'pending') from the follow row", async () => {
    use(() => okRes({ status: 'accepted' }));
    expect(await getFollowStatus(ME, OTHER)).toEqual({ data: 'accepted', error: null });
    use(() => okRes({ status: 'pending' }));
    expect((await getFollowStatus(ME, OTHER)).data).toBe('pending');
  });

  it('blockUser removes follows both ways before inserting the block', async () => {
    const { queries } = use(() => okRes(null, 204));
    expect((await blockUser(ME, OTHER)).error).toBeNull();
    expect(queries.map((q) => `${q.table}:${methods(q)[0]}`)).toEqual(['follows:delete', 'follows:delete', 'blocks:insert']);
    expect(eqs(queries[0])).toEqual([['follower_id', ME], ['followee_id', OTHER]]);
    expect(eqs(queries[1])).toEqual([['follower_id', OTHER], ['followee_id', ME]]);
  });

  it('uploadAvatar compresses first, uploads to <user>/avatar.webp, then saves the path', async () => {
    const { bucket, queries } = use(() => okRes(null, 204));
    bucket.upload.mockImplementation(async (path: string) => {
      order.push('upload');
      return { data: { path }, error: null };
    });
    expect(await uploadAvatar(ME, new Blob(['raw photo']))).toEqual({ data: `${ME}/avatar.webp`, error: null });
    expect(order).toEqual(['compressAvatar', 'upload']);
    expect(bucket.upload).toHaveBeenCalledWith(`${ME}/avatar.webp`, expect.any(Blob), expect.objectContaining({ upsert: true, contentType: 'image/webp' }));
    const update = queries.find((q) => q.table === 'profiles');
    expect(argsOf(update, 'update')).toEqual([{ avatar_path: `${ME}/avatar.webp` }]);
    expect(eqs(update)).toEqual([['id', ME]]);
  });
});

describe('followers-only posts', () => {
  it('feed filter: public, your own, and followers-only posts of people you follow', () => {
    expect(feedVisibilityFilter(ME, [])).toBe(`visibility.eq.public,author_id.eq.${ME}`);
    expect(feedVisibilityFilter(ME, [OTHER, 'not-a-uuid'])).toBe(`visibility.eq.public,author_id.eq.${ME},and(visibility.eq.followers,author_id.in.(${OTHER}))`);
    // A very long list would overflow the URL: RLS limits followers-only posts to followers anyway.
    const many = Array.from({ length: 151 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    expect(feedVisibilityFilter(ME, many)).toBe(`visibility.in.(public,followers),author_id.eq.${ME}`);
  });

  it('profile posts: all for you, public and followers-only for followers, public for others', async () => {
    const cases: [string, unknown, string[]][] = [
      [ME, null, ['public', 'followers', 'private']],
      [OTHER, { status: 'accepted' }, ['public', 'followers']],
      [OTHER, { status: 'pending' }, ['public']],
      [OTHER, null, ['public']],
    ];
    for (const [profileId, follow, visible] of cases) {
      const { queries } = use((q) => (q.table === 'follows' ? okRes(follow) : okRes([])));
      expect((await getProfilePosts(profileId, ME)).error).toBeNull();
      const posts = queries.find((q) => q.table === 'posts');
      expect(argsOf(posts, 'in')).toEqual(['visibility', visible]);
      expect(eqs(posts)[0]).toEqual(['author_id', profileId]);
    }
  });

  it('follow counts come from one database function call', async () => {
    const { queries } = use(() => okRes([{ followers: 12, following: 3 }]));
    expect(await getFollowCounts(OTHER)).toEqual({ data: { followers: 12, following: 3 }, error: null });
    expect(queries.map((q) => q.table)).toEqual(['rpc:profile_follow_counts']);
    expect(argsOf(queries[0], 'rpc')).toEqual([{ p_user: OTHER }]);
  });

  it("blocking someone drops their posts from the cached feed", async () => {
    const db = await getDB();
    const post = (id: string, author: string) => ({ id, author_id: author, created_at: `2026-10-15T0${id.length}:00:00Z` }) as unknown as CommunityPost;
    await mergeFeedUpdate(db, [post('a', OTHER), post('bb', ME), post('ccc', OTHER)]);
    expect(await removeAuthorFromCache(db, OTHER)).toBe(2);
    expect((await getCachedFeed(db)).map((p) => p.id)).toEqual(['bb']);
  });
});
