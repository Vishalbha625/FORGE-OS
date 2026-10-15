import type {
  HyroxRecord,
  MuscleGroup,
  NutritionEntry,
  PlannedWorkout,
  Profile,
  RecoveryRecord,
  RunRecord,
  SleepRecord,
  StrengthRecord,
} from '../db/types';
import type { Snapshot } from './coach';
import { addDays, daysBetween, endOfWeek, startOfMonth, startOfWeek } from './dates';
import { estimateNutrition, mean, round0, round1 } from './calc';
import { HYROX_STATIONS } from './constants';

// Pure aggregation for the analytics page, weekly review and dashboard.
// Everything is read from records on this device (R1). A day with nothing
// logged is undefined, never 0 (R2), and planned values stay separate from
// what was done (R3).

export type Period = 'week' | 'month' | 'last4';

export interface DateRange {
  start: string;
  end: string;
  days: string[];
}

export const PERIOD_LABELS: Record<Period, string> = { week: 'This week', month: 'This month', last4: 'Last 4 weeks' };
/** Fits "No {type} data {period}." */
export const PERIOD_PHRASE: Record<Period, string> = { week: 'this week', month: 'this month', last4: 'in the last 4 weeks' };

function daysFrom(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** This week runs Monday to Sunday, this month is the calendar month, last 4 weeks ends today. */
export function periodRange(period: Period, today: string): DateRange {
  let start: string;
  let end: string;
  if (period === 'week') {
    start = startOfWeek(today);
    end = endOfWeek(today);
  } else if (period === 'month') {
    start = startOfMonth(today);
    end = addDays(startOfMonth(addDays(start, 31)), -1);
  } else {
    start = addDays(today, -27);
    end = today;
  }
  return { start, end, days: daysFrom(start, end) };
}

const inRange = <T extends { eventDate: string }>(items: T[], start: string, end: string) =>
  items.filter((i) => i.eventDate >= start && i.eventDate <= end);

function byDay<T extends { eventDate: string }>(items: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const i of items) {
    const list = map.get(i.eventDate);
    if (list) list.push(i);
    else map.set(i.eventDate, [i]);
  }
  return map;
}

/** Mean of the defined values, or undefined when there are none. */
function meanDefined(values: (number | undefined)[]): number | undefined {
  return mean(values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v)));
}

const plannedRunKm = (p: PlannedWorkout) => p.runs.reduce((a, r) => a + (r.distanceKm ?? 0), 0);

// ── Running ─────────────────────────────────────────────────────────────────

export interface RunningDay {
  date: string;
  /** Distance run that day; undefined when no run was logged. */
  km?: number;
  /** Distance run so far in the period; undefined for days still to come. */
  cumulative?: number;
  /** Planned distance so far in the period; undefined without a plan. */
  plannedCumulative?: number;
}

export interface RunningSummary {
  days: RunningDay[];
  totalKm: number;
  runs: number;
  /** Total time over total distance. */
  avgPaceSecPerKm?: number;
  plannedKm?: number;
}

export function runningSeries(runs: RunRecord[], planned: PlannedWorkout[], range: DateRange, today: string): RunningSummary {
  const logged = inRange(runs, range.start, range.end);
  const plan = inRange(planned, range.start, range.end).filter((p) => plannedRunKm(p) > 0);
  const runsByDay = byDay(logged);
  const planByDay = byDay(plan);
  const hasPlan = plan.length > 0;

  let cum = 0;
  let planCum = 0;
  const days = range.days.map((date): RunningDay => {
    const dayRuns = runsByDay.get(date);
    const km = dayRuns ? round1(dayRuns.reduce((a, r) => a + r.distanceKm, 0)) : undefined;
    if (km !== undefined) cum += km;
    planCum += (planByDay.get(date) ?? []).reduce((a, p) => a + plannedRunKm(p), 0);
    return {
      date,
      km,
      cumulative: date <= today ? round1(cum) : undefined,
      plannedCumulative: hasPlan ? round1(planCum) : undefined,
    };
  });

  const totalKm = round1(logged.reduce((a, r) => a + r.distanceKm, 0));
  const timed = logged.filter((r) => r.distanceKm > 0 && r.durationSec > 0);
  const timedKm = timed.reduce((a, r) => a + r.distanceKm, 0);
  const avgPaceSecPerKm = timedKm > 0 ? round0(timed.reduce((a, r) => a + r.durationSec, 0) / timedKm) : undefined;
  return { days, totalKm, runs: logged.length, avgPaceSecPerKm, plannedKm: hasPlan ? round1(plan.reduce((a, p) => a + plannedRunKm(p), 0)) : undefined };
}

