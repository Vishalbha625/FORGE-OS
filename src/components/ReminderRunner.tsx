import { useEffect, useRef } from 'react';
import { useApp } from '../store/AppContext';
import { useToast } from '../store/toast';
import { dueReminders, mergeReminders, reminderPushPlan } from '../lib/reminders';
import { scheduleReminderPush } from '../lib/pushService';
import { usePushApi } from '../hooks/usePushApi';
import { daysBetween, nowClock, weekday, DEFAULT_TZ } from '../lib/dates';

const firedKey = (key: string, date: string) => `forge-reminder:${key}:${date}`;

// What the server was last told about reminder pushes, kept across reloads so
// opening the app only sends changes. Keyed by account (the token's subject)
// and refreshed daily, which also restores schedules lost in a server restart.
const TOLD_KEY = 'forge-push-told';
const accountOf = (token: string) => {
  try {
    return (JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { sub?: string }).sub ?? '';
  } catch {
    return '';
  }
};
function readTold(token: string, today: string): Map<string, string> {
  try {
    const saved = JSON.parse(localStorage.getItem(TOLD_KEY) ?? 'null') as { account: string; day: string; sent: Record<string, string> } | null;
    if (saved && saved.account === accountOf(token) && saved.day === today) return new Map(Object.entries(saved.sent));
  } catch {
    /* unreadable: start over */
  }
  return new Map();
}
function writeTold(token: string, today: string, sent: Map<string, string>) {
  try {
    localStorage.setItem(TOLD_KEY, JSON.stringify({ account: accountOf(token), day: today, sent: Object.fromEntries(sent) }));
  } catch {
    /* storage unavailable: worst case the schedule is re-sent */
  }
}

function readFired(key: string, date: string): boolean {
  try {
    return localStorage.getItem(firedKey(key, date)) === '1';
  } catch {
    return false;
  }
}
function markFired(key: string, date: string) {
  try {
    localStorage.setItem(firedKey(key, date), '1');
  } catch {
    /* storage unavailable: worst case a reminder repeats */
  }
}

/** Show a system notification if permitted, otherwise fall back to an in-app toast. */
export async function notify(title: string, body: string, toast?: (m: string) => void, tag?: string): Promise<'system' | 'toast'> {
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
      // The tag matches the reminder's push, so the two replace each other instead of doubling up.
      if (reg) await reg.showNotification(title, { body, icon: '/icon-192.png', badge: '/badge-72.png', tag });
      else new Notification(title, { body, icon: '/icon-192.png', tag });
      return 'system';
    } catch {
      /* fall through to toast */
    }
  }
  toast?.(`${title}: ${body}`);
  return 'toast';
}

/**
 * Checks reminders every 60 s while the app is open and shows each due one as
 * a system notification when allowed, otherwise as an in-app toast. When push
 * is on, it also keeps the server's schedule of reminder pushes (for when the
 * app is closed) up to date, sending only what changed.
 */
export function ReminderRunner() {
  const { settings, profile, data, today } = useApp();
  const toast = useToast();
  const api = usePushApi();
  const latest = useRef({ settings, profile, data, today, api });
  latest.current = { settings, profile, data, today, api };
  /** What the server was last told, per reminder push type (ISO time or 'none'). */
  const told = useRef<Map<string, string> | null>(null);

  // Reminder pushes: on open, whenever settings, plan or logs change, and each minute.
  const syncPushes = useRef(() => {
    const { settings: s, profile: p, data: d, today: t, api: a } = latest.current;
    if (!s || !p || !a) return;
    told.current ??= readTold(a.accessToken, t);
    const sent = told.current;
    const tz = p.timezone ?? DEFAULT_TZ;
    const plan = reminderPushPlan(s, {
      timezone: tz,
      daysToRace: daysBetween(t, p.raceDate),
      plannedOn: (day) => d.plannedWorkouts.some((w) => w.eventDate === day && !w.types.includes('rest')),
      loggedOn: (day) => [...d.runs, ...d.strength, ...d.hyrox].some((r) => r.eventDate === day),
    });
    let changed = false;
    for (const { type, fireAt } of plan) {
      const value = fireAt ? fireAt.toISOString() : 'none';
      const before = sent.get(type);
      // Nothing was ever scheduled for a type that is off: no need to cancel it.
      if (before === value || (before === undefined && value === 'none')) continue;
      sent.set(type, value);
      changed = true;
      void scheduleReminderPush(a, type, fireAt);
    }
    if (changed) writeTold(a.accessToken, t, sent);
  });
  const signedIn = api !== null;
  useEffect(() => {
    if (!signedIn) {
      told.current = null;
      return;
    }
    const t = window.setTimeout(() => syncPushes.current(), 1500); // let a burst of changes settle
    return () => window.clearTimeout(t);
  }, [signedIn, settings, data.plannedWorkouts, data.runs, data.strength, data.hyrox, today]);

  useEffect(() => {
    const tick = () => {
      const { settings: s, profile: p, data: d, today: t } = latest.current;
      if (!s || !p) return;
      const reminders = mergeReminders(s.reminders);
      if (!reminders.some((r) => r.enabled)) return;
      const due = dueReminders(reminders, {
        now: nowClock(p.timezone ?? DEFAULT_TZ),
        isoWeekday: weekday(t),
        daysToRace: daysBetween(t, p.raceDate),
        plannedToday: d.plannedWorkouts.some((w) => w.eventDate === t && !w.types.includes('rest')),
        loggedToday: [...d.runs, ...d.strength, ...d.hyrox].some((r) => r.eventDate === t),
        firedToday: (k) => readFired(k, t),
        quietHours: s.quietHours,
      });
      for (const r of due) {
        for (const id of r.fireIds) markFired(id, t);
        notify(r.title, r.body, toast, r.tag);
      }
    };
    tick();
    const id = window.setInterval(() => {
      tick();
      syncPushes.current();
    }, 60_000);
    return () => window.clearInterval(id);
  }, [toast]);

  return null;
}
