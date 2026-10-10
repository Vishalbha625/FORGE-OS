import type {
  PlannedWorkout,
  PlannedExercise,
  PlannedRun,
  HyroxStationPlan,
  MuscleGroup,
  SessionType,
  Profile,
} from '../db/types';
import { EXERCISE_LIBRARY, HYROX_STATIONS } from './constants';
import { addDays, daysBetween } from './dates';
import { uid, nowISO } from '../db/database';
import { round1 } from './calc';

// Weekly running volume targets (km) across the 15-week block.
const WEEKLY_KM = [32, 35, 38, 27, 40, 42, 45, 32, 46, 48, 44, 46, 40, 30, 18];
// Deload / lighter weeks.
const DELOAD_WEEKS = new Set([4, 8, 14, 15]);

// Fraction of weekly volume per weekday (Mon..Sun). Sums to 1.0.
const RUN_SPLIT = {
  mon: 0.1, // easy
  tue: 0.16, // tempo
  wed: 0.32, // long
  thu: 0.14, // interval/tempo
  fri: 0.08, // easy
  sat: 0.08, // easy
  sun: 0.12, // long/easy aerobic
};

function phaseFor(week: number): string {
  if (week <= 5) return 'Base';
  if (week <= 10) return 'Build';
  if (week <= 13) return 'Specific';
  return 'Taper / Race';
}

function makeExercises(groups: MuscleGroup[], deload: boolean): PlannedExercise[] {
  const out: PlannedExercise[] = [];
  for (const g of groups) {
    const lib = EXERCISE_LIBRARY[g] ?? [];
    for (const e of lib) {
      out.push({
        name: e.name,
        group: g,
        sets: deload ? Math.max(2, e.sets - 1) : e.sets,
        reps: e.reps,
        targetRPE: deload ? 6 : 8,
        restSec: g === 'legs' || g === 'back' || g === 'chest' ? 120 : 75,
        instructions: e.cue,
      });
    }
  }
  return out;
}

function run(kind: PlannedRun['kind'], km: number, rpe: number, desc: string): PlannedRun {
  return { kind, distanceKm: round1(km), targetRPE: rpe, description: desc };
}

function intervalRun(km: number): PlannedRun {
  return {
    kind: 'interval',
    distanceKm: round1(km),
    targetRPE: 8,
    description: `Intervals, e.g. 6–8 × 400–800 m hard with equal easy jog. Total ≈ ${round1(km)} km incl. w-up/c-down. (RPE 7–8)`,
  };
}

/** HYROX station block for a given phase. Rotates focus stations. */
function hyroxFor(phase: string): HyroxStationPlan[] {
  if (phase === 'Base') {
    // Familiarisation — a few stations, moderate effort.
    const focus = ['SkiErg', 'Row', 'Wall Balls', "Farmer's Carry"];
    return HYROX_STATIONS.filter((s) => focus.includes(s.station)).map((s) => ({
      ...s,
      notes: `${s.notes ?? ''} RPE 6–7, technique focus.`.trim(),
    }));
  }
  if (phase === 'Build') {
    const focus = ['Sled Push', 'Sled Pull', 'Burpee Broad Jumps', 'Wall Balls', 'Sandbag Lunges'];
    return HYROX_STATIONS.filter((s) => focus.includes(s.station)).map((s) => ({
      ...s,
      notes: `${s.notes ?? ''} Compromised running between stations. RPE 6–7.`.trim(),
    }));
  }
  // Specific / Taper — full station set, race-pace feel.
  return HYROX_STATIONS.map((s) => ({ ...s }));
}

export interface GenerateOptions {
  startDate: string; // YYYY-MM-DD (Monday of week 1)
  raceDate: string; // YYYY-MM-DD
}

/**
 * Build the complete planned-workout calendar from start through race day.
 * Honors the athlete's preferred weekly split while managing load (easy days
 * stay easy, deloads cut volume, taper sharpens, race day is race mode).
 */
