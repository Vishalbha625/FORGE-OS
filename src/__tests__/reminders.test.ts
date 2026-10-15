import { describe, it, expect } from 'vitest';
import { calculateNextReminder, dueReminders, mergeReminders, reminderSlots, type ReminderContext } from '../lib/reminders';
import type { Reminder } from '../db/types';

const ctx = (o: Partial<ReminderContext> = {}): ReminderContext => ({
  now: '12:00', isoWeekday: 3, daysToRace: 100, plannedToday: true, loggedToday: false, firedToday: () => false, ...o,
});
const on = (key: string, extra: Partial<Reminder> = {}) => mergeReminders([{ key, label: key, enabled: true, ...extra }]);
// 2026-10-15 is a Thursday. 06:30 UTC is 12:00 in Asia/Kolkata.
const THU_NOON_IST = new Date('2026-10-15T06:30:00Z');
const opts = { now: THU_NOON_IST, timezone: 'Asia/Kolkata' };

describe('reminder slots', () => {
  it('gives meals three times a day, keeping an older single evening time', () => {
    expect(reminderSlots(on('meal').find((r) => r.key === 'meal')!)).toEqual(['08:30', '13:30', '20:30']);
    expect(reminderSlots(on('meal', { time: '21:15' }).find((r) => r.key === 'meal')!)).toEqual(['08:30', '13:30', '21:15']);
  });
  it('repeats water every 2 hours until an hour before bedtime', () => {
    const all = on('water', { time: '08:00' });
    expect(reminderSlots(all.find((r) => r.key === 'water')!, all)).toEqual(['08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00']);
  });
  it('shows only the latest due slot and marks the missed ones', () => {
    const due = dueReminders(on('meal'), ctx({ now: '14:00' }));
    expect(due).toHaveLength(1);
    expect(due[0].body).toMatch(/lunch/);
    expect(due[0].fireIds).toEqual(['meal@08:30', 'meal@13:30']);
    expect(dueReminders(on('meal'), ctx({ now: '14:00', firedToday: (id) => id !== 'meal@13:30' }))[0].fireIds).toEqual(['meal@13:30']);
  });
  it('fires the weigh-in on Mondays and the review on Sundays only', () => {
    expect(dueReminders(on('weigh'), ctx({ isoWeekday: 1 })).map((r) => r.key)).toEqual(['weigh']);
    expect(dueReminders(on('weigh'), ctx({ isoWeekday: 3 }))).toEqual([]);
    expect(dueReminders(on('review'), ctx({ now: '19:30', isoWeekday: 7 })).map((r) => r.key)).toEqual(['review']);
    expect(dueReminders(on('review'), ctx({ now: '19:30', isoWeekday: 6 }))).toEqual([]);
  });
});

describe('calculateNextReminder', () => {
  it('is undefined when the reminder is off', () => {
    expect(calculateNextReminder('meal', { reminders: [] }, opts)).toBeUndefined();
  });
  it('finds the next meal slot today', () => {
    expect(calculateNextReminder('meal', { reminders: on('meal') }, opts)?.toISOString()).toBe('2026-10-15T08:00:00.000Z'); // 13:30 IST
  });
  it('rolls over to tomorrow after the last slot', () => {
    const late = new Date('2026-10-15T16:00:00Z'); // 21:30 IST
    expect(calculateNextReminder('meal', { reminders: on('meal') }, { ...opts, now: late })?.toISOString()).toBe('2026-10-16T03:00:00.000Z'); // 08:30 IST
  });
  it('waits for the right weekday and skips quiet hours', () => {
    expect(calculateNextReminder('review', { reminders: on('review') }, opts)?.toISOString()).toBe('2026-10-18T13:30:00.000Z'); // Sunday 19:00 IST
    expect(calculateNextReminder('weigh', { reminders: on('weigh') }, opts)?.toISOString()).toBe('2026-10-19T01:30:00.000Z'); // Monday 07:00 IST
    const quiet = { start: '13:00', end: '14:00' };
    expect(calculateNextReminder('meal', { reminders: on('meal'), quietHours: quiet }, opts)?.toISOString()).toBe('2026-10-15T15:00:00.000Z'); // 20:30 IST
  });
});
