import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { openDB } from 'idb';
import { getDB, getAll } from '../db/database';

const V2_DATED = ['plannedWorkouts', 'runs', 'strength', 'hyrox', 'nutrition', 'water', 'sleep', 'steps', 'body', 'recovery', 'social'];
const V2_STORES = [...V2_DATED, 'profile', 'settings', 'audit'];

describe('IndexedDB v2 to v3 migration', () => {
  it('upgrades an existing v2 database without touching its data or indexes', async () => {
    // A device still on v2, with a logged run.
    const v2 = await openDB('forge-os', 2, {
      upgrade(db) {
        for (const name of V2_STORES) {
          const store = db.createObjectStore(name, { keyPath: 'id' });
          if (V2_DATED.includes(name)) store.createIndex('eventDate', 'eventDate');
        }
      },
    });
    await v2.put('runs', { id: 'r1', eventDate: '2026-10-12', createdAt: '2026-10-12T06:00:00Z', updatedAt: '2026-10-12T06:00:00Z', source: 'manual', kind: 'easy', distanceKm: 5, durationSec: 1800 });
    v2.close();

    const db = await getDB();
    expect(db.version).toBe(3);
    expect(db.objectStoreNames.length).toBe(16);
    expect([...db.objectStoreNames]).toEqual(expect.arrayContaining([...V2_STORES, 'socialCache', 'offlineQueue']));
    expect((await getAll('runs')).map((r) => r.id)).toEqual(['r1']);
    expect([...db.transaction('runs').store.indexNames]).toEqual(['eventDate']);
  });

  it('gives the new stores a createdAt index', async () => {
    const db = await getDB();
    for (const name of ['socialCache', 'offlineQueue']) {
      const store = db.transaction(name).store;
      expect(store.keyPath).toBe('id');
      expect([...store.indexNames]).toEqual(['createdAt']);
    }
  });
});
