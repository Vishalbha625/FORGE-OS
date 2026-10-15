import { describe, it, expect, vi, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SignJWT } from 'jose';

// Runs communityService against a real PostgREST over the real schema and RLS.
// Skipped unless FORGE_API_URL is set; start the stack with supabase/tests/api.sh.

// The app has no Node type definitions (and adds none, R17): declare what this file uses.
declare const process: { env: Record<string, string | undefined> };
type ExecFileSync = (file: string, args: string[]) => unknown;
const nodeModule = 'node:child_process';
const runPsql = async (sql: string, url: string) => {
  const { execFileSync } = (await import(/* @vite-ignore */ nodeModule)) as { execFileSync: ExecFileSync };
  execFileSync('psql', [url, '-q', '-c', sql]);
};

const API = process.env.FORGE_API_URL;
const SECRET = new TextEncoder().encode(process.env.FORGE_JWT_SECRET ?? '');
const PG = process.env.FORGE_PG_URL;
const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';

let current: SupabaseClient | null = null;
vi.mock('../lib/supabase', () => ({ getSupabase: () => current }));

import * as svc from '../lib/communityService';

const tokens: Record<string, string> = {};
const sign = (claims: Record<string, string>) => new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).setExpirationTime('1h').sign(SECRET);
async function as(userId: string) {
  const anon = await sign({ role: 'anon' });
  current = createClient(API!, anon, { accessToken: async () => tokens[userId] });
}
const must = <T>(r: svc.ServiceResult<T>): T => {
  expect(r.error).toBeNull();
  return r.data as T;
};
async function allPages(userId: string, pageSize: number) {
  const seen: svc.CommunityPost[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 50; i++) {
    const page = must(await svc.fetchFeed(userId, cursor, pageSize));
    seen.push(...page.data);
    if (!page.hasMore) break;
    cursor = page.nextCursor ?? undefined;
  }
  return seen;
}

