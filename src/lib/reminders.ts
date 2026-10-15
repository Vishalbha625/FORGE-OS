import type { Reminder, Settings } from '../db/types';
import { DEFAULT_TZ, addDays, clockAt, toISODate, weekday } from './dates';

export const DEFAULT_MEAL_TIMES = ['08:30', '13:30', '20:30'];
/** Water reminders repeat this often from their start time until bedtime. */
export const WATER_INTERVAL_MIN = 120;
const DEFAULT_BEDTIME = '22:30';

export const DEFAULT_REMINDERS: Reminder[] = [
  { key: 'workout', label: 'Workout start', time: '06:30', enabled: false },
  { key: 'bedtime', label: 'Bedtime routine', time: DEFAULT_BEDTIME, enabled: false },
  { key: 'water', label: 'Water every 2 hours', time: '08:00', enabled: false },
  { key: 'meal', label: 'Meal logging (3 a day)', time: DEFAULT_MEAL_TIMES[2], times: DEFAULT_MEAL_TIMES, enabled: false },
  { key: 'weigh', label: 'Weekly weigh-in (Mondays)', time: '07:00', enabled: false },
  { key: 'review', label: 'Weekly review (Sundays)', time: '19:00', enabled: false },
  { key: 'race', label: 'Race countdown', time: '08:00', enabled: false },
  { key: 'missing', label: 'Missing workout log', time: '20:30', enabled: false },
];

export type ReminderKey = 'workout' | 'bedtime' | 'water' | 'meal' | 'weigh' | 'review' | 'race' | 'missing';

/** Weekly reminders fire on one ISO weekday (1=Mon..7=Sun); the rest fire daily. */
const WEEKDAY: Partial<Record<string, number>> = { review: 7, weigh: 1 };

/**
 * Add any default reminders missing from a saved list. The user's on/off and
 * times are kept; labels always come from the defaults, so a reminder that
 * changed meaning (weigh-in is now weekly) never shows an old label.
 */
export function mergeReminders(saved: Reminder[]): Reminder[] {
  const byKey = new Map(saved.map((r) => [r.key, r]));
  return DEFAULT_REMINDERS.map((d) => {
    const s = byKey.get(d.key);
    if (!s) return d;
    const merged: Reminder = { ...d, enabled: s.enabled, time: s.time ?? d.time };
    if (d.key === 'meal') {
      // Older settings saved one evening meal time: keep it as the last slot.
      merged.times = s.times?.length ? s.times : [DEFAULT_MEAL_TIMES[0], DEFAULT_MEAL_TIMES[1], s.time ?? DEFAULT_MEAL_TIMES[2]];
    }
    return merged;
  });
}

/** True when HH:MM `t` falls inside quiet hours (supports ranges past midnight). */
export function inQuietHours(t: string, qh?: { start: string; end: string }): boolean {
  if (!qh || !qh.start || !qh.end || qh.start === qh.end) return false;
  return qh.start < qh.end ? t >= qh.start && t < qh.end : t >= qh.start || t < qh.end;
}

const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
const toClock = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/**
 * The times of day a reminder fires, sorted. Meals have three; water repeats
 * every 2 hours from its start time while awake (until an hour before the
 * bedtime reminder's time); everything else fires once.
 */
export function reminderSlots(r: Reminder, all: Reminder[] = []): string[] {
  if (r.key === 'meal') return [...(r.times?.length ? r.times : DEFAULT_MEAL_TIMES)].sort();
  if (!r.time) return [];
  if (r.key === 'water') {
    const bed = all.find((x) => x.key === 'bedtime')?.time ?? DEFAULT_BEDTIME;
    const last = toMin(bed) - 60;
    const out: string[] = [];
    for (let t = toMin(r.time); t <= last; t += WATER_INTERVAL_MIN) out.push(toClock(t));
    return out.length ? out : [r.time];
  }
  return [r.time];
}

/** The id a slot is remembered by. A single daily slot keeps the plain key, as before. */
export const slotId = (r: Reminder, time: string, slots: string[]) => (slots.length > 1 ? `${r.key}@${time}` : r.key);

export interface ReminderContext {
  now: string; // HH:MM in the athlete's timezone
  isoWeekday: number; // 1=Mon..7=Sun
  daysToRace: number;
  plannedToday: boolean;
  loggedToday: boolean;
  firedToday: (id: string) => boolean;
  quietHours?: { start: string; end: string };
}

