import type {
  Profile,
  RunRecord,
  StrengthRecord,
  HyroxRecord,
  NutritionEntry,
  SleepRecord,
  StepRecord,
  BodyRecord,
  RecoveryRecord,
  WaterEntry,
  PlannedWorkout,
} from '../db/types';
import {
  addDays,
  daysBetween,
  endOfWeek,
  fmtDate,
  startOfWeek,
} from './dates';
import { fmtPace, fmtDuration, mean, round1, round0 } from './calc';

export interface Snapshot {
  profile: Profile | null;
  planned: PlannedWorkout[];
  runs: RunRecord[];
  strength: StrengthRecord[];
  hyrox: HyroxRecord[];
  nutrition: NutritionEntry[];
  sleep: SleepRecord[];
  steps: StepRecord[];
  body: BodyRecord[];
  recovery: RecoveryRecord[];
  water: WaterEntry[];
  today: string;
}

export interface CoachAnswer {
  text: string;
  /** Classify each line: fact | calculation | estimate | suggestion | missing */
  tags: string[];
}

function inRange<T extends { eventDate: string }>(items: T[], from: string, to: string): T[] {
  return items.filter((i) => i.eventDate >= from && i.eventDate <= to);
}
function onDay<T extends { eventDate: string }>(items: T[], day: string): T[] {
  return items.filter((i) => i.eventDate === day);
}

// ── Weekly report ─────────────────────────────────────────────────────────────

export interface WeeklyReport {
  weekStart: string;
  weekEnd: string;
  planned: { total: number; completed: number; missed: number };
  running: { plannedKm: number; actualKm: number; runs: number };
  strengthSessions: number;
  nutrition: { daysLogged: number; avgCalories?: number; avgProtein?: number };
  avgSleepHours?: number;
  stepsAvg?: number;
  recovery: { avgFatigue?: number; avgSoreness?: number; concerns: string[] };
  improvements: string[];
  setbacks: string[];
  priorities: string[];
}

export function generateWeeklyReport(s: Snapshot, refDate?: string): WeeklyReport {
  const ref = refDate ?? s.today;
  const ws = startOfWeek(ref);
  const we = endOfWeek(ref);
  const prevWs = addDays(ws, -7);
  const prevWe = addDays(we, -7);

  const planned = inRange(s.planned, ws, we).filter((p) => !p.types.includes('rest'));
  const runs = inRange(s.runs, ws, we);
  const prevRuns = inRange(s.runs, prevWs, prevWe);
  const strength = inRange(s.strength, ws, we);
  const sleep = inRange(s.sleep, ws, we);
  const steps = inRange(s.steps, ws, we);
  const nutrition = inRange(s.nutrition, ws, we);
  const recovery = inRange(s.recovery, ws, we);

  // Completed planned = any day with a matching logged session.
  const loggedDays = new Set<string>([
    ...runs.map((r) => r.eventDate),
    ...strength.map((r) => r.eventDate),
    ...s.hyrox.filter((h) => h.eventDate >= ws && h.eventDate <= we).map((h) => h.eventDate),
  ]);
  const completed = planned.filter((p) => loggedDays.has(p.eventDate)).length;
  const pastPlanned = planned.filter((p) => p.eventDate < s.today);
  const missed = pastPlanned.filter((p) => !loggedDays.has(p.eventDate)).length;

  const plannedKm = round1(
    planned.reduce((sum, p) => sum + p.runs.reduce((a, r) => a + (r.distanceKm ?? 0), 0), 0),
  );
  const actualKm = round1(runs.reduce((a, r) => a + r.distanceKm, 0));
  const prevKm = round1(prevRuns.reduce((a, r) => a + r.distanceKm, 0));

  const sleepHrs = sleep.length ? round1(mean(sleep.map((x) => x.durationMin / 60)) ?? 0) : undefined;
  const stepsAvg = steps.length ? round0(mean(steps.map((x) => x.steps)) ?? 0) : undefined;

  const nutDays = new Set(nutrition.map((n) => n.eventDate)).size;
  const calsByDay = groupSum(nutrition, 'calories');
  const protByDay = groupSum(nutrition, 'protein');
  const avgCalories = calsByDay.length ? round0(mean(calsByDay) ?? 0) : undefined;
  const avgProtein = protByDay.length ? round0(mean(protByDay) ?? 0) : undefined;

  const avgFatigue = recovery.length ? round1(mean(recovery.map((r) => r.fatigue ?? NaN).filter((n) => !isNaN(n))) ?? 0) : undefined;
  const avgSoreness = recovery.length ? round1(mean(recovery.map((r) => r.soreness ?? NaN).filter((n) => !isNaN(n))) ?? 0) : undefined;

  const concerns: string[] = [];
  if (sleepHrs !== undefined && sleepHrs < 7) concerns.push(`Average sleep ${sleepHrs} h is below 7 h.`);
  if (avgFatigue !== undefined && avgFatigue >= 4) concerns.push(`High average fatigue (${avgFatigue}/5).`);
  if (avgSoreness !== undefined && avgSoreness >= 4) concerns.push(`High average soreness (${avgSoreness}/5).`);

  const improvements: string[] = [];
  const setbacks: string[] = [];
  if (prevRuns.length) {
    if (actualKm > prevKm) improvements.push(`Weekly mileage up from ${prevKm} to ${actualKm} km.`);
    else if (actualKm < prevKm) setbacks.push(`Weekly mileage down from ${prevKm} to ${actualKm} km.`);
  }
  if (completed >= planned.length && planned.length > 0) improvements.push('Completed all planned sessions so far.');
  if (missed > 0) setbacks.push(`${missed} planned session${missed > 1 ? 's' : ''} missed.`);

  const priorities = buildPriorities({ missed, sleepHrs, actualKm, plannedKm, nutDays, concerns, avgProtein, profile: s.profile });

  return {
    weekStart: ws,
    weekEnd: we,
    planned: { total: planned.length, completed, missed },
    running: { plannedKm, actualKm, runs: runs.length },
    strengthSessions: strength.length,
    nutrition: { daysLogged: nutDays, avgCalories, avgProtein },
    avgSleepHours: sleepHrs,
    stepsAvg,
    recovery: { avgFatigue, avgSoreness, concerns },
    improvements,
    setbacks,
    priorities,
  };
}

