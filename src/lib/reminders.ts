import type { Reminder } from '../db/types';

export const DEFAULT_REMINDERS: Reminder[] = [
  { key: 'workout', label: 'Workout start', time: '06:30', enabled: false },
  { key: 'bedtime', label: 'Bedtime routine', time: '22:30', enabled: false },
  { key: 'water', label: 'Water intake', time: '11:00', enabled: false },
  { key: 'meal', label: 'Meal logging', time: '21:00', enabled: false },
  { key: 'weigh', label: 'Morning weigh-in', time: '07:00', enabled: false },
  { key: 'review', label: 'Weekly review (Sundays)', time: '19:00', enabled: false },
  { key: 'race', label: 'Race countdown', time: '08:00', enabled: false },
  { key: 'missing', label: 'Missing workout log', time: '20:30', enabled: false },
];

/** Add any default reminders missing from a saved list (keeps user choices). */
export function mergeReminders(saved: Reminder[]): Reminder[] {
  const byKey = new Map(saved.map((r) => [r.key, r]));
  return DEFAULT_REMINDERS.map((d) => {
    const s = byKey.get(d.key);
    return s ? { ...d, ...s, time: s.time ?? d.time } : d;
  });
}

/** True when HH:MM `t` falls inside quiet hours (supports ranges past midnight). */
export function inQuietHours(t: string, qh?: { start: string; end: string }): boolean {
  if (!qh || !qh.start || !qh.end || qh.start === qh.end) return false;
  return qh.start < qh.end ? t >= qh.start && t < qh.end : t >= qh.start || t < qh.end;
}

export interface ReminderContext {
  now: string; // HH:MM in the athlete's timezone
  isoWeekday: number; // 1=Mon..7=Sun
  daysToRace: number;
  plannedToday: boolean;
  loggedToday: boolean;
  firedToday: (key: string) => boolean;
  quietHours?: { start: string; end: string };
}

export interface DueReminder {
  key: string;
  title: string;
  body: string;
}

/**
 * Which reminders should fire right now. A reminder fires once per day, at or
 * after its time (so a tab opened late still gets it), never in quiet hours,
 * and only when it's relevant (e.g. "missing log" only if a session is unlogged).
 */
export function dueReminders(reminders: Reminder[], ctx: ReminderContext): DueReminder[] {
  if (inQuietHours(ctx.now, ctx.quietHours)) return [];
  const out: DueReminder[] = [];
  for (const r of reminders) {
    if (!r.enabled || !r.time || ctx.now < r.time || ctx.firedToday(r.key)) continue;
    switch (r.key) {
      case 'workout':
        if (ctx.plannedToday && !ctx.loggedToday) out.push({ key: r.key, title: 'Training today', body: "Today's session is waiting — open Forge OS to see it." });
        break;
      case 'missing':
        if (ctx.plannedToday && !ctx.loggedToday) out.push({ key: r.key, title: 'Log your workout', body: "Did you train today? Log it so your history stays accurate. If you skipped it, that's fine too." });
        break;
      case 'review':
        if (ctx.isoWeekday === 7) out.push({ key: r.key, title: 'Weekly review', body: 'Your weekly report is ready in Progress.' });
        break;
      case 'race':
        if (ctx.daysToRace >= 0) out.push({ key: r.key, title: 'Race countdown', body: ctx.daysToRace === 0 ? 'Race day! Trust your training.' : `${ctx.daysToRace} days to race day.` });
        break;
      case 'bedtime':
        out.push({ key: r.key, title: 'Wind down', body: 'Time to start your bedtime routine.' });
        break;
      case 'water':
        out.push({ key: r.key, title: 'Hydration', body: 'Have a glass of water and log it.' });
        break;
      case 'meal':
        out.push({ key: r.key, title: 'Meal log', body: "Log today's meals while you remember them." });
        break;
      case 'weigh':
        out.push({ key: r.key, title: 'Morning weigh-in', body: 'Weigh in before breakfast for a consistent trend.' });
        break;
    }
  }
  return out;
}
