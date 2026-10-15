import { describe, it, expect } from 'vitest';
import { getRelativeTime } from '../lib/relativeTime';

// Local-time constructors so calendar days match the machine running the tests.
const now = new Date(2026, 9, 15, 14, 30, 0); // 15 Oct 2026, 14:30
const at = (...a: [number, number, number, number?, number?]) => new Date(a[0], a[1], a[2], a[3] ?? 0, a[4] ?? 0).toISOString();

describe('getRelativeTime', () => {
  it('says "Just now" under a minute (and for slight clock skew)', () => {
    expect(getRelativeTime(new Date(now.getTime() - 30_000).toISOString(), now)).toBe('Just now');
    expect(getRelativeTime(new Date(now.getTime() + 5_000).toISOString(), now)).toBe('Just now');
  });

  it('counts minutes, then hours, within today', () => {
    expect(getRelativeTime(new Date(now.getTime() - 5 * 60_000).toISOString(), now)).toBe('5m ago');
    expect(getRelativeTime(new Date(now.getTime() - 59 * 60_000).toISOString(), now)).toBe('59m ago');
    expect(getRelativeTime(at(2026, 9, 15, 11, 0), now)).toBe('3h ago');
  });

  it('says "Yesterday" for the previous calendar day, even under 24 hours ago', () => {
    expect(getRelativeTime(at(2026, 9, 14, 23, 50), now)).toBe('Yesterday');
    expect(getRelativeTime(at(2026, 9, 14, 6, 0), now)).toBe('Yesterday');
  });

  it('shows a short date this year and adds the year otherwise', () => {
    expect(getRelativeTime(at(2026, 9, 10, 9, 0), now)).toBe('Oct 10');
    expect(getRelativeTime(at(2025, 9, 10, 9, 0), now)).toBe('Oct 10, 2025');
  });

  it('returns an empty string for missing or invalid input', () => {
    expect(getRelativeTime(undefined, now)).toBe('');
    expect(getRelativeTime('not a date', now)).toBe('');
  });
});
