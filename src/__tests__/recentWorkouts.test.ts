import { describe, it, expect } from 'vitest';
import { describeWorkout, pickRecent, workoutToDraft, type RecentWorkout } from '../features/community/recentWorkouts';
import { draftToInput, emptyDraft } from '../features/community/PostForm';
import type { HyroxRecord, RunRecord, StrengthRecord } from '../db/types';

const meta = { createdAt: '2026-10-15T06:00:00Z', updatedAt: '2026-10-15T06:00:00Z', source: 'manual' as const };
const run: RunRecord = { id: 'run-1', eventDate: '2026-10-15', kind: 'easy', distanceKm: 8.5, durationSec: 2700, rpe: 6, notes: 'knee felt off', ...meta };
const lift: StrengthRecord = {
  id: 'lift-1', eventDate: '2026-10-14', title: 'Lower body', ...meta,
  exercises: [{ name: 'Back squat', group: 'legs', sets: [{ reps: 5, weightKg: 90, completed: true }, { reps: 5, weightKg: 100, completed: true }, { reps: 5, weightKg: 110, completed: false }] }],
};
const hyrox: HyroxRecord = {
  id: 'hx-1', eventDate: '2026-10-15', title: 'Sled day', mode: 'station', totalTimeSec: 600, ...meta, createdAt: '2026-10-15T09:00:00Z',
  stations: [{ station: 'Sled push', distanceM: 50, loadKg: 152, timeSec: 95 }],
};

describe('attaching a recent workout', () => {
  it('lists the newest three, labelled briefly', () => {
    const all: RecentWorkout[] = [{ kind: 'strength', record: lift }, { kind: 'run', record: run }, { kind: 'hyrox', record: hyrox }, { kind: 'run', record: { ...run, id: 'old', eventDate: '2026-10-13' } }];
    const recent = pickRecent(all);
    expect(recent.map((w) => w.record.id)).toEqual(['hx-1', 'run-1', 'lift-1']);
    expect(describeWorkout({ kind: 'run', record: run })).toBe('Easy run, 8.5 km');
    expect(describeWorkout({ kind: 'strength', record: lift })).toBe('Lower body, 1 exercise');
  });

  it('fills only visible fields, and the post carries nothing else from the record (R1)', () => {
    const draft = workoutToDraft({ kind: 'run', record: run }, { ...emptyDraft(), title: 'My title' });
    expect(draft).toMatchObject({ activity: 'Run', title: 'My title', distance: '8.5', duration: '45:00', eventDate: '2026-10-15' });
    const input = draftToInput(draft);
    expect(input).toMatchObject({ distance_km: 8.5, duration_sec: 2700, pace_sec_per_km: 318, visibility: 'private' });
    const shared = JSON.stringify(input);
    expect(shared).not.toContain('run-1'); // record id
    expect(shared).not.toContain('knee'); // notes
    expect(shared).not.toContain('rpe');
  });

  it('summarizes completed strength sets and HYROX stations as editable text', () => {
    expect(workoutToDraft({ kind: 'strength', record: lift }, emptyDraft()).stationDetail).toBe('Back squat: 2 sets, top 100 kg × 5');
    expect(workoutToDraft({ kind: 'hyrox', record: hyrox }, emptyDraft()).stationDetail).toBe('Total 10:00\nSled push: 50 m @ 152 kg in 1:35');
  });

  it('leaves blank stats undefined and drops stats that do not fit the activity', () => {
    const blank = draftToInput({ ...emptyDraft(), title: 'Rest day', activity: 'Recovery', distance: '5', stationDetail: 'x' });
    expect(blank.distance_km).toBeUndefined();
    expect(blank.station_detail).toBeUndefined();
    expect(blank.caption).toBeUndefined();
    const noTime = draftToInput({ ...emptyDraft(), title: 'Run', activity: 'Run', distance: '5' });
    expect(noTime).toMatchObject({ distance_km: 5 });
    expect(noTime.duration_sec).toBeUndefined();
    expect(noTime.pace_sec_per_km).toBeUndefined();
  });
});