function buildPriorities(d: {
  missed: number;
  sleepHrs?: number;
  actualKm: number;
  plannedKm: number;
  nutDays: number;
  concerns: string[];
  avgProtein?: number;
  profile: Profile | null;
}): string[] {
  const pr: string[] = [];
  if (d.sleepHrs !== undefined && d.sleepHrs < 7) pr.push('Prioritise sleep — aim for 7–8 h to support training adaptation.');
  if (d.missed > 0) pr.push('Rebuild consistency — complete the planned key sessions (long run, tempo, HYROX).');
  if (d.plannedKm > 0 && d.actualKm < d.plannedKm * 0.8) pr.push(`Close the running gap — you hit ${d.actualKm}/${d.plannedKm} km planned.`);
  const protTarget = d.profile?.proteinTarget;
  if (protTarget && d.avgProtein !== undefined && d.avgProtein < protTarget * 0.85)
    pr.push(`Raise protein toward ${protTarget} g/day (logged ≈ ${d.avgProtein} g).`);
  if (d.nutDays < 3) pr.push('Log nutrition more consistently so targets become meaningful.');
  while (pr.length < 3) {
    const fillers = [
      'Keep easy runs easy (RPE 3–4) to protect quality sessions.',
      'Practice HYROX transitions — small time savings compound.',
      'Hydrate to target and keep carbs up around long runs.',
    ];
    const next = fillers[pr.length % fillers.length];
    if (!pr.includes(next)) pr.push(next);
    else break;
  }
  return pr.slice(0, 3);
}

function groupSum(items: NutritionEntry[], key: 'calories' | 'protein'): number[] {
  const map = new Map<string, number>();
  for (const i of items) map.set(i.eventDate, (map.get(i.eventDate) ?? 0) + (i[key] ?? 0));
  return [...map.values()];
}

// ── Conversational coach (rule-based, data-backed) ───────────────────────────