export interface DueReminder {
  key: string;
  title: string;
  body: string;
  /** Slot ids to mark as fired, including earlier ones missed while the app was closed. */
  fireIds: string[];
}

function message(key: string, ctx: ReminderContext, time: string): { title: string; body: string } | undefined {
  switch (key) {
    case 'workout':
      return ctx.plannedToday && !ctx.loggedToday ? { title: 'Training today', body: "Today's session is waiting. Open Forge OS to see it." } : undefined;
    case 'missing':
      return ctx.plannedToday && !ctx.loggedToday ? { title: 'Log your workout', body: "Did you train today? Log it so your history stays accurate. If you skipped it, that's fine too." } : undefined;
    case 'review':
      return { title: 'Weekly review', body: 'Your weekly review is ready in Progress.' };
    case 'race':
      return ctx.daysToRace >= 0 ? { title: 'Race countdown', body: ctx.daysToRace === 0 ? 'Race day! Trust your training.' : `${ctx.daysToRace} days to race day.` } : undefined;
    case 'bedtime':
      return { title: 'Wind down', body: 'Time to start your bedtime routine.' };
    case 'water':
      return { title: 'Hydration', body: 'Have a glass of water and log it.' };
    case 'meal': {
      const meal = time < '11:00' ? 'breakfast' : time < '16:00' ? 'lunch' : 'dinner';
      return { title: 'Meal log', body: `Log your ${meal} while you remember it.` };
    }
    case 'weigh':
      return { title: 'Weekly weigh-in', body: 'Weigh in before breakfast for a consistent trend.' };
    default:
      return undefined;
  }
}

/**
 * Which reminders should fire right now. Each slot fires once per day, at or
 * after its time (so a tab opened late still gets it), never in quiet hours,
 * and only when it's relevant (e.g. "missing log" only if a session is
 * unlogged). When several slots of one reminder are due at once, only the
 * latest is shown and the earlier ones are marked as fired.
 */
export function dueReminders(reminders: Reminder[], ctx: ReminderContext): DueReminder[] {
  if (inQuietHours(ctx.now, ctx.quietHours)) return [];
  const out: DueReminder[] = [];
  for (const r of reminders) {
    if (!r.enabled) continue;
    const day = WEEKDAY[r.key];
    if (day !== undefined && ctx.isoWeekday !== day) continue;
    const slots = reminderSlots(r, reminders);
    const due = slots.filter((t) => t <= ctx.now && !ctx.firedToday(slotId(r, t, slots)));
    if (!due.length) continue;
    const latest = due[due.length - 1];
    const msg = message(r.key, ctx, latest);
    if (msg) out.push({ key: r.key, ...msg, fireIds: due.map((t) => slotId(r, t, slots)) });
  }
  return out;
}

export interface NextReminderOptions {
  now?: Date;
  timezone?: string;
}

/**
 * When a reminder next fires, or undefined if it is off or has no time.
 * Skips quiet hours and the wrong weekday for weekly reminders. Reminders
 * that depend on the day's plan (workout, missing log) report their next
 * scheduled time; whether they show then depends on that day's log.
 */
export function calculateNextReminder(type: ReminderKey | string, settings: Pick<Settings, 'reminders' | 'quietHours'>, opts: NextReminderOptions = {}): Date | undefined {
  const reminders = mergeReminders(settings.reminders);
  const r = reminders.find((x) => x.key === type);
  if (!r?.enabled) return undefined;
  const slots = reminderSlots(r, reminders).filter((t) => !inQuietHours(t, settings.quietHours));
  if (!slots.length) return undefined;

  const now = opts.now ?? new Date();
  const tz = opts.timezone ?? DEFAULT_TZ;
  const today = toISODate(now, tz);
  // Minutes past midnight on the athlete's wall clock, with seconds, so a slot
  // at this very minute counts as already passed.
  const nowMin = toMin(clockAt(now, tz)) + now.getSeconds() / 60 + now.getMilliseconds() / 60000;
  const day = WEEKDAY[r.key];
  for (let offset = 0; offset <= 7; offset++) {
    if (day !== undefined && weekday(addDays(today, offset)) !== day) continue;
    for (const t of slots) {
      const delta = offset * 1440 + toMin(t) - nowMin;
      if (delta > 0) return new Date(now.getTime() + Math.round(delta * 60_000));
    }
  }
  return undefined;
}
