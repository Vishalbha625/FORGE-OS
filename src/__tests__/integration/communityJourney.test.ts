import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/supabase', () => ({ getSupabase: vi.fn() }));
vi.mock('../../lib/imageCompressor', () => {
  const out = (kb: number) => ({ blob: new Blob([new Uint8Array(kb * 1024)], { type: 'image/webp' }), width: 800, height: 600, sizeKB: kb, type: 'image/webp', withinLimit: true });
  return { compressThumb: vi.fn(async () => out(40)), compressFull: vi.fn(async () => out(180)), compressAvatar: vi.fn() };
});

import { getSupabase } from '../../lib/supabase';
import { supabaseCircuit } from '../../lib/circuitBreaker';
import { addComment, clearPhotoUrlCache, createPost, deleteComment, fetchComments, fetchFeed, getCachedPhotoUrl, getPost, toggleKudos } from '../../lib/communityService';
import { deduplicatedMutation } from '../../lib/deduplicatedMutation';
import { processOfflineQueue, queueCommunityWrite } from '../../lib/offlineQueueProcessor';
import { getAll as queued } from '../../lib/offlineQueue';
import { getDB } from '../../db/database';
import { FakeBackend } from './fakeBackend';
import { RIYA, VISHAL, freshDevice } from './journeyFixtures';

// Posting, photos, kudos, comments and offline posting, through the service
// layer the screens use, against a backend that keeps state between steps.

let backend: FakeBackend;

beforeEach(async () => {
  backend = new FakeBackend();
  backend.addUser(VISHAL, 'Vishal Bhardwaj');
  backend.addUser(RIYA, 'Riya Sharma');
  vi.mocked(getSupabase).mockReturnValue(backend.client());
  supabaseCircuit.reset();
  clearPhotoUrlCache();
  await freshDevice();
});
afterEach(() => vi.unstubAllGlobals());

describe('community journey', () => {
  it('creates a public post that appears in the feed, cleaned of markup', async () => {
    backend.as(VISHAL);
    const created = await createPost(VISHAL, { title: '<b>Sled push</b> PB <script>alert(1)</script>', activity_type: '  HYROX ', visibility: 'public', event_date: '2026-10-15' });
    expect(created.error).toBeNull();

    backend.as(RIYA);
    const feed = await fetchFeed(RIYA);
    expect(feed.data?.data).toHaveLength(1);
    expect(feed.data?.data[0]).toMatchObject({ id: created.data?.id, title: 'Sled push PB', activity_type: 'HYROX', author: { display_name: 'Vishal Bhardwaj' }, kudos_count: 0 });
  });

  it('uploads both photo sizes to your own folder and stores the folder on the post', async () => {
    backend.as(VISHAL);
    const created = await createPost(VISHAL, { title: 'Long run', activity_type: 'Run', visibility: 'public', photo: new Blob(['jpeg'], { type: 'image/jpeg' }) });
    const id = created.data?.id;
    expect(backend.calls('storage', 'upload')).toHaveLength(2);
    expect([...backend.objects.keys()].sort()).toEqual([`${VISHAL}/${id}/full.webp`, `${VISHAL}/${id}/thumb.webp`]);
    expect(created.data?.photo_path).toBe(`${VISHAL}/${id}`);

    backend.as(RIYA);
    expect(await getCachedPhotoUrl(created.data!.photo_path!)).toBe(`https://files.test/${VISHAL}/${id}/thumb.webp?sig=1`);
  });

  it('gives and removes kudos; a double tap sends one request', async () => {
    backend.as(VISHAL);
    const post = (await createPost(VISHAL, { title: 'Wall balls', activity_type: 'HYROX', visibility: 'public' })).data!;

    backend.as(RIYA);
    const key = `kudos-${post.id}`;
    const [first, second] = await Promise.all([deduplicatedMutation(key, () => toggleKudos(post.id, RIYA, false)), deduplicatedMutation(key, () => toggleKudos(post.id, RIYA, false))]);
    expect(first?.data).toBe(true);
    expect(second).toBeNull(); // the second tap was dropped while the first was in flight
    expect(backend.calls('kudos', 'insert')).toHaveLength(1);
    expect((await getPost(post.id, RIYA)).data).toMatchObject({ kudos_count: 1, user_has_kudosed: true });

    await deduplicatedMutation(key, () => toggleKudos(post.id, RIYA, true));
    expect((await getPost(post.id, RIYA)).data).toMatchObject({ kudos_count: 0, user_has_kudosed: false });
  });

  it('adds a comment that shows on the post, then deletes it', async () => {
    backend.as(VISHAL);
    const post = (await createPost(VISHAL, { title: 'Tempo 10k', activity_type: 'Run', visibility: 'public' })).data!;

    backend.as(RIYA);
    const added = await addComment(post.id, RIYA, 'Strong finish! <img src=x onerror=alert(1)>');
    expect(added.data).toMatchObject({ body: 'Strong finish!', author: { display_name: 'Riya Sharma' } });
    expect((await fetchComments(post.id)).data?.data.map((c) => c.body)).toEqual(['Strong finish!']);
    expect((await getPost(post.id, RIYA)).data?.comment_count).toBe(1);

    expect((await deleteComment(added.data!.id, RIYA)).error).toBeNull();
    expect((await fetchComments(post.id)).data?.data).toEqual([]);
    expect((await getPost(post.id, RIYA)).data?.comment_count).toBe(0);
  });

  it('queues a post made offline and publishes it once, when the connection is back', async () => {
    const db = await getDB();
    backend.as(VISHAL);
    const id = crypto.randomUUID();
    await queueCommunityWrite(db, 'createPost', { userId: VISHAL, input: { id, title: 'Offline sled session', activity_type: 'HYROX', visibility: 'public' } });

    vi.stubGlobal('navigator', { onLine: false });
    expect(await processOfflineQueue(db, VISHAL)).toMatchObject({ processed: 0 });
    expect(await queued(db)).toHaveLength(1);
    expect(backend.tables.posts).toHaveLength(0);

    vi.stubGlobal('navigator', { onLine: true });
    expect(await processOfflineQueue(db, VISHAL)).toMatchObject({ processed: 1, failed: 0 });
    expect(await queued(db)).toHaveLength(0);
    expect((await fetchFeed(VISHAL)).data?.data.map((p) => [p.id, p.title])).toEqual([[id, 'Offline sled session']]);

    // A replay of the same write can't post it twice: the id was fixed when it was queued.
    await queueCommunityWrite(db, 'createPost', { userId: VISHAL, input: { id, title: 'Offline sled session', activity_type: 'HYROX', visibility: 'public' } });
    expect(await processOfflineQueue(db, VISHAL)).toMatchObject({ processed: 1 });
    expect(backend.tables.posts).toHaveLength(1);
  });
});
