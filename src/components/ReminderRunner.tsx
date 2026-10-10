import { useEffect, useRef } from 'react';
import { useApp } from '../store/AppContext';
import { useToast } from '../store/toast';
import { dueReminders, mergeReminders } from '../lib/reminders';
import { daysBetween, nowClock, weekday, DEFAULT_TZ } from '../lib/dates';

const firedKey = (key: string, date: string) => `forge-reminder:${key}:${date}`;

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
    /* storage unavailable — worst case a reminder repeats */
  }
}

/** Show a system notification if permitted, otherwise fall back to an in-app toast. */
export async function notify(title: string, body: string, toast?: (m: string) => void): Promise<'system' | 'toast'> {
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
      if (reg) await reg.showNotification(title, { body, icon: '/icon-192.png', badge: '/icon-192.png' });
      else new Notification(title, { body, icon: '/icon-192.png' });
      return 'system';
    } catch {
      /* fall through to toast */
    }
  }
  toast?.(`${title}: ${body}`);
  return 'toast';
}

/**
 * Checks reminders every 30 s while the app is open. This is honest foreground
 * scheduling: browsers don't run page code when the app is closed, so true
 * background delivery would need a push service.
 */
export function ReminderRunner() {
  const { settings, profile, data, today } = useApp();
  const toast = useToast();
  const latest = useRef({ settings, profile, data, today });
  latest.current = { settings, profile, data, today };

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
        markFired(r.key, t);
        notify(r.title, r.body, toast);
      }
    };
    tick();
    const id = window.setInterval(tick, 30000);
    return () => window.clearInterval(id);
  }, [toast]);

  return null;
}
