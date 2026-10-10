import { describe, it, expect } from 'vitest';
import { paceSecPerKm, fmtPace, parseTimeToSec, weeklyKm, estimateNutrition, fmtDuration } from '../lib/calc';
import { sleepMinutes, combineDateTime, addDays, daysBetween, startOfWeek, weekday, toISODate } from '../lib/dates';
import type { Profile, RunRecord } from '../db/types';

describe('pace (acceptance test 4)', () => {
  it('5 km in 30:00 is 6:00 min/km', () => {
    const p = paceSecPerKm(5, 30 * 60);
    expect(p).toBe(360);
    expect(fmtPace(p)).toBe('6:00');
  });
  it('rejects zero/negative inputs instead of dividing by zero', () => {
    expect(paceSecPerKm(0, 1800)).toBeUndefined();
    expect(paceSecPerKm(5, 0)).toBeUndefined();
    expect(fmtPace(undefined)).toBe('–');
  });
});

describe('time parsing', () => {
  it('parses mm:ss and h:mm:ss', () => {
    expect(parseTimeToSec('30:00')).toBe(1800);
    expect(parseTimeToSec('1:05:30')).toBe(3930);
    expect(fmtDuration(3930)).toBe('1:05:30');
  });
  it('treats blank as missing, not zero', () => {
    expect(parseTimeToSec('')).toBeUndefined();
    expect(parseTimeToSec('abc')).toBeUndefined();
  });
});

describe('sleep across midnight (acceptance test 9)', () => {
  it('23:30 → 06:30 is 7h', () => {
    expect(sleepMinutes(combineDateTime('2026-10-09', '23:30'), combineDateTime('2026-10-10', '06:30'))).toBe(420);
  });
  it('rolls over when wake is earlier on the clock than bedtime', () => {
    expect(sleepMinutes(combineDateTime('2026-10-10', '22:00'), combineDateTime('2026-10-10', '05:45'))).toBe(465);
  });
  it('after-midnight bedtime on the same day', () => {
    expect(sleepMinutes(combineDateTime('2026-10-10', '00:30'), combineDateTime('2026-10-10', '07:00'))).toBe(390);
  });
});

describe('weekly mileage (acceptance test 14)', () => {
  it('sums actual runs with one-decimal rounding', () => {
    expect(weeklyKm([{ distanceKm: 5 }, { distanceKm: 10.5 }, { distanceKm: 4.2 }] as RunRecord[])).toBe(19.7);
  });
});

describe('dates', () => {
  it('week math is Monday-first', () => {
    expect(weekday('2026-10-12')).toBe(1); // Monday
    expect(startOfWeek('2026-10-18')).toBe('2026-10-12');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-10-12', '2027-01-24')).toBe(104);
  });
  it('formats the calendar day in Asia/Kolkata, not UTC', () => {
    // 2026-10-10 20:00 UTC is already 11 Oct 01:30 in India.
    expect(toISODate(new Date('2026-10-10T20:00:00Z'), 'Asia/Kolkata')).toBe('2026-10-11');
  });
});

describe('nutrition estimate', () => {
  const base = { primaryGoal: 'hyrox', activityLevel: 'high' } as Profile;
  it('refuses to estimate without weight/height/age', () => {
    const e = estimateNutrition(base);
    expect(e.canEstimate).toBe(false);
    expect(e.missing).toEqual(expect.arrayContaining(['current body weight', 'height', 'age']));
  });
  it('estimates with full data and never goes into an aggressive deficit', () => {
    const e = estimateNutrition({ ...base, weightKg: 69, heightCm: 180, age: 23, primaryGoal: 'fatloss' });
    expect(e.canEstimate).toBe(true);
    expect(e.calories!).toBeGreaterThanOrEqual(Math.round(e.tdee! * 0.85));
    expect(e.protein).toBe(Math.round(69 * 1.8));
  });
});
