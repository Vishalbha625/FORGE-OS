import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { putRecord, getAll, exportAll, importAll, wipeAll, getByDateRange } from '../db/database';
import type { RunRecord, Profile } from '../db/types';

const run = (id: string, eventDate: string, updatedAt = '2026-10-10T00:00:00Z'): RunRecord => ({
  id, eventDate, createdAt: '2026-10-10T00:00:00Z', updatedAt, source: 'manual',
  kind: 'easy', distanceKm: 5, durationSec: 1800, avgPaceSecPerKm: 360,
});

beforeEach(async () => {
  await wipeAll();
});

describe('persistence & history (acceptance tests 5, 6)', () => {
  it('stores records and queries history by event date, not creation date', async () => {
    await putRecord('runs', run('late-entry', '2026-09-01')); // backdated
    await putRecord('runs', run('today', '2026-10-10'));
    const sept = await getByDateRange('runs', '2026-09-01', '2026-09-30');
    expect(sept.map((r) => r.id)).toEqual(['late-entry']);
  });
});

describe('export / import (acceptance test 19)', () => {
  it('re-importing the same backup does not duplicate records', async () => {
    await putRecord('runs', run('r1', '2026-10-01'));
    await putRecord('runs', run('r2', '2026-10-02'));
    const backup = await exportAll();
    const res = await importAll(backup, 'merge');
    expect(res.added).toBe(0);
    expect(await getAll('runs')).toHaveLength(2);
  });

  it('merge keeps the newer local copy and takes newer imported copies', async () => {
    await putRecord('runs', run('r1', '2026-10-01', '2026-10-05T00:00:00Z'));
    const backup = await exportAll();
    // Local edit after the backup was taken.
    await putRecord('runs', { ...run('r1', '2026-10-01', '2026-10-09T00:00:00Z'), distanceKm: 6 });
    await importAll(backup, 'merge');
    expect((await getAll('runs'))[0].distanceKm).toBe(6); // not overwritten by the older backup

    backup.data.runs = [{ ...run('r1', '2026-10-01', '2026-10-20T00:00:00Z'), distanceKm: 7 }];
    await importAll(backup, 'merge');
    expect((await getAll('runs'))[0].distanceKm).toBe(7); // newer import wins
  });

  it('keeps exactly one profile when merging a backup from another device', async () => {
    const p = (id: string, updatedAt: string, displayName: string) =>
      ({ id, updatedAt, createdAt: updatedAt, source: 'manual', displayName, onboarded: true }) as unknown as Profile;
    await putRecord('profile', p('local', '2026-10-01T00:00:00Z', 'Old name'));
    const backup = { app: 'forge-os' as const, version: 2, exportedAt: '', data: { profile: [p('other-device', '2026-10-09T00:00:00Z', 'New name')] } };
    await importAll(backup, 'merge');
    const profiles = await getAll('profile');
    expect(profiles).toHaveLength(1);
    expect(profiles[0].displayName).toBe('New name');
  });

  it('rejects files that are not Forge OS backups', async () => {
    await expect(importAll({} as never)).rejects.toThrow(/Not a valid/);
  });
});