// ── Strength ────────────────────────────────────────────────────────────────

export type MuscleBucket = 'legs' | 'back' | 'chest' | 'shoulders' | 'arms' | 'core';
export const MUSCLE_BUCKETS: MuscleBucket[] = ['legs', 'back', 'chest', 'shoulders', 'arms', 'core'];
export const MUSCLE_LABELS: Record<MuscleBucket, string> = { legs: 'Legs', back: 'Back', chest: 'Chest', shoulders: 'Shoulders', arms: 'Arms', core: 'Core' };

const BUCKET_OF: Record<MuscleGroup, MuscleBucket> = {
  legs: 'legs',
  back: 'back',
  chest: 'chest',
  delts: 'shoulders',
  biceps: 'arms',
  triceps: 'arms',
  abs: 'core',
  core: 'core',
  fullbody: 'core',
};

export type StrengthDay = { date: string; total?: number } & Partial<Record<MuscleBucket, number>>;

export interface StrengthSummary {
  days: StrengthDay[];
  totalSets: number;
  /** Sum of reps x weight over completed sets that have both. */
  volumeKg: number;
  sessions: number;
  /** Buckets that have at least one set in the period, in legend order. */
  groups: MuscleBucket[];
}

export function strengthSeries(records: StrengthRecord[], range: DateRange): StrengthSummary {
  const logged = inRange(records, range.start, range.end);
  const recByDay = byDay(logged);
  const seen = new Set<MuscleBucket>();
  let totalSets = 0;
  let volumeKg = 0;

  const days = range.days.map((date): StrengthDay => {
    const recs = recByDay.get(date);
    if (!recs) return { date };
    const day: StrengthDay = { date };
    let total = 0;
    for (const r of recs) {
      for (const ex of r.exercises) {
        const done = ex.sets.filter((s) => s.completed);
        if (!done.length) continue;
        const bucket = BUCKET_OF[ex.group];
        day[bucket] = (day[bucket] ?? 0) + done.length;
        seen.add(bucket);
        total += done.length;
        for (const s of done) if (s.reps !== undefined && s.weightKg !== undefined) volumeKg += s.reps * s.weightKg;
      }
    }
    totalSets += total;
    return total > 0 ? { ...day, total } : { date };
  });

  return { days, totalSets, volumeKg: round0(volumeKg), sessions: logged.length, groups: MUSCLE_BUCKETS.filter((b) => seen.has(b)) };
}

// ── HYROX ───────────────────────────────────────────────────────────────────

export interface StationTime {
  station: string;
  /** Mean of the logged times for this station in the period. */
  avgSec: number;
  efforts: number;
}

export interface HyroxSummary {
  stations: StationTime[];
  sessions: number;
  /** Mean total time over sessions that have one. */
  avgCircuitSec?: number;
}

/** A session's total time: the logged total, else the sum of its timed parts. */
function circuitSec(h: HyroxRecord): number | undefined {
  if (h.totalTimeSec) return h.totalTimeSec;
  const parts = [...h.stations.map((s) => s.timeSec), ...(h.runSegments ?? []).map((r) => r.timeSec)].filter((t): t is number => !!t);
  return parts.length ? parts.reduce((a, t) => a + t, 0) : undefined;
}