export function answerQuestion(q: string, s: Snapshot): CoachAnswer {
  const t = q.toLowerCase();
  const today = s.today;

  if (!s.profile) {
    return { text: 'Finish onboarding first so I can use your profile and plan.', tags: ['missing'] };
  }

  // Today's / yesterday's workout
  if (/(workout|train).*(today)|today.*(workout|train)|what.*today/.test(t)) {
    const p = onDay(s.planned, today)[0];
    if (!p) return { text: `No session is planned for today (${fmtDate(today)}). This may be a rest day or outside your plan window.`, tags: ['fact'] };
    const runBits = p.runs.map((r) => `${r.kind} run ${r.distanceKm ?? '?'} km (RPE ${r.targetRPE ?? '-'})`).join(', ');
    const lift = p.exercises.length ? `${p.exercises.length} strength exercises (${[...new Set(p.exercises.map((e) => e.group))].join(', ')})` : '';
    const hx = p.hyroxStations.length ? `HYROX: ${p.hyroxStations.map((h) => h.station).join(', ')}` : '';
    return {
      text: `Today (${fmtDate(today)}, Week ${p.weekIndex}, ${p.phase}): **${p.title}**.\n${[runBits, lift, hx].filter(Boolean).join('\n')}\nFocus: ${p.focus}.`,
      tags: ['fact'],
    };
  }
  if (/yesterday/.test(t)) {
    const y = addDays(today, -1);
    const runs = onDay(s.runs, y);
    const str = onDay(s.strength, y);
    const hx = onDay(s.hyrox, y);
    if (!runs.length && !str.length && !hx.length) return { text: `I have no logged activity for yesterday (${fmtDate(y)}).`, tags: ['missing'] };
    const bits: string[] = [];
    runs.forEach((r) => bits.push(`Ran ${r.distanceKm} km in ${fmtDuration(r.durationSec)} (${fmtPace(r.avgPaceSecPerKm)} /km)`));
    str.forEach((r) => bits.push(`Strength: ${r.title} (${r.exercises.length} exercises)`));
    hx.forEach((r) => bits.push(`HYROX: ${r.title}`));
    return { text: `Yesterday (${fmtDate(y)}): ${bits.join('; ')}.`, tags: ['fact'] };
  }

  // Weekly mileage
  if (/(how many).*(km|kilometre|mile|run).*(week)|km.*this week|mileage/.test(t)) {
    const ws = startOfWeek(today);
    const we = endOfWeek(today);
    const runs = inRange(s.runs, ws, we);
    const km = round1(runs.reduce((a, r) => a + r.distanceKm, 0));
    const planned = inRange(s.planned, ws, we).reduce((a, p) => a + p.runs.reduce((x, r) => x + (r.distanceKm ?? 0), 0), 0);
    return {
      text: `This week (${fmtDate(ws)}–${fmtDate(we)}) you've run **${km} km** across ${runs.length} run${runs.length === 1 ? '' : 's'}. Planned for the week: ${round1(planned)} km.`,
      tags: ['calculation'],
    };
  }

  // Protein today
  if (/protein.*(today|logged)|how much protein/.test(t)) {
    const n = onDay(s.nutrition, today);
    if (!n.length) return { text: `No meals logged today, so I can't total your protein. Log a meal and I'll track it.`, tags: ['missing'] };
    const prot = round0(n.reduce((a, x) => a + (x.protein ?? 0), 0));
    const target = s.profile.proteinTarget;
    return { text: `You've logged **${prot} g protein** today${target ? ` of a ${target} g target (${Math.round((prot / target) * 100)}%)` : ''}.`, tags: ['calculation'] };
  }

  // Last squat / lift weight
  if (/(last|recent).*(squat|bench|deadlift|press|lift)|squat weight/.test(t)) {
    const liftName = /squat/.test(t) ? 'squat' : /bench/.test(t) ? 'bench' : /deadlift/.test(t) ? 'deadlift' : /press/.test(t) ? 'press' : 'squat';
    const found = [...s.strength]
      .sort((a, b) => b.eventDate.localeCompare(a.eventDate))
      .flatMap((r) => r.exercises.filter((e) => e.name.toLowerCase().includes(liftName)).map((e) => ({ date: r.eventDate, e })));
    if (!found.length) return { text: `I have no logged ${liftName} sets yet. Log a strength session and I'll track your working weights.`, tags: ['missing'] };
    const last = found[0];
    const best = last.e.sets.filter((x) => x.weightKg).sort((a, b) => (b.weightKg ?? 0) - (a.weightKg ?? 0))[0];
    return { text: `Your last ${last.e.name} was on ${fmtDate(last.date)} — top set ${best?.weightKg ?? '?'} kg × ${best?.reps ?? '?'} reps.`, tags: ['fact'] };
  }

  // Sleep this week
  if (/sleep.*(week)|how.*hours.*sleep|hours.*sleep.*week/.test(t)) {
    const ws = startOfWeek(today);
    const we = endOfWeek(today);
    const sl = inRange(s.sleep, ws, we);
    if (!sl.length) return { text: `No sleep records this week yet.`, tags: ['missing'] };
    const avg = round1(mean(sl.map((x) => x.durationMin / 60)) ?? 0);
    return { text: `This week you've logged ${sl.length} night${sl.length === 1 ? '' : 's'}, averaging **${avg} h** per night.`, tags: ['calculation'] };
  }

  // On track for HYROX
  if (/on track|ready.*hyrox|hyrox.*track/.test(t)) {
    const days = daysBetween(today, s.profile.raceDate);
    const ws = startOfWeek(today);
    const we = endOfWeek(today);
    const km = round1(inRange(s.runs, ws, we).reduce((a, r) => a + r.distanceKm, 0));
    const sims = s.hyrox.filter((h) => h.mode === 'simulation' || h.mode === 'combo').length;
    const lines = [
      `${days} days to race day (${fmtDate(s.profile.raceDate)}).`,
      `This week's running so far: ${km} km.`,
      sims ? `${sims} HYROX simulation/combo session(s) logged.` : 'No HYROX simulations logged yet — these matter most in the Specific phase.',
      'This is a status summary from your logs, not a guarantee. Consistency on long runs, tempo and HYROX combos is what moves the needle.',
    ];
    return { text: lines.join('\n'), tags: ['calculation', 'suggestion'] };
  }

  // Pace change
  if (/pace.*(change|improv|progress|trend)/.test(t)) {
    const easy = [...s.runs].filter((r) => r.kind === 'easy' && r.avgPaceSecPerKm).sort((a, b) => a.eventDate.localeCompare(b.eventDate));
    if (easy.length < 2) return { text: `I need at least two easy runs with pace to show a trend. Logged so far: ${easy.length}.`, tags: ['missing'] };
    const first = easy[0], last = easy[easy.length - 1];
    const delta = (first.avgPaceSecPerKm ?? 0) - (last.avgPaceSecPerKm ?? 0);
    const dir = delta > 0 ? 'faster' : delta < 0 ? 'slower' : 'unchanged';
    return { text: `Easy pace went from ${fmtPace(first.avgPaceSecPerKm)} /km (${fmtDate(first.eventDate)}) to ${fmtPace(last.avgPaceSecPerKm)} /km (${fmtDate(last.eventDate)}) — ${Math.abs(delta)} s/km ${dir}. Correlation, not proof; conditions and effort vary.`, tags: ['calculation'] };
  }

  // Recovery
  if (/recover|fatigue|sore/.test(t)) {
    const recent = inRange(s.recovery, addDays(today, -6), today);
    if (!recent.length) return { text: `No recovery logs in the last 7 days. Log fatigue, soreness and sleep so I can advise.`, tags: ['missing'] };
    const f = mean(recent.map((r) => r.fatigue ?? NaN).filter((n) => !isNaN(n)));
    const so = mean(recent.map((r) => r.soreness ?? NaN).filter((n) => !isNaN(n)));
    const sl = inRange(s.sleep, addDays(today, -6), today);
    const slh = sl.length ? round1(mean(sl.map((x) => x.durationMin / 60)) ?? 0) : undefined;
    const advice = (f ?? 0) >= 4 || (slh !== undefined && slh < 6)
      ? 'Signals suggest easing off — consider reducing today\'s intensity or swapping in easy aerobic work.'
      : 'Signals look manageable — proceed as planned and keep monitoring.';
    return { text: `Last 7 days: avg fatigue ${f ? round1(f) : '—'}/5, soreness ${so ? round1(so) : '—'}/5${slh ? `, sleep ${slh} h` : ''}. ${advice}`, tags: ['calculation', 'suggestion'] };
  }

  // Priorities today
  if (/priorit|focus.*today|biggest.*today/.test(t)) {
    const rep = generateWeeklyReport(s);
    return { text: `Top priorities:\n${rep.priorities.map((p, i) => `${i + 1}. ${p}`).join('\n')}`, tags: ['suggestion'] };
  }

  // Summarize last 7 days
  if (/summar.*(7|seven|week|last)|last 7 days/.test(t)) {
    const rep = generateWeeklyReport(s);
    return { text: summarizeReport(rep), tags: ['calculation'] };
  }

  // Compare month
  if (/compare.*month|month.*(compare|vs|previous)/.test(t)) {
    const thisMonth = monthKm(s.runs, today, 0);
    const lastMonth = monthKm(s.runs, today, -1);
    return { text: `Running volume — this month: ${thisMonth} km; previous month: ${lastMonth} km. ${thisMonth > lastMonth ? 'Trending up.' : thisMonth < lastMonth ? 'Lower than last month.' : 'About the same.'}`, tags: ['calculation'] };
  }

  // Eat after/before training (nutrition)
  if (/(eat|meal).*(after|post|before|pre).*(run|train|workout)|what.*eat/.test(t)) {
    const n = onDay(s.nutrition, today);
    const remaining = s.profile.calorieTarget ? s.profile.calorieTarget - n.reduce((a, x) => a + (x.calories ?? 0), 0) : undefined;
    const pre = /before|pre/.test(t);
    const base = pre
      ? 'Before a run/tempo: easy carbs 1–2 h prior — banana + oats, toast with honey, or a dash of dates. Keep fat/fibre low to avoid GI distress.'
      : 'After training: protein + carbs within ~60 min — e.g. paneer/tofu bowl with rice, Greek yogurt + fruit + whey, or dal + roti. Rehydrate.';
    const veg = s.profile.diet.toLowerCase().includes('veg') ? ' (vegetarian options given.)' : '';
    return { text: `${base}${veg}${remaining !== undefined ? ` You have ~${round0(remaining)} kcal left today.` : ''}`, tags: ['suggestion'] };
  }

  // Improve next week
  if (/improve.*next week|next week/.test(t)) {
    const rep = generateWeeklyReport(s);
    return { text: `For next week:\n${rep.priorities.map((p, i) => `${i + 1}. ${p}`).join('\n')}`, tags: ['suggestion'] };
  }

  // Fallback
  return {
    text:
      "I can answer from your logged data. Try: \"What's my workout today?\", \"How many km this week?\", \"How much protein today?\", \"Am I on track for HYROX?\", \"Summarize my last 7 days\", or \"What should I eat after training?\". I only use data you've logged — I won't invent workouts, meals or metrics.",
    tags: ['suggestion'],
  };
}

