import { describe, it, expect } from 'vitest';
import { generatePlan, plannedWeeklyKm, weeklyTargetKm } from '../lib/plan';
import { answerQuestion, generateWeeklyReport, type Snapshot } from '../lib/coach';
import { buildCoachContext } from '../lib/coachContext';
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

describe('AI coach context', () => {
  it('never includes photos', () => {
    const body = [{ id: 'x', eventDate: '2026-10-13', weightKg: 69, photo: 'data:image/jpeg;base64,SECRET' }] as BodyRecord[];
    const json = JSON.stringify(buildCoachContext(snap({ body })));
    expect(json).not.toContain('SECRET');
    expect(json).not.toContain('data:image');
  });
  it('only includes records inside the window', () => {
    const runs = [
      { id: 'old', eventDate: '2026-01-01', distanceKm: 42, durationSec: 14000, kind: 'long' },
      { id: 'new', eventDate: '2026-10-13', distanceKm: 5, durationSec: 1800, kind: 'easy' },
    ] as RunRecord[];
    const ctx = buildCoachContext(snap({ runs }));
    expect(ctx.runs.map((r) => r.km)).toEqual([5]);
  });
});