export function hyroxSummary(records: HyroxRecord[], range: DateRange): HyroxSummary {
  const logged = inRange(records, range.start, range.end);
  const times = new Map<string, number[]>();
  for (const h of logged) {
    for (const s of h.stations) {
      if (!s.timeSec) continue;
      const list = times.get(s.station);
      if (list) list.push(s.timeSec);
      else times.set(s.station, [s.timeSec]);
    }
  }
  // Race order first, then any custom stations by name.
  const order = (name: string) => {
    const i = HYROX_STATIONS.findIndex((s) => s.station === name);
    return i === -1 ? HYROX_STATIONS.length : i;
  };
  const stations = [...times.entries()]
    .map(([station, t]) => ({ station, avgSec: round0(mean(t) ?? 0), efforts: t.length }))
    .sort((a, b) => order(a.station) - order(b.station) || a.station.localeCompare(b.station));
  const avg = meanDefined(logged.map(circuitSec));
  return { stations, sessions: logged.length, avgCircuitSec: avg === undefined ? undefined : round0(avg) };
}

// ── Nutrition ───────────────────────────────────────────────────────────────

export interface NutritionDay {
  date: string;
  /** Calories from each logged macro (4/4/9 kcal per gram); undefined when none logged. */
  proteinKcal?: number;
  carbsKcal?: number;
  fatKcal?: number;
  /** Calories as logged (may differ from the macro sum). */
  calories?: number;
}

export interface NutritionSummary {
  days: NutritionDay[];
  /** Mean over the days that have calories logged. */
  avgCalories?: number;
  loggedDays: number;
  /** Share of macro calories in the period, rounded percentages. */
  macroPct?: { protein: number; carbs: number; fat: number };
  /** Logged target, else the Mifflin-St Jeor estimate. */
  targetCalories?: number;
}

const sumDefined = (values: (number | undefined)[]): number | undefined => {
  const defined = values.filter((v): v is number => typeof v === 'number');
  return defined.length ? defined.reduce((a, v) => a + v, 0) : undefined;
};

/** Average calories per day, counting only days with calories logged. */
export function averageDailyCalories(entries: NutritionEntry[]): number | undefined {
  const perDay = [...byDay(entries).values()].map((list) => sumDefined(list.map((e) => e.calories)));
  const avg = meanDefined(perDay);
  return avg === undefined ? undefined : round0(avg);
}

export function nutritionSeries(entries: NutritionEntry[], range: DateRange, profile: Profile | null): NutritionSummary {
  const logged = inRange(entries, range.start, range.end);
  const entByDay = byDay(logged);
  let p = 0;
  let c = 0;
  let f = 0;
  const days = range.days.map((date): NutritionDay => {
    const list = entByDay.get(date);
    if (!list) return { date };
    const protein = sumDefined(list.map((e) => e.protein));
    const carbs = sumDefined(list.map((e) => e.carbs));
    const fat = sumDefined(list.map((e) => e.fat));
    p += protein ?? 0;
    c += carbs ?? 0;
    f += fat ?? 0;
    return {
      date,
      proteinKcal: protein === undefined ? undefined : round0(protein * 4),
      carbsKcal: carbs === undefined ? undefined : round0(carbs * 4),
      fatKcal: fat === undefined ? undefined : round0(fat * 9),
      calories: sumDefined(list.map((e) => e.calories)),
    };
  });
  const macroKcal = p * 4 + c * 4 + f * 9;
  const macroPct = macroKcal > 0 ? { protein: round0((p * 400) / macroKcal), carbs: round0((c * 400) / macroKcal), fat: round0((f * 900) / macroKcal) } : undefined;
  const est = profile ? estimateNutrition(profile) : undefined;
  return {
    days,
    avgCalories: averageDailyCalories(logged),
    loggedDays: days.filter((d) => d.calories !== undefined).length,
    macroPct,
    targetCalories: profile?.calorieTarget ?? est?.calories,
  };
}

// ── Recovery ────────────────────────────────────────────────────────────────

export type RecoveryMetric = 'fatigue' | 'soreness' | 'motivation' | 'stress';
export const RECOVERY_METRICS: RecoveryMetric[] = ['fatigue', 'soreness', 'motivation', 'stress'];
export type Trend = 'up' | 'down' | 'flat';

export type RecoveryDay = { date: string } & Partial<Record<RecoveryMetric, number>>;

export interface RecoverySummary {
  days: RecoveryDay[];
  loggedDays: number;
  /** Last 7 days against the 7 before, per metric; undefined when either week is empty. */
  trend: Partial<Record<RecoveryMetric, Trend>>;
}

