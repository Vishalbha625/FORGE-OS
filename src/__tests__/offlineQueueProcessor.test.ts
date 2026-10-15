import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

vi.mock('../lib/communityService', () => ({
  createPost: vi.fn(), toggleKudos: vi.fn(), addComment: vi.fn(), deletePost: vi.fn(), deleteComment: vi.fn(),
}));

import { getDB } from '../db/database';
import { enqueue, dequeue, getAll } from '../lib/offlineQueue';
import { processOfflineQueue, queueCommunityWrite, setupOfflineQueueListener } from '../lib/offlineQueueProcessor';
import { supabaseCircuit } from '../lib/circuitBreaker';
import { toggleKudos, addComment, deletePost } from '../lib/communityService';

const ME = 'user-me';
const ok = { data: true, error: null };

beforeEach(async () => {
  await (await getDB()).clear('offlineQueue');
  vi.mocked(toggleKudos).mockReset();
  vi.mocked(addComment).mockReset();
  vi.mocked(deletePost).mockReset();
  supabaseCircuit.reset();
});
afterEach(() => vi.unstubAllGlobals());

describe('offline queue processor', () => {
  it('lists queued writes in the order they were made', async () => {
    const db = await getDB();
    const a = await enqueue(db, 'toggleKudos', { userId: ME, postId: 'p1', currentlyKudosed: false });
    const b = await enqueue(db, 'addComment', { userId: ME, postId: 'p1', body: 'Nice', commentId: 'c1' });
    const c = await enqueue(db, 'deletePost', { userId: ME, postId: 'p2' });
    expect((await getAll(db)).map((e) => e.id)).toEqual([a, b, c]);
  });

  it('dequeue removes an entry', async () => {
    const db = await getDB();
    const a = await enqueue(db, 'deletePost', { userId: ME, postId: 'p1' });
    const b = await enqueue(db, 'deletePost', { userId: ME, postId: 'p2' });
    await dequeue(db, a);
    expect((await getAll(db)).map((e) => e.id)).toEqual([b]);
  });

  it('replays your writes in order, dequeues successes and counts failures', async () => {
    const db = await getDB();
    const order: string[] = [];
    vi.mocked(toggleKudos).mockImplementation(async (postId) => { order.push(`kudos:${postId}`); return ok; });
    vi.mocked(addComment).mockImplementation(async () => { order.push('comment'); return { data: null, error: 'Network error.' }; });
    await queueCommunityWrite(db, 'toggleKudos', { userId: ME, postId: 'p1', currentlyKudosed: false });
    await queueCommunityWrite(db, 'addComment', { userId: ME, postId: 'p1', body: 'Nice', commentId: 'c1' });
    await queueCommunityWrite(db, 'toggleKudos', { userId: 'someone-else', postId: 'p9', currentlyKudosed: false });
    await queueCommunityWrite(db, 'toggleKudos', { userId: ME, postId: 'p2', currentlyKudosed: true });

    const res = await processOfflineQueue(db, ME);
    expect(order).toEqual(['kudos:p1', 'comment', 'kudos:p2']);
    expect(res).toEqual({ processed: 2, failed: 1, deadLetters: 0 });
    const left = await getAll(db);
    expect(left.map((e) => e.operation)).toEqual(['addComment', 'toggleKudos']); // failed one + another user's
    expect(left[0]).toMatchObject({ retryCount: 1, lastError: 'Network error.' });
  });

  it('skips dead letters and stops while the circuit is open', async () => {
    const db = await getDB();
    vi.mocked(deletePost).mockResolvedValue({ data: null, error: 'Server error' });
    await enqueue(db, 'deletePost', { userId: ME, postId: 'p1' }, 1);
    expect(await processOfflineQueue(db, ME)).toEqual({ processed: 0, failed: 1, deadLetters: 1 });
    await processOfflineQueue(db, ME);
    expect(deletePost).toHaveBeenCalledTimes(1); // dead letter not retried

    await enqueue(db, 'deletePost', { userId: ME, postId: 'p2' });
    for (let i = 0; i < 3; i++) await supabaseCircuit.execute(() => Promise.reject(new Error('down'))).catch(() => {});
    expect(await processOfflineQueue(db, ME)).toMatchObject({ processed: 0, failed: 0 });
    expect(deletePost).toHaveBeenCalledTimes(1);
  });

  it('replays when the connection comes back, until cleaned up', async () => {
    const db = await getDB();
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    vi.stubGlobal('navigator', { onLine: false });
    vi.mocked(deletePost).mockResolvedValue({ data: null, error: null });
    await queueCommunityWrite(db, 'deletePost', { userId: ME, postId: 'p1' });
    const done = vi.fn();
    // Checks the event wiring only: replaying as a signed-in user is covered above.
    const cleanup = setupOfflineQueueListener(db, done);
    expect(done).not.toHaveBeenCalled(); // offline at setup: nothing yet
    vi.stubGlobal('navigator', { onLine: true });
    target.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(done).toHaveBeenCalledTimes(1));
    cleanup();
    target.dispatchEvent(new Event('online'));
    await new Promise((r) => setTimeout(r, 20));
    expect(done).toHaveBeenCalledTimes(1);
  });
});
