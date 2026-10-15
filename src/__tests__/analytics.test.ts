import { describe, it, expect } from 'vitest';
import {
  averageDailyCalories,
  dashboardStatus,
  periodRange,
  runningSeries,
  sleepSeries,
  strengthSeries,
  weeklyReview,
  weeklyStatus,
} from '../lib/analytics';
import type { Snapshot } from '../lib/coach';
import type { NutritionEntry, PlannedWorkout, RecoveryRecord, RunRecord, SleepRecord, StrengthRecord } from '../db/types';

const TODAY = '2026-10-15'; // a Thursday; the week starts Monday 12 Oct
const base = { createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', source: 'manual' as const };
const run = (eventDate: string, distanceKm: number, durationSec = distanceKm * 360): RunRecord => ({ ...base, id: `r-${eventDate}-${distanceKm}`, eventDate, kind: 'easy', distanceKm, durationSec });
const meal = (eventDate: string, calories?: number, extra: Partial<NutritionEntry> = {}): NutritionEntry => ({ ...base, id: `n-${eventDate}-${calories}-${Math.random()}`, eventDate, meal: 'lunch', name: 'Meal', calories, ...extra });
const plannedRun = (eventDate: string, km: number, weekIndex = 1): PlannedWorkout => ({
  ...base, id: `p-${eventDate}`, eventDate, phase: 'Base', weekIndex, title: 'Easy run', types: ['easy_run'], focus: 'Aerobic',
  runs: [{ kind: 'easy', distanceKm: km }], exercises: [], hyroxStations: [], deload: false,
});
const snap = (o: Partial<Snapshot> = {}): Snapshot => ({
  profile: null, planned: [], runs: [], strength: [], hyrox: [], nutrition: [], sleep: [], steps: [], body: [], recovery: [], water: [], today: TODAY, ...o,
});

describe('analytics aggregation', () => {
  it('sums running per day, keeps rest days undefined and builds the cumulative line', () => {
    const range = periodRange('week', TODAY);
    expect(range.days).toHaveLength(7);
    expect(range.start).toBe('2026-10-12');
    const s = runningSeries([run('2026-10-12', 5), run('2026-10-14', 3), run('2026-10-14', 2), run('2026-10-05', 9)], [plannedRun('2026-10-12', 6), plannedRun('2026-10-16', 8)], range, TODAY);
    expect(s.totalKm).toBe(10);
    expect(s.runs).toBe(3);
    expect(s.avgPaceSecPerKm).toBe(360);
    expect(s.days.map((d) => d.km)).toEqual([5, undefined, 5, undefined, undefined, undefined, undefined]);
    expect(s.days.map((d) => d.cumulative)).toEqual([5, 5, 10, 10, undefined, undefined, undefined]);
    expect(s.days.map((d) => d.plannedCumulative)).toEqual([6, 6, 6, 6, 14, 14, 14]);
    expect(s.plannedKm).toBe(14);
  });

  it('averages daily calories over logged days only', () => {
    const entries = [meal('2026-10-12', 600), meal('2026-10-12', 1400), meal('2026-10-13', 2500), meal('2026-10-14', undefined)];
    expect(averageDailyCalories(entries)).toBe(2250);
    expect(averageDailyCalories([])).toBeUndefined();
    expect(averageDailyCalories([meal('2026-10-14', undefined)])).toBeUndefined();
  });

  it('is on track within 10% of the plan', () => {
    expect(weeklyStatus(9, 10)).toBe('on_track');
    expect(weeklyStatus(11, 10)).toBe('on_track');
    expect(weeklyStatus(8.5, 10)).toBe('needs_attention');
    expect(weeklyStatus(10, undefined)).toBeUndefined();
    expect(weeklyStatus(0, 0)).toBeUndefined();
  });

  it('is behind when more than 20% below the plan', () => {
    expect(weeklyStatus(7.9, 10)).toBe('behind');
    expect(weeklyStatus(0, 10)).toBe('behind');
    expect(weeklyStatus(8, 10)).toBe('needs_attention');
  });

  it('counts completed strength sets per muscle group', () => {
    const rec: StrengthRecord = {
      ...base, id: 's1', eventDate: '2026-10-13', title: 'Gym',
      exercises: [
        { name: 'Squat', group: 'legs', sets: [{ reps: 5, weightKg: 100, completed: true }, { reps: 5, weightKg: 100, completed: true }, { reps: 5, completed: false }] },
        { name: 'Curl', group: 'biceps', sets: [{ reps: 10, weightKg: 12, completed: true }] },
        { name: 'Pushdown', group: 'triceps', sets: [{ reps: 10, completed: true }] },
      ],
    };
    const s = strengthSeries([rec], periodRange('week', TODAY));
    expect(s.totalSets).toBe(4);
    expect(s.volumeKg).toBe(1120);
    expect(s.groups).toEqual(['legs', 'arms']);
    expect(s.days[1]).toMatchObject({ legs: 2, arms: 2, total: 4 });
    expect(s.days[0]).toEqual({ date: '2026-10-12' });
  });

  it('rolls sleep over the trailing 7 days, using nights before the period', () => {
    const night = (eventDate: string, hours: number): SleepRecord => ({ ...base, id: `sl-${eventDate}`, eventDate, bedtime: '', wakeTime: '', durationMin: hours * 60 });
    const s = sleepSeries([night('2026-10-10', 6), night('2026-10-12', 8)], periodRange('week', TODAY));
    expect(s.days[0]).toEqual({ date: '2026-10-12', hours: 8, rolling: 7 });
    expect(s.days[1].hours).toBeUndefined();
    expect(s.avgHours).toBe(8);
    expect(s.nights).toBe(1);
    expect(sleepSeries([night('2026-10-14', 7)], periodRange('week', TODAY), TODAY).days.map((d) => d.rolling)).toEqual([undefined, undefined, 7, 7, undefined, undefined, undefined]);
  });

  it('builds the weekly review from the plan to date', () => {
    const planned = [plannedRun('2026-10-12', 5, 1), plannedRun('2026-10-14', 5, 1), plannedRun('2026-10-15', 5, 1), plannedRun('2027-01-20', 3, 15)];
    const r = weeklyReview(snap({ planned, runs: [run('2026-10-12', 5), run('2026-10-14', 3.5)] }));
    expect(r).toMatchObject({ weekIndex: 1, totalWeeks: 15, km: 8.5, plannedKmToDate: 10, status: 'needs_attention' });
    // Today's planned run counts once something is run today.
    const later = weeklyReview(snap({ planned, runs: [run('2026-10-12', 5), run('2026-10-14', 3.5), run('2026-10-15', 1)] }));
    expect(later).toMatchObject({ plannedKmToDate: 15, status: 'behind' });
    expect(weeklyReview(snap()).status).toBeUndefined();
    expect(weeklyReview(snap()).weekIndex).toBeUndefined();
  });

  it('recommends recovery on high fatigue or short sleep, and flags missed sessions', () => {
    const rec = (fatigue: number): RecoveryRecord => ({ ...base, id: 'rc', eventDate: TODAY, fatigue, soreness: 2 });
    expect(dashboardStatus(snap({ recovery: [rec(4)] })).status).toBe('recovery');
    expect(dashboardStatus(snap({ recovery: [rec(2)] })).status).toBe('on_track');
    const short: SleepRecord = { ...base, id: 'sl', eventDate: '2026-10-14', bedtime: '', wakeTime: '', durationMin: 300 };
    expect(dashboardStatus(snap({ sleep: [short] })).status).toBe('recovery');
    const planned = [plannedRun('2026-10-12', 5), plannedRun('2026-10-13', 5)];
    expect(dashboardStatus(snap({ planned })).status).toBe('needs_attention');
    expect(dashboardStatus(snap({ planned, runs: [run('2026-10-13', 5)] })).status).toBe('on_track');
  });
});
