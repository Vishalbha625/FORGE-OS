import type { Snapshot } from './coach';
import { generateWeeklyReport } from './coach';
import { addDays, startOfWeek, endOfWeek } from './dates';
import { mean, round1, round0 } from './calc';
import type { MuscleGroup, PlannedWorkout } from '../db/types';

// What the AI coach server receives: a SUMMARY of the athlete's data, never
// the records themselves (R1). No individual runs, sets, meals, nights,
// notes, injuries, allergies or photos; totals, averages and latest values
// only. The rule-based coach reads the full data on the device instead.
// Everything the server sees is built in this one function.

const avg = (nums: number[]) => {
  const m = mean(nums);
  return m === undefined ? undefined : round1(m);
};

/** A planned session reduced to what it is, not how it is prescribed. */
const sessionSummary = (w: PlannedWorkout | undefined) =>
  w && {
    title: w.title,
    types: w.types,
    runKm: w.runs.reduce((sum, r) => sum + (r.distanceKm ?? 0), 0) || undefined,
    deload: w.deload || undefined,
  };

export type AIContext = ReturnType<typeof buildAIContext>;

export function buildAIContext(s: Snapshot) {
  const today = s.today;
  const weekStart = startOfWeek(today);
  const weekEnd = endOfWeek(today);
  const last7 = addDays(today, -6);
  const inWeek = <T extends { eventDate: string }>(arr: T[]) => arr.filter((r) => r.eventDate >= weekStart && r.eventDate <= today);
  const inLast7 = <T extends { eventDate: string }>(arr: T[]) => arr.filter((r) => r.eventDate >= last7 && r.eventDate <= today);
  const latest = <T extends { eventDate: string }>(arr: T[]) => [...arr].filter((r) => r.eventDate <= today).sort((a, b) => b.eventDate.localeCompare(a.eventDate))[0];

  // Running: this week, plus weekly totals for the last four weeks (trend only).
  const weekRuns = inWeek(s.runs);
  const weekKm = round1(weekRuns.reduce((sum, r) => sum + r.distanceKm, 0));
  const weekSec = weekRuns.reduce((sum, r) => sum + r.durationSec, 0);
  const kmByWeek = [3, 2, 1, 0].map((ago) => {
    const start = addDays(weekStart, -7 * ago);
    const end = addDays(start, 6);
    const runs = s.runs.filter((r) => r.eventDate >= start && r.eventDate <= end && r.eventDate <= today);
    return { weekStart: start, km: round1(runs.reduce((sum, r) => sum + r.distanceKm, 0)), runs: runs.length };
  });

  // Strength: which muscle groups and how many completed sets, this week.
  const weekStrength = inWeek(s.strength);
  const groups = new Set<MuscleGroup>();
  let totalSets = 0;
  for (const session of weekStrength) {
    for (const ex of session.exercises) {
      const done = ex.sets.filter((st) => st.completed).length;
      if (done > 0) groups.add(ex.group);
      totalSets += done;
    }
  }

  // Nutrition: daily averages over the days that have entries (last 7 days).
  const byDay = new Map<string, { calories?: number; protein?: number; carbs?: number; fat?: number }>();
  for (const n of inLast7(s.nutrition)) {
    const d = byDay.get(n.eventDate) ?? {};
    for (const k of ['calories', 'protein', 'carbs', 'fat'] as const) {
      const v = n[k];
      if (v !== undefined) d[k] = (d[k] ?? 0) + v;
    }
    byDay.set(n.eventDate, d);
  }
  const days = [...byDay.values()];
  const dailyAvg = (k: 'calories' | 'protein' | 'carbs' | 'fat') => {
    const vals = days.map((d) => d[k]).filter((v): v is number => v !== undefined);
    return vals.length ? round0(vals.reduce((a, b) => a + b, 0) / vals.length) : undefined;
  };

  const waterByDay = new Map<string, number>();
  for (const w of inLast7(s.water)) waterByDay.set(w.eventDate, (waterByDay.get(w.eventDate) ?? 0) + w.amountMl);

  const sleep7 = inLast7(s.sleep);
  const steps7 = inLast7(s.steps);
  const rec = latest(s.recovery);
  const body = latest(s.body.filter((b) => b.weightKg !== undefined));
  const p = s.profile;

  // Plan: where the athlete is, and today/tomorrow only.
  const todays = s.planned.find((w) => w.eventDate === today);
  const tomorrow = s.planned.find((w) => w.eventDate === addDays(today, 1));
  const report = generateWeeklyReport(s);

  return {
    today,
    note: 'Summary of the athlete\'s logs. Missing fields mean nothing was logged, never zero.',
    athlete: p && {
      goals: p.goals,
      primaryGoal: p.primaryGoal,
      raceDivision: p.raceDivision,
      raceDate: p.raceDate,
      diet: p.diet,
      heightCm: p.heightCm,
      targets: { calories: p.calorieTarget, protein: p.proteinTarget, carbs: p.carbTarget, fat: p.fatTarget, waterMl: p.waterTargetMl, steps: p.stepGoal },
    },
    plan: {
      phase: (todays ?? s.planned.find((w) => w.eventDate >= today))?.phase,
      week: (todays ?? s.planned.find((w) => w.eventDate >= today))?.weekIndex,
      thisWeek: { start: weekStart, end: weekEnd, sessionsPlanned: report.planned.total, sessionsCompleted: report.planned.completed, sessionsMissed: report.planned.missed },
      today: sessionSummary(todays),
      tomorrow: sessionSummary(tomorrow),
    },
    running: {
      thisWeekKm: weekKm,
      thisWeekRuns: weekRuns.length,
      thisWeekAvgPaceSecPerKm: weekKm > 0 && weekSec > 0 ? round0(weekSec / weekKm) : undefined,
      plannedKmThisWeek: report.running.plannedKm,
      last4Weeks: kmByWeek,
    },
    strength: { thisWeekSessions: weekStrength.length, muscleGroupsHit: [...groups], completedSets: totalSets },
    hyrox: { thisWeekSessions: inWeek(s.hyrox).length },
    nutrition: {
      daysLogged: days.length,
      avgDailyCalories: dailyAvg('calories'),
      avgDailyProteinG: dailyAvg('protein'),
      avgDailyCarbsG: dailyAvg('carbs'),
      avgDailyFatG: dailyAvg('fat'),
      avgDailyWaterMl: waterByDay.size ? round0([...waterByDay.values()].reduce((a, b) => a + b, 0) / waterByDay.size) : undefined,
    },
    sleep: { nightsLogged: sleep7.length, avgHours: avg(sleep7.map((x) => x.durationMin / 60)) },
    steps: { daysLogged: steps7.length, avgDaily: steps7.length ? round0(steps7.reduce((a, x) => a + x.steps, 0) / steps7.length) : undefined },
    recovery: rec && { date: rec.eventDate, fatigue: rec.fatigue, soreness: rec.soreness, motivation: rec.motivation, stress: rec.stress },
    body: body && { date: body.eventDate, weightKg: body.weightKg },
  };
}