function summarizeReport(r: WeeklyReport): string {
  const lines = [
    `**Week ${fmtDate(r.weekStart)}–${fmtDate(r.weekEnd)}**`,
    `• Sessions: ${r.planned.completed}/${r.planned.total} completed${r.planned.missed ? `, ${r.planned.missed} missed` : ''}.`,
    `• Running: ${r.running.actualKm} km actual vs ${r.running.plannedKm} km planned (${r.running.runs} runs).`,
    `• Strength sessions: ${r.strengthSessions}.`,
    `• Nutrition: ${r.nutrition.daysLogged} day(s) logged${r.nutrition.avgProtein ? `, ~${r.nutrition.avgProtein} g protein/day` : ''}.`,
    `• Sleep: ${r.avgSleepHours !== undefined ? `${r.avgSleepHours} h avg` : 'no data'}. Steps: ${r.stepsAvg !== undefined ? `${r.stepsAvg}/day` : 'no data'}.`,
  ];
  if (r.recovery.concerns.length) lines.push(`• Recovery: ${r.recovery.concerns.join(' ')}`);
  lines.push(`Priorities: ${r.priorities.join(' · ')}`);
  return lines.join('\n');
}

function monthKm(runs: RunRecord[], ref: string, offsetMonths: number): number {
  const [y, m] = ref.split('-').map(Number);
  const target = new Date(y, m - 1 + offsetMonths, 1);
  const key = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}`;
  return round1(runs.filter((r) => r.eventDate.startsWith(key)).reduce((a, r) => a + r.distanceKm, 0));
}

// Daily status for dashboard
export type DayStatus = 'on_track' | 'needs_attention' | 'recovery' | 'missing';

export function computeDayStatus(s: Snapshot): { status: DayStatus; reasons: string[] } {
  const today = s.today;
  const reasons: string[] = [];
  const recToday = onDay(s.recovery, today)[0];
  const sleepLast = [...s.sleep].sort((a, b) => b.eventDate.localeCompare(a.eventDate))[0];
  const hasAnyToday =
    onDay(s.runs, today).length || onDay(s.strength, today).length || onDay(s.nutrition, today).length || recToday || onDay(s.sleep, today).length;

  if (recToday && ((recToday.fatigue ?? 0) >= 4 || (recToday.soreness ?? 0) >= 4)) {
    reasons.push('High fatigue/soreness logged today.');
    return { status: 'recovery', reasons };
  }
  if (sleepLast && sleepLast.eventDate >= addDays(today, -1) && sleepLast.durationMin / 60 < 6) {
    reasons.push(`Last sleep ${round1(sleepLast.durationMin / 60)} h — below 6 h.`);
    return { status: 'needs_attention', reasons };
  }
  if (!hasAnyToday) {
    reasons.push('Nothing logged yet today.');
    return { status: 'missing', reasons };
  }
  reasons.push('Recovery signals look fine and you\'re logging data.');
  return { status: 'on_track', reasons };
}