function trendOf(recent: number | undefined, before: number | undefined): Trend | undefined {
  if (recent === undefined || before === undefined) return undefined;
  const d = recent - before;
  return Math.abs(d) < 0.25 ? 'flat' : d > 0 ? 'up' : 'down';
}

export function recoverySeries(records: RecoveryRecord[], range: DateRange, today: string): RecoverySummary {
  const recByDay = byDay(inRange(records, range.start, range.end));
  const days = range.days.map((date): RecoveryDay => {
    const list = recByDay.get(date);
    const day: RecoveryDay = { date };
    if (!list) return day;
    for (const m of RECOVERY_METRICS) {
      const v = meanDefined(list.map((r) => r[m]));
      if (v !== undefined) day[m] = round1(v);
    }
    return day;
  });
  const recent = inRange(records, addDays(today, -6), today);
  const before = inRange(records, addDays(today, -13), addDays(today, -7));
  const trend: Partial<Record<RecoveryMetric, Trend>> = {};
  for (const m of RECOVERY_METRICS) {
    const t = trendOf(meanDefined(recent.map((r) => r[m])), meanDefined(before.map((r) => r[m])));
    if (t) trend[m] = t;
  }
  return { days, loggedDays: days.filter((d) => RECOVERY_METRICS.some((m) => d[m] !== undefined)).length, trend };
}

/** Readiness on the 1-5 scale, higher is better: fatigue, soreness and stress count inverted. */
export function readinessScore(r: RecoveryRecord): number | undefined {
  return meanDefined([r.fatigue === undefined ? undefined : 6 - r.fatigue, r.soreness === undefined ? undefined : 6 - r.soreness, r.motivation, r.stress === undefined ? undefined : 6 - r.stress]);
}

// ── Sleep ───────────────────────────────────────────────────────────────────

export interface SleepDay {
  date: string;
  hours?: number;
  /** Mean of the nights logged in the 7 days ending here; undefined if none or still to come. */
  rolling?: number;
}

export interface SleepSummary {
  days: SleepDay[];
  avgHours?: number;
  nights: number;
}

export function sleepSeries(records: SleepRecord[], range: DateRange, today?: string): SleepSummary {
  const hoursByDay = new Map<string, number>();
  for (const [date, list] of byDay(records)) hoursByDay.set(date, list.reduce((a, s) => a + s.durationMin, 0) / 60);
  const days = range.days.map((date): SleepDay => {
    const h = hoursByDay.get(date);
    const window: (number | undefined)[] = [];
    for (let i = 6; i >= 0; i--) window.push(hoursByDay.get(addDays(date, -i)));
    const rolling = today !== undefined && date > today ? undefined : meanDefined(window);
    return { date, hours: h === undefined ? undefined : round1(h), rolling: rolling === undefined ? undefined : round1(rolling) };
  });
  const inPeriod = days.filter((d) => d.hours !== undefined);
  const avg = meanDefined(inPeriod.map((d) => d.hours));
  return { days, avgHours: avg === undefined ? undefined : round1(avg), nights: inPeriod.length };
}

// ── Weekly review ───────────────────────────────────────────────────────────

export type ReviewStatus = 'on_track' | 'needs_attention' | 'behind';

/**
 * On track within 10% of the planned distance (or ahead of it), needs
 * attention 10 to 20% below, behind more than 20% below. No plan, no status.
 */
export function weeklyStatus(actualKm: number, plannedKm: number | undefined): ReviewStatus | undefined {
  if (plannedKm === undefined || plannedKm <= 0) return undefined;
  const ratio = actualKm / plannedKm;
  if (ratio >= 0.9) return 'on_track';
  if (ratio >= 0.8) return 'needs_attention';
  return 'behind';
}

export interface WeeklyReviewData {
  weekStart: string;
  weekEnd: string;
  /** Plan week number and length; undefined without a plan this week. */
  weekIndex?: number;
  totalWeeks?: number;
  km: number;
  /** Planned distance for the days so far (today counts once a run is logged). */
  plannedKmToDate?: number;
  strengthSets: number;
  strengthSessions: number;
  avgCalories?: number;
  avgSleepHours?: number;
  /** Mean readiness, 1-5, higher is better. */
  avgRecovery?: number;
  status?: ReviewStatus;
}