export function generatePlan(opts: GenerateOptions): PlannedWorkout[] {
  const { startDate, raceDate } = opts;
  const totalDays = daysBetween(startDate, raceDate);
  const weeks = Math.max(1, Math.ceil((totalDays + 1) / 7));
  const out: PlannedWorkout[] = [];
  const ts = nowISO();

  for (let w = 1; w <= weeks; w++) {
    const weekStart = addDays(startDate, (w - 1) * 7);
    const phase = phaseFor(w);
    const deload = DELOAD_WEEKS.has(w);
    const targetKm = WEEKLY_KM[Math.min(w - 1, WEEKLY_KM.length - 1)] ?? 30;
    const isRaceWeek = w === weeks || phase === 'Taper / Race' && w === 15;

    for (let d = 0; d < 7; d++) {
      const date = addDays(weekStart, d);
      if (daysBetween(startDate, date) > totalDays) continue; // past race day
      const dow = d; // 0=Mon..6=Sun
      const isRaceDay = date === raceDate;

      let title = '';
      let focus = '';
      const types: SessionType[] = [];
      const runs: PlannedRun[] = [];
      let exercises: PlannedExercise[] = [];
      let hyroxStations: HyroxStationPlan[] = [];
      let warmup = '5–10 min easy jog + dynamic mobility (leg swings, hips, ankles).';
      let cooldown = '5 min easy walk + stretch quads, hamstrings, calves, hips.';
      let description = '';

      if (isRaceDay) {
        title = '🏁 HYROX Race Day — Men Open';
        focus = 'Race';
        types.push('hyrox', 'easy_run');
        hyroxStations = HYROX_STATIONS.map((s) => ({ ...s }));
        runs.push(run('easy', 1, 3, 'Race warm-up: 8 stations with 8×1 km runs. Pace smart, fuel + hydrate.'));
        warmup = 'Thorough warm-up: easy jog, dynamic drills, a few wall-balls and ski strokes to prime.';
        cooldown = 'Easy walk, celebrate, refuel with carbs + protein, hydrate.';
        description = 'Race mode. Execute your pacing plan. Trust the training.';
        out.push(mk(date, phase, w, title, types, focus, runs, exercises, hyroxStations, true, warmup, cooldown, description, ts));
        continue;
      }

      switch (dow) {
        case 0: // Monday — Legs, Abs, Easy run
          title = deload ? 'Legs (light) + Abs + Easy run' : 'Legs + Abs + Easy run';
          focus = 'Lower body strength + aerobic base';
          types.push('strength', 'easy_run');
          exercises = makeExercises(['legs', 'abs'], deload);
          runs.push(run('easy', targetKm * RUN_SPLIT.mon, 3, 'Conversational easy run. Keep it truly easy (RPE 3–4).'));
          break;
        case 1: // Tuesday — Tempo run, Chest, Triceps
          title = 'Tempo run + Chest + Triceps';
          focus = 'Threshold running + push strength';
          types.push('tempo_run', 'strength');
          runs.push(run('tempo', targetKm * RUN_SPLIT.tue, deload ? 5 : 6, 'Comfortably hard tempo (RPE 6–7). Steady, controlled.'));
          exercises = makeExercises(['chest', 'triceps'], deload);
          break;
        case 2: // Wednesday — Long run, Back, Biceps
          title = 'Long run + Back + Biceps';
          focus = 'Aerobic endurance + pull strength';
          types.push('long_run', 'strength');
          runs.push(run('long', targetKm * RUN_SPLIT.wed, 4, 'Long aerobic run (RPE 3–4). Build time on feet; fuel if >75 min.'));
          exercises = makeExercises(['back', 'biceps'], deload);
          break;
        case 3: // Thursday — Tempo/Interval (alternating), Delts
          {
            const useInterval = w % 2 === 0 && !deload && phase !== 'Base';
            title = (useInterval ? 'Intervals' : 'Tempo run') + ' + Delts';
            focus = 'Speed / threshold + shoulders';
            types.push(useInterval ? 'interval_run' : 'tempo_run', 'strength');
            runs.push(
              useInterval
                ? intervalRun(targetKm * RUN_SPLIT.thu)
                : run('tempo', targetKm * RUN_SPLIT.thu, deload ? 5 : 6, 'Shorter tempo / steady effort (RPE 6).'),
            );
            exercises = makeExercises(['delts'], deload);
          }
          break;
        case 4: // Friday — Easy run, Abs, HYROX conditioning
          title = 'Easy run + Abs + HYROX conditioning';
          focus = 'HYROX-specific conditioning';
          types.push('easy_run', 'hyrox', 'strength');
          runs.push(run('easy', targetKm * RUN_SPLIT.fri, 4, 'Easy shakeout before conditioning (RPE 3–4).'));
          exercises = makeExercises(['abs'], deload);
          hyroxStations = hyroxFor(phase);
          description =
            phase === 'Specific' || phase === 'Taper / Race'
              ? 'Run + station combos at race feel. Minimise transitions.'
              : 'Station circuit — focus on technique and pacing. Build toward race demands.';
          break;
        case 5: // Saturday — Chest, Triceps, Easy run (lighter accessory)
          title = deload ? 'Rest / optional easy run' : 'Chest + Triceps (accessory) + Easy run';
          focus = deload ? 'Recovery' : 'Upper push volume + easy aerobic';
          if (deload) {
            types.push('easy_run', 'rest');
            runs.push(run('easy', Math.min(4, targetKm * RUN_SPLIT.sat), 3, 'Optional short, easy shakeout. Skip if fatigued.'));
          } else {
            types.push('strength', 'easy_run');
            exercises = makeExercises(['chest', 'triceps'], true); // lighter accessory volume
            runs.push(run('easy', targetKm * RUN_SPLIT.sat, 3, 'Short easy run (RPE 3).'));
          }
          break;
        case 6: // Sunday — Long or easy aerobic
          {
            const asLong = phase === 'Specific' && !deload;
            if (phase === 'Specific' && !deload && (w === 11 || w === 12 || w === 13)) {
              // Mini race simulation during specific phase.
              title = '🧪 HYROX Mini-Simulation';
              focus = 'Race-specific simulation';
              types.push('hyrox', 'long_run');
              hyroxStations = HYROX_STATIONS.map((s) => ({ ...s }));
              runs.push(run('long', targetKm * RUN_SPLIT.sun, 6, 'Run + station simulation (e.g. 4×1 km runs with 4 stations). RPE 6–7.'));
              description = 'Practice transitions, pacing and fuelling. Record station times + breaks.';
            } else {
              title = asLong ? 'Aerobic long/easy run' : 'Easy aerobic run';
              focus = 'Aerobic recovery / endurance';
              types.push(asLong ? 'long_run' : 'easy_run');
              runs.push(run(asLong ? 'long' : 'easy', targetKm * RUN_SPLIT.sun, 3, 'Relaxed aerobic run. Adjust down if fatigued (RPE 3–4).'));
            }
          }
          break;
      }

      if (isRaceWeek && !isRaceDay) {
        // Race week: cut everything right down, keep legs fresh.
        for (const r of runs) {
          if (r.distanceKm) r.distanceKm = round1(Math.min(r.distanceKm, 5));
          r.targetRPE = Math.min(r.targetRPE ?? 4, 5);
          r.description = 'Race week — short and sharp only. Prioritise freshness. ' + (r.description ?? '');
        }
        exercises = exercises.slice(0, 1).map((e) => ({ ...e, sets: 2, targetRPE: 5 }));
        description = 'Taper week — volume is intentionally low. Sleep, hydrate, carbs up. ' + description;
      }

      out.push(mk(date, phase, w, title, types, focus, runs, exercises, hyroxStations, deload, warmup, cooldown, description, ts));
    }
  }
  return out;
}

