import { describe, it, expect } from 'vitest';
import { findDuplicateRun, findDuplicateMeal } from '../lib/dedupe';
import { auditSummary, diffKeys, stripForAudit } from '../lib/audit';
import { dueReminders, inQuietHours, mergeReminders, DEFAULT_REMINDERS, type ReminderContext } from '../lib/reminders';
import type { RunRecord, NutritionEntry } from '../db/types';

describe('duplicate detection', () => {
  const runs = [{ id: 'r1', eventDate: '2026-10-12', distanceKm: 5, durationSec: 1800 }] as RunRecord[];
  it('flags the same run on the same day', () => {
    expect(findDuplicateRun(runs, { eventDate: '2026-10-12', distanceKm: 5, durationSec: 1802 })?.id).toBe('r1');
  });
  it('allows two different runs on the same day (multiple workouts per day)', () => {
    expect(findDuplicateRun(runs, { eventDate: '2026-10-12', distanceKm: 3, durationSec: 1200 })).toBeUndefined();
  });
  it('does not flag a record against itself when editing', () => {
    expect(findDuplicateRun(runs, { id: 'r1', eventDate: '2026-10-12', distanceKm: 5, durationSec: 1800 })).toBeUndefined();
  });
  it('matches meals case-insensitively within the same slot', () => {
    const meals = [{ id: 'm1', eventDate: '2026-10-12', meal: 'lunch', name: 'Dal' }] as NutritionEntry[];
    expect(findDuplicateMeal(meals, { eventDate: '2026-10-12', meal: 'lunch', name: ' dal ' })?.id).toBe('m1');
    expect(findDuplicateMeal(meals, { eventDate: '2026-10-12', meal: 'dinner', name: 'Dal' })).toBeUndefined();
  });
});

describe('audit history', () => {
  it('summarizes edits with the event date', () => {
    expect(auditSummary('runs', { kind: 'easy', distanceKm: 5, eventDate: '2026-10-12' }, 'update')).toBe('Edited easy run 5 km (2026-10-12)');
  });
  it('reports which fields changed, ignoring timestamps', () => {
    expect(diffKeys({ a: 1, b: 2, updatedAt: 'x' }, { a: 1, b: 3, updatedAt: 'y' })).toEqual(['b']);
  });
  it('strips photos from snapshots', () => {
    expect((stripForAudit({ photo: 'data:image/jpeg;base64,AAAA' }) as { photo: string }).photo).toBe('[photo]');
  });
});

describe('reminders', () => {
  const ctx = (o: Partial<ReminderContext> = {}): ReminderContext => ({
    now: '21:00', isoWeekday: 3, daysToRace: 100, plannedToday: true, loggedToday: false, firedToday: () => false, ...o,
  });
  const on = (key: string, time = '20:00') => mergeReminders([{ key, label: key, time, enabled: true }]);

  it('quiet hours work across midnight', () => {
    expect(inQuietHours('23:30', { start: '22:00', end: '07:00' })).toBe(true);
    expect(inQuietHours('06:59', { start: '22:00', end: '07:00' })).toBe(true);
    expect(inQuietHours('07:00', { start: '22:00', end: '07:00' })).toBe(false);
    expect(inQuietHours('12:00', undefined)).toBe(false);
  });
  it('fires a due reminder once per day', () => {
    expect(dueReminders(on('meal'), ctx()).map((r) => r.key)).toEqual(['meal']);
    expect(dueReminders(on('meal'), ctx({ firedToday: () => true }))).toEqual([]);
  });
  it('does not fire before its time or during quiet hours', () => {
    expect(dueReminders(on('meal', '21:30'), ctx())).toEqual([]);
    expect(dueReminders(on('meal'), ctx({ quietHours: { start: '20:30', end: '06:00' } }))).toEqual([]);
  });
  it('"missing log" only fires when a planned session is unlogged', () => {
    expect(dueReminders(on('missing'), ctx()).length).toBe(1);
    expect(dueReminders(on('missing'), ctx({ loggedToday: true }))).toEqual([]);
    expect(dueReminders(on('missing'), ctx({ plannedToday: false }))).toEqual([]);
  });
  it('merging keeps user choices and adds new defaults', () => {
    const merged = mergeReminders([{ key: 'water', label: 'Water intake', time: '10:15', enabled: true }]);
    expect(merged).toHaveLength(DEFAULT_REMINDERS.length);
    expect(merged.find((r) => r.key === 'water')).toMatchObject({ time: '10:15', enabled: true });
  });
});