export function weeklyReview(s: Snapshot): WeeklyReviewData {
  const range = periodRange('week', s.today);
  const plan = inRange(s.planned, range.start, range.end);
  const runs = inRange(s.runs, range.start, range.end);
  const ranToday = runs.some((r) => r.eventDate === s.today);
  const planSoFar = plan.filter((p) => p.eventDate < s.today || (p.eventDate === s.today && ranToday));
  const hasRunPlan = plan.some((p) => plannedRunKm(p) > 0);
  const plannedKmToDate = hasRunPlan ? round1(planSoFar.reduce((a, p) => a + plannedRunKm(p), 0)) : undefined;
  const km = round1(runs.reduce((a, r) => a + r.distanceKm, 0));
  const strength = strengthSeries(s.strength, range);
  const sleep = sleepSeries(s.sleep, range);
  const readiness = meanDefined(inRange(s.recovery, range.start, range.end).map(readinessScore));
  const weekIndex = plan.find((p) => p.weekIndex > 0)?.weekIndex;
  const totalWeeks = weekIndex === undefined ? undefined : Math.max(...s.planned.map((p) => p.weekIndex));
  // Early in the week nothing is due yet: wait for planned distance before judging.
  const status = plannedKmToDate ? weeklyStatus(km, plannedKmToDate) : undefined;
  return {
    weekStart: range.start,
    weekEnd: range.end,
    weekIndex,
    totalWeeks,
    km,
    plannedKmToDate,
    strengthSets: strength.totalSets,
    strengthSessions: strength.sessions,
    avgCalories: averageDailyCalories(inRange(s.nutrition, range.start, range.end)),
    avgSleepHours: sleep.avgHours,
    avgRecovery: readiness === undefined ? undefined : round1(readiness),
    status,
  };
}

// ── Dashboard status ────────────────────────────────────────────────────────

export type DashboardStatus = 'recovery' | 'needs_attention' | 'on_track';

export interface DashboardStatusResult {
  status: DashboardStatus;
  reason: string;
}

/** Recovery logs use a 1-5 scale; 4 and up is high. */
const HIGH_RECOVERY_SCORE = 4;

/**
 * Recovery recommended when the latest check-in (today or yesterday) has high
 * fatigue or soreness, or sleep has averaged under 6 h over the last 7 days.
 * Needs attention when 2 or more planned sessions were missed this week.
 */
export function dashboardStatus(s: Snapshot): DashboardStatusResult {
  const latest = [...s.recovery].filter((r) => r.eventDate <= s.today).sort((a, b) => b.eventDate.localeCompare(a.eventDate))[0];
  if (latest && daysBetween(latest.eventDate, s.today) <= 1) {
    if ((latest.fatigue ?? 0) >= HIGH_RECOVERY_SCORE) return { status: 'recovery', reason: `Fatigue is high (${latest.fatigue}/5). Keep today easy.` };
    if ((latest.soreness ?? 0) >= HIGH_RECOVERY_SCORE) return { status: 'recovery', reason: `Soreness is high (${latest.soreness}/5). Keep today easy.` };
  }
  const lastWeekSleep = inRange(s.sleep, addDays(s.today, -6), s.today);
  const sleepAvg = meanDefined(lastWeekSleep.map((x) => x.durationMin / 60));
  if (sleepAvg !== undefined && sleepAvg < 6) return { status: 'recovery', reason: `Sleep has averaged ${round1(sleepAvg)} h over the last 7 days.` };

  const range = periodRange('week', s.today);
  const loggedDays = new Set([...s.runs, ...s.strength, ...s.hyrox].map((r) => r.eventDate));
  const missed = inRange(s.planned, range.start, addDays(s.today, -1)).filter((p) => !p.types.includes('rest') && !loggedDays.has(p.eventDate)).length;
  if (missed >= 2) return { status: 'needs_attention', reason: `${missed} planned sessions missed this week.` };
  return { status: 'on_track', reason: missed === 1 ? 'One planned session missed this week. The rest are on schedule.' : 'Training and recovery are on schedule.' };
}
