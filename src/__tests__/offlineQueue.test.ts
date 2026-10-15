import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { getDB } from '../db/database';
import { enqueue, dequeue, getAll, incrementRetry, getDeadLetters, clearDeadLetters } from '../lib/offlineQueue';

beforeEach(async () => {
  await (await getDB()).clear('offlineQueue');
});

describe('offline queue', () => {
  it('keeps writes in the order they were made, even within one millisecond', async () => {
    const db = await getDB();
    const a = await enqueue(db, 'createPost', { title: 'a' });
    const b = await enqueue(db, 'addKudos', { postId: 'p1' });
    const c = await enqueue(db, 'addComment', { text: 'c' });
    expect((await getAll(db)).map((e) => e.id)).toEqual([a, b, c]);
    await dequeue(db, b);
    const left = await getAll(db);
    expect(left.map((e) => e.operation)).toEqual(['createPost', 'addComment']);
    expect(left[0]).toMatchObject({ retryCount: 0, maxRetries: 5, payload: { title: 'a' } });
    expect(left[0].lastError).toBeUndefined();
  });

  it('counts retries, records the error and returns null for unknown ids', async () => {
    const db = await getDB();
    const id = await enqueue(db, 'createPost', {});
    const updated = await incrementRetry(db, id, new Error('503 from server'));
    expect(updated).toMatchObject({ id, retryCount: 1, lastError: '503 from server' });
    expect(await incrementRetry(db, 'missing', 'x')).toBeNull();
  });

  it('separates dead letters and clears only them', async () => {
    const db = await getDB();
    const dead = await enqueue(db, 'createPost', {}, 2);
    const alive = await enqueue(db, 'addKudos', {}, 2);
    await incrementRetry(db, dead, 'e1');
    await incrementRetry(db, dead, 'e2');
    await incrementRetry(db, alive, 'e1');
    expect((await getDeadLetters(db)).map((e) => e.id)).toEqual([dead]);
    await clearDeadLetters(db);
    expect((await getAll(db)).map((e) => e.id)).toEqual([alive]);
  });
});
