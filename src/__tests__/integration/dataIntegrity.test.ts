import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/supabase', () => ({ getSupabase: vi.fn() }));

import { getSupabase } from '../../lib/supabase';
import { supabaseCircuit } from '../../lib/circuitBreaker';
import { createPost, type CommunityPost } from '../../lib/communityService';
import { workoutToDraft } from '../../features/community/recentWorkouts';
import { draftToInput, emptyDraft } from '../../features/community/PostForm';
import { exportAll, getAll, getDB } from '../../db/database';
import { setCachedFeed } from '../../lib/feedCache';
import { queueCommunityWrite } from '../../lib/offlineQueueProcessor';
import { rebuildPlan } from '../../store/appData';
import { FakeBackend } from './fakeBackend';
import { VISHAL, freshDevice, logMeal, logRun, logStrength, onboard, today } from './journeyFixtures';
import { addDays, startOfWeek } from '../../lib/dates';

// The rules that protect the athlete's data, checked across the layers that
// could break them: the post form, the community service, the plan and backup.

let backend: FakeBackend;

beforeEach(async () => {
  backend = new FakeBackend();
  backend.addUser(VISHAL, 'Vishal Bhardwaj');
  backend.as(VISHAL);
  vi.mocked(getSupabase).mockReturnValue(backend.client());
  supabaseCircuit.reset();
  await freshDevice();
});

describe('data integrity', () => {
  it('R1: a post made from a logged run carries its distance and time, nothing private', async () => {
    const run = await logRun({ distanceKm: 6.4, durationSec: 2200, rpe: 8, notes: 'SECRET-KNEE-NOTE', route: 'SECRET-ROUTE past my house', elevationM: 40 });
    const draft = { ...workoutToDraft({ kind: 'run', record: run }, emptyDraft()), visibility: 'public' as const };
    const created = await createPost(VISHAL, { ...draftToInput(draft), activity_type: draft.activity });

    expect(created.data).toMatchObject({ title: 'Easy run', activity_type: 'Run', distance_km: 6.4, duration_sec: 2200, pace_sec_per_km: 344 });
    const stored = JSON.stringify(backend.tables.posts);
    for (const secret of ['SECRET-KNEE-NOTE', 'SECRET-ROUTE', run.id]) expect(stored).not.toContain(secret);
    expect(backend.tables.posts[0]).toMatchObject({ route_text: null, elevation_m: null });
  });

  it('R2: a post without a caption has caption undefined, not null or empty', async () => {
    const created = (await createPost(VISHAL, { title: 'Wall balls', activity_type: 'HYROX', visibility: 'public', caption: '   ' })).data as CommunityPost;
    expect(created.caption).toBeUndefined();
    expect(created.distance_km).toBeUndefined();
    expect(created.photo_path).toBeUndefined();
  });

  it('R3: logging a run leaves the planned workout untouched, and a plan rebuild keeps the run', async () => {
    const profile = await onboard({ trainingStartDate: startOfWeek(today()), raceDate: addDays(today(), 100) });
    const before = (await getAll('plannedWorkouts')).find((w) => w.eventDate === today())!;
    expect(before).toBeDefined();

    const run = await logRun({ linkedPlanId: before.id, distanceKm: 3 });
    const after = (await getAll('plannedWorkouts')).find((w) => w.id === before.id);
    expect(after).toEqual(before);

    await rebuildPlan(profile.trainingStartDate, profile.raceDate);
    expect((await getAll('runs')).map((r) => r.id)).toEqual([run.id]);
  });

  it('export: holds all of the athlete\'s own stores, never the community cache or the offline queue', async () => {
    await onboard({ trainingStartDate: startOfWeek(today()), raceDate: addDays(today(), 100) });
    await logRun();
    await logStrength();
    await logMeal({ calories: 500 });
    const db = await getDB();
    await db.put('sleep', { id: 'sl1', eventDate: today(), createdAt: '', updatedAt: '', source: 'manual', bedtime: '', wakeTime: '', durationMin: 420 });
    await db.put('recovery', { id: 'rc1', eventDate: today(), createdAt: '', updatedAt: '', source: 'manual', fatigue: 2 });
    await setCachedFeed(db, [{ id: 'CACHED-OTHER-PERSON-POST' } as CommunityPost], null, VISHAL);
    await queueCommunityWrite(db, 'addComment', { userId: VISHAL, postId: 'p', body: 'QUEUED-COMMENT', commentId: 'c' });

    const backup = await exportAll();
    for (const store of ['profile', 'settings', 'plannedWorkouts', 'runs', 'strength', 'nutrition', 'sleep', 'recovery']) {
      expect((backup.data[store] ?? []).length, store).toBeGreaterThan(0);
    }
    expect(Object.keys(backup.data)).not.toContain('socialCache');
    expect(Object.keys(backup.data)).not.toContain('offlineQueue');
    const text = JSON.stringify(backup);
    expect(text).not.toContain('CACHED-OTHER-PERSON-POST');
    expect(text).not.toContain('QUEUED-COMMENT');
  });
});
