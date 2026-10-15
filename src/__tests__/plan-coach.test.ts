import { describe, it, expect } from 'vitest';
import { generatePlan, plannedWeeklyKm, weeklyTargetKm } from '../lib/plan';
import { answerQuestion, generateWeeklyReport, type Snapshot } from '../lib/coach';
import { buildAIContext } from '../lib/coachContext';
import type { Profile, RunRecord, BodyRecord } from '../db/types';

const plan = generatePlan({ startDate: '2026-10-12', raceDate: '2027-01-24' });

describe('training plan (deliverable: full calendar to race day)', () => {
  it('covers every day from the start date through race day', () => {
    const dates = plan.map((w) => w.eventDate).sort();
    expect(dates[0]).toBe('2026-10-12');
    expect(dates[dates.length - 1]).toBe('2027-01-24');
    expect(new Set(dates).size).toBe(105);
  });
  it('has 15 weeks across Base, Build, Specific and Taper', () => {
    expect(new Set(plan.map((w) => w.weekIndex)).size).toBe(15);
    expect(new Set(plan.map((w) => w.phase))).toEqual(new Set(['Base', 'Build', 'Specific', 'Taper / Race']));
  });
  it('race day is race mode with all 8 HYROX stations', () => {
    const race = plan.find((w) => w.eventDate === '2027-01-24')!;
    expect(race.title).toMatch(/race day/i);
    expect(race.hyroxStations).toHaveLength(8);
  });
  it('planned daily runs match the weekly target (±2 km) outside race week', () => {
    for (let w = 1; w <= 14; w++) {
      const week = plan.filter((p) => p.weekIndex === w);
      expect(Math.abs(plannedWeeklyKm(week) - weeklyTargetKm(w)), `week ${w}`).toBeLessThanOrEqual(2);
    }
  });
  it('never prescribes arbitrary strength loads', () => {
    expect(plan.flatMap((w) => w.exercises).every((e) => e.targetWeightKg === undefined)).toBe(true);
  });
});

const profile = {
  displayName: 'Test', raceDate: '2027-01-24', diet: 'vegetarian', goals: ['hyrox'], primaryGoal: 'hyrox',
  supplements: [], stepGoal: 8000, waterTargetMl: 3000, photo: 'data:image/png;base64,AAAA',
} as unknown as Profile;

function snap(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    profile, planned: plan, runs: [], strength: [], hyrox: [], nutrition: [], sleep: [], steps: [],
    body: [], recovery: [], water: [], today: '2026-10-14', ...overrides,
  };
}

describe('coach honesty (acceptance test 16)', () => {
  it('admits missing nutrition data instead of inventing it', () => {
    const a = answerQuestion('How much protein have I consumed today?', snap());
    expect(a.tags).toContain('missing');
    expect(a.text).toMatch(/No meals logged/);
  });
  it('admits missing lift data', () => {
    expect(answerQuestion('What was my last squat weight?', snap()).tags).toContain('missing');
  });
  it('computes weekly km from real records only', () => {
    const runs = [
      { id: 'a', eventDate: '2026-10-12', distanceKm: 5, durationSec: 1800, kind: 'easy' },
      { id: 'b', eventDate: '2026-10-13', distanceKm: 7.5, durationSec: 2700, kind: 'tempo' },
      { id: 'c', eventDate: '2026-10-05', distanceKm: 20, durationSec: 7200, kind: 'long' }, // previous week
    ] as RunRecord[];
    const a = answerQuestion('How many km have I run this week?', snap({ runs }));
    expect(a.text).toContain('12.5 km');
    expect(generateWeeklyReport(snap({ runs })).running.actualKm).toBe(12.5);
  });
});

describe('AI coach context (summary only, R1)', () => {
  it('never includes photos', () => {
    const body = [{ id: 'x', eventDate: '2026-10-13', weightKg: 69, photo: 'data:image/jpeg;base64,SECRET' }] as BodyRecord[];
    const json = JSON.stringify(buildAIContext(snap({ body })));
    expect(json).not.toContain('SECRET');
    expect(json).not.toContain('data:image');
    expect(buildAIContext(snap({ body })).body).toEqual({ date: '2026-10-13', weightKg: 69 });
  });

  it('summarizes runs: this week totals and average pace, not individual runs', () => {
    const runs = [
      { id: 'old', eventDate: '2026-01-01', distanceKm: 42, durationSec: 14000, kind: 'long', notes: 'OLD-NOTE' },
      { id: 'a', eventDate: '2026-10-12', distanceKm: 5, durationSec: 1800, kind: 'easy', route: 'LAKE-ROUTE', notes: 'KNEE-NOTE' },
      { id: 'b', eventDate: '2026-10-13', distanceKm: 7.5, durationSec: 2700, kind: 'tempo' },
    ] as RunRecord[];
    const ctx = buildAIContext(snap({ runs }));
    expect(ctx.running).toMatchObject({ thisWeekKm: 12.5, thisWeekRuns: 2, thisWeekAvgPaceSecPerKm: 360 });
    const json = JSON.stringify(ctx);
    for (const leak of ['KNEE-NOTE', 'LAKE-ROUTE', 'OLD-NOTE', '"durationSec"', '"distanceKm"']) expect(json).not.toContain(leak);
  });

  it('summarizes strength, meals and sleep without the individual entries', () => {
    const s = snap({
      strength: [{ id: 's', eventDate: '2026-10-13', title: 'Legs', exercises: [{ name: 'Back squat', group: 'legs', sets: [{ reps: 5, weightKg: 123, completed: true }, { reps: 5, weightKg: 123, completed: false }] }] }],
      nutrition: [
        { id: 'n1', eventDate: '2026-10-13', meal: 'lunch', name: 'PANEER-BOWL', calories: 600, protein: 40 },
        { id: 'n2', eventDate: '2026-10-13', meal: 'dinner', name: 'DAL', calories: 500 },
      ],
      sleep: [{ id: 'z', eventDate: '2026-10-13', bedtime: '', wakeTime: '', durationMin: 450, restingHr: 52, hrv: 77 }],
      recovery: [{ id: 'r', eventDate: '2026-10-13', fatigue: 2, soreness: 3, motivation: 4, stress: 2, pain: 'LEFT-KNEE' }],
    } as Partial<Snapshot>);
    const ctx = buildAIContext(s);
    expect(ctx.strength).toEqual({ thisWeekSessions: 1, muscleGroupsHit: ['legs'], completedSets: 1 });
    expect(ctx.nutrition).toMatchObject({ daysLogged: 1, avgDailyCalories: 1100, avgDailyProteinG: 40 });
    expect(ctx.sleep).toEqual({ nightsLogged: 1, avgHours: 7.5 });
    expect(ctx.recovery).toEqual({ date: '2026-10-13', fatigue: 2, soreness: 3, motivation: 4, stress: 2 });
    const json = JSON.stringify(ctx);
    for (const leak of ['123', 'Back squat', 'PANEER', 'DAL', 'LEFT-KNEE', 'restingHr', 'hrv', '"77"']) expect(json).not.toContain(leak);
  });

  it('leaves out free-text health fields from the profile', () => {
    const profile = { ...snap().profile, injuries: 'ACL-TEAR', allergies: 'PEANUT', weightKg: 70, age: 23 } as Snapshot['profile'];
    const json = JSON.stringify(buildAIContext(snap({ profile })));
    expect(json).not.toContain('ACL-TEAR');
    expect(json).not.toContain('PEANUT');
  });
});