function mk(
  date: string,
  phase: string,
  weekIndex: number,
  title: string,
  types: SessionType[],
  focus: string,
  runs: PlannedRun[],
  exercises: PlannedExercise[],
  hyroxStations: HyroxStationPlan[],
  deload: boolean,
  warmup: string,
  cooldown: string,
  description: string,
  ts: string,
): PlannedWorkout {
  return {
    id: uid(),
    eventDate: date,
    createdAt: ts,
    updatedAt: ts,
    source: 'seed',
    phase,
    weekIndex,
    title,
    types,
    focus,
    warmup,
    cooldown,
    runs,
    exercises,
    hyroxStations,
    deload,
    description,
  };
}

/** Sum of planned daily run distances for a week — used to validate vs target. */
export function plannedWeeklyKm(workouts: PlannedWorkout[]): number {
  return round1(
    workouts.reduce(
      (sum, w) => sum + w.runs.reduce((s, r) => s + (r.distanceKm ?? 0), 0),
      0,
    ),
  );
}

export function weeklyTargetKm(week: number): number {
  return WEEKLY_KM[Math.min(week - 1, WEEKLY_KM.length - 1)] ?? 30;
}

export function buildDefaultProfileDraft(): Partial<Profile> {
  // Prepopulated DRAFT values from historical reports — shown for confirmation,
  // never assumed current. Source noted for transparency.
  return {
    displayName: '',
    age: 23,
    heightCm: 180, // 5 ft 11 in ≈ 180.3 cm
    weightKg: 69,
    country: 'India',
    timezone: 'Asia/Kolkata',
    units: { distance: 'km', weight: 'kg', pace: 'min/km' },
    goals: ['hyrox', 'running', 'recomp'],
    primaryGoal: 'hyrox',
    weeklyVolumeKm: 35,
    longestRunKm: 15,
    easyPaceSecPerKm: undefined,
    tempoPaceSecPerKm: undefined,
    raceDivision: 'Men Open',
    raceDate: '2027-01-24',
    trainingStartDate: '2026-10-12',
    diet: 'vegetarian',
    lifts: [],
    equipment: [],
    preferredDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    supplements: [],
    avgSleepHours: 6.5,
    stepGoal: 8000,
    typicalSteps: 6000,
    waterTargetMl: 3000,
    typicalWaterMl: 3000,
    activityLevel: 'high',
    onboarded: false,
    historicalSource: 'Previously reported values (dates unknown) — confirm during onboarding.',
  };
}