describe.skipIf(!API)('communityService against PostgREST + RLS', () => {
  let a1: svc.CommunityPost;
  let a2: svc.CommunityPost;

  beforeAll(async () => {
    tokens[ALICE] = await sign({ sub: ALICE, role: 'authenticated' });
    tokens[BOB] = await sign({ sub: BOB, role: 'authenticated' });
  });

  it('creates posts and returns them with author, counts and clean text', async () => {
    await as(ALICE);
    a1 = must(await svc.createPost(ALICE, { title: 'Sled <b>push</b> PB', activity_type: 'HYROX', visibility: 'public', distance_km: 1, is_pr: true }));
    a2 = must(await svc.createPost(ALICE, { title: 'Private weigh-in', activity_type: 'Other', caption: '<script>x</script>Only me', visibility: 'private' }));
    expect(a1).toMatchObject({ title: 'Sled push PB', author: { display_name: 'Alice' }, kudos_count: 0, comment_count: 0, user_has_kudosed: false, is_pr: true, distance_km: 1 });
    expect(a1.caption).toBeUndefined();
    expect(a2.caption).toBe('Only me');
  });

  it('feed: strangers see public posts only; authors see their own', async () => {
    await as(BOB);
    expect(must(await svc.fetchFeed(BOB)).data.map((p) => p.id)).toEqual([a1.id]);
    await as(ALICE);
    expect(must(await svc.fetchFeed(ALICE)).data.map((p) => p.id)).toEqual([a2.id, a1.id]);
  });

  it('kudos: counted for everyone, flagged only for the giver, duplicates are fine', async () => {
    await as(BOB);
    expect(must(await svc.toggleKudos(a1.id, BOB, false))).toBe(true);
    expect(must(await svc.toggleKudos(a1.id, BOB, false))).toBe(true);
    expect(must(await svc.fetchFeed(BOB)).data[0]).toMatchObject({ kudos_count: 1, user_has_kudosed: true });
    await as(ALICE);
    expect(must(await svc.getPost(a1.id, ALICE))).toMatchObject({ kudos_count: 1, user_has_kudosed: false });
  });

  it('comments: sanitized, joined with the author, oldest first, counted', async () => {
    await as(BOB);
    const c = must(await svc.addComment(a1.id, BOB, '<b>Great</b> work'));
    expect(c).toMatchObject({ body: 'Great work', author: { display_name: 'Bob' } });
    await svc.addComment(a1.id, BOB, 'Second');
    await as(ALICE);
    const list = must(await svc.fetchComments(a1.id, undefined, 1));
    expect(list.data.map((x) => x.body)).toEqual(['Great work']);
    expect(must(await svc.fetchComments(a1.id, list.nextCursor!, 1)).data.map((x) => x.body)).toEqual(['Second']);
    expect(must(await svc.getPost(a1.id, ALICE)).comment_count).toBe(2);
    await as(BOB);
    expect((await svc.deleteComment(c.id, BOB)).error).toBeNull();
    expect(must(await svc.getPost(a1.id, BOB)).comment_count).toBe(1);
  });

  it('pages through rows sharing one timestamp without gaps or repeats', async () => {
    if (PG) {
      await runPsql(
        `insert into public.posts (author_id, event_date, title, activity_type, visibility, created_at)
         select '${BOB}', '2026-10-15', 'Bulk ' || g, 'Run', 'public', '2026-10-15 06:00:00.123456+00' from generate_series(1, 25) g`,
        PG,
      );
    }
    await as(BOB);
    const all = await allPages(BOB, 7);
    const ids = all.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(PG ? 26 : 1);
    const keys = all.map((p) => `${p.created_at}|${p.id}`);
    expect([...keys].sort().reverse()).toEqual(keys);
  });

  it('follows: request, see pending, accept, list both sides', async () => {
    await as(BOB);
    expect((await svc.requestFollow(BOB, ALICE)).error).toBeNull();
    expect((await svc.requestFollow(BOB, ALICE)).error).toBeNull();
    await as(ALICE);
    expect(must(await svc.getPendingFollowRequests(ALICE)).map((f) => f.profile.display_name)).toEqual(['Bob']);
    expect((await svc.acceptFollow(BOB, ALICE)).error).toBeNull();
    expect(must(await svc.getFollowers(ALICE)).map((f) => f.profile.display_name)).toEqual(['Bob']);
    await as(BOB);
    expect(must(await svc.getFollowing(BOB)).map((f) => f.profile.display_name)).toEqual(['Alice']);
  });

  it('updates: authors edit and clear fields; others cannot', async () => {
    await as(ALICE);
    const edited = must(await svc.updatePost(a1.id, ALICE, { title: 'Sled push PB!', caption: '' }));
    expect(edited.title).toBe('Sled push PB!');
    await as(BOB);
    await svc.updatePost(a1.id, BOB, { title: 'Hacked' });
    expect(must(await svc.getPost(a1.id, BOB)).title).toBe('Sled push PB!');
    expect((await svc.deletePost(a1.id, BOB)).error).toBeNull();
    expect(must(await svc.getPost(a1.id, BOB)).id).toBe(a1.id); // RLS: still there
  });

  it('profiles and reports', async () => {
    await as(ALICE);
    expect(must(await svc.updateProfile(ALICE, { bio: '<i>HYROX</i> Men Open', goals: ['hyrox', ' run '] }))).toMatchObject({ bio: 'HYROX Men Open', goals: ['hyrox', 'run'] });
    await as(BOB);
    expect(must(await svc.getProfile(ALICE)).bio).toBe('HYROX Men Open');
    expect((await svc.reportContent(BOB, { postId: a1.id }, 'Spam')).error).toBeNull();
  });

  it('blocking removes follows both ways and hides posts; unblocking restores them', async () => {
    await as(ALICE);
    expect((await svc.blockUser(ALICE, BOB)).error).toBeNull();
    expect(must(await svc.getFollowers(ALICE))).toEqual([]);
    await as(BOB);
    expect(must(await svc.fetchFeed(BOB, undefined, 50)).data.some((p) => p.author_id === ALICE)).toBe(false);
    await as(ALICE);
    expect((await svc.unblockUser(ALICE, BOB)).error).toBeNull();
    await as(BOB);
    expect(must(await svc.fetchFeed(BOB, undefined, 50)).data.some((p) => p.id === a1.id)).toBe(true);
  });

  it('deletes a post (photo cleanup is best effort)', async () => {
    await as(ALICE);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await svc.deletePost(a2.id, ALICE)).error).toBeNull();
    expect((await svc.getPost(a2.id, ALICE)).error).toBe('Post not found.');
  });
});
