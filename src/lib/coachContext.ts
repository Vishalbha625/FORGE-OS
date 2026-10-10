import type { Snapshot } from './coach';
import { generateWeeklyReport } from './coach';
import { addDays, startOfWeek, endOfWeek } from './dates';
import { round1, round0 } from './calc';

// Compact, privacy-conscious snapshot for the server-side AI coach.
// - Only the last few weeks of history, summarized per record.
// - No photos, no display photo, no free-text beyond short notes.
// Everything the AI sees is visible in this one function.

const trim = (s: string | undefined, n = 160) => (s ? (s.length > n ? s.slice(0, n) + '…' : s) : undefined);

export function buildCoachContext(s: Snapshot, days = 28) {
  const from = addDays(s.today, -days + 1);
  const recent = <T extends { eventDate: string }>(arr: T[]) =>
    arr.filter((r) => r.eventDate >= from && r.eventDate <= s.today).sort((a, b) => a.eventDate.localeCompare(b.eventDate));

  const p = s.profile;
  const profile = p && {
    age: p.age,
    heightCm: p.heightCm,
    weightKg: p.weightKg,
    goalWeightKg: p.goalWeightKg,
    goals: p.goals,
    primaryGoal: p.primaryGoal,
    diet: p.diet,
    allergies: p.allergies,
    raceDivision: p.raceDivision,
    raceDate: p.raceDate,
    trainingStartDate: p.trainingStartDate,
    weeklyVolumeKm: p.weeklyVolumeKm,
    best5kSec: p.best5kSec,
    best10kSec: p.best10kSec,
    injuries: trim(p.injuries),
    targets: { calories: p.calorieTarget, protein: p.proteinTarget, carbs: p.carbTarget, fat: p.fatTarget, waterMl: p.waterTargetMl, steps: p.stepGoal },
    supplements: p.supplements.filter((x) => x.active).map((x) => x.name),
    timezone: p.timezone,
  };

  const planWindow = s.planned
    .filter((w) => w.eventDate >= addDays(s.today, -7) && w.eventDate <= addDays(s.today, 7))
    .sort((a, b) => a.eventDate.localeCompare(b.eventDate))
    .map((w) => ({
      date: w.eventDate,
      week: w.weekIndex,
      phase: w.phase,
      title: w.title,
      deload: w.deload || undefined,
      runs: w.runs.map((r) => ({ kind: r.kind, km: r.distanceKm, rpe: r.targetRPE })),
      lifts: w.exercises.map((e) => `${e.name} ${e.sets}x${e.reps}`),
      hyrox: w.hyroxStations.map((h) => h.station),
      editedByAthlete: w.source === 'manual' || undefined,
    }));

  const nutritionByDay = new Map<string, { calories: number; protein: number; carbs: number; fat: number; entries: string[] }>();
  for (const n of recent(s.nutrition)) {
    if (n.eventDate < addDays(s.today, -6)) continue;
    const d = nutritionByDay.get(n.eventDate) ?? { calories: 0, protein: 0, carbs: 0, fat: 0, entries: [] };
    d.calories += n.calories ?? 0;
    d.protein += n.protein ?? 0;
    d.carbs += n.carbs ?? 0;
    d.fat += n.fat ?? 0;
    d.entries.push(`${n.meal}: ${n.name}${n.calories === undefined ? ' (no kcal logged)' : ''}`);
    nutritionByDay.set(n.eventDate, d);
  }

  const water = new Map<string, number>();
  for (const w of recent(s.water)) water.set(w.eventDate, (water.get(w.eventDate) ?? 0) + w.amountMl);

  const report = generateWeeklyReport(s);

  return {
    today: s.today,
    currentWeek: { start: startOfWeek(s.today), end: endOfWeek(s.today) },
    windowDays: days,
    note: 'Only records inside the window are included. Days with no record mean nothing was logged, not zero.',
    profile,
    plannedSessions: planWindow,
    runs: recent(s.runs).map((r) => ({ date: r.eventDate, kind: r.kind, km: r.distanceKm, durationSec: r.durationSec, paceSecPerKm: r.avgPaceSecPerKm, rpe: r.rpe, notes: trim(r.notes) })),
    strength: recent(s.strength).map((x) => ({
      date: x.eventDate,
      title: x.title,
      exercises: x.exercises.map((e) => ({ name: e.name, sets: e.sets.filter((st) => st.reps !== undefined || st.weightKg !== undefined).map((st) => `${st.reps ?? '?'}x${st.weightKg ?? '?'}kg${st.rpe ? `@${st.rpe}` : ''}`) })),
    })),
    hyrox: recent(s.hyrox).map((h) => ({ date: h.eventDate, mode: h.mode, title: h.title, stations: h.stations.map((st) => ({ station: st.station, timeSec: st.timeSec, reps: st.reps, distanceM: st.distanceM, loadKg: st.loadKg, breaks: st.breaks })) })),
    nutritionLast7Days: [...nutritionByDay.entries()].map(([date, d]) => ({ date, calories: round0(d.calories), protein: round0(d.protein), carbs: round0(d.carbs), fat: round0(d.fat), entries: d.entries.slice(0, 15) })),
    waterMlByDay: [...water.entries()].map(([date, ml]) => ({ date, ml })),
    sleep: recent(s.sleep).map((x) => ({ date: x.eventDate, hours: round1(x.durationMin / 60), quality: x.quality, restingHr: x.restingHr, hrv: x.hrv, source: x.source })),
    steps: recent(s.steps).map((x) => ({ date: x.eventDate, steps: x.steps, source: x.source })),
    bodyWeight: recent(s.body).filter((b) => b.weightKg).map((b) => ({ date: b.eventDate, kg: b.weightKg, waistCm: b.waistCm })),
    recovery: recent(s.recovery).map((r) => ({ date: r.eventDate, fatigue: r.fatigue, soreness: r.soreness, motivation: r.motivation, stress: r.stress, pain: trim(r.pain) })),
    weeklyReport: {
      planned: report.planned,
      running: report.running,
      strengthSessions: report.strengthSessions,
      avgSleepHours: report.avgSleepHours,
      stepsAvg: report.stepsAvg,
      recoveryConcerns: report.recovery.concerns,
    },
  };
}
