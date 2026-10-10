// Date & time helpers. Display timezone defaults to Asia/Kolkata (configurable).

export const DEFAULT_TZ = 'Asia/Kolkata';

/** Current calendar day (YYYY-MM-DD) in the given timezone. */
export function todayISO(tz: string = DEFAULT_TZ): string {
  return toISODate(new Date(), tz);
}

/** Convert a Date to YYYY-MM-DD in a timezone (not UTC). */
export function toISODate(d: Date, tz: string = DEFAULT_TZ): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  const day = parts.find((p) => p.type === 'day')!.value;
  return `${y}-${m}-${day}`;
}

/** Parse YYYY-MM-DD as a local-noon Date (avoids off-by-one from TZ shifts). */
export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function addDays(iso: string, days: number): string {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function daysBetween(fromISO: string, toISO: string): number {
  const a = parseISODate(fromISO).getTime();
  const b = parseISODate(toISO).getTime();
  return Math.round((b - a) / 86400000);
}

/** ISO weekday 1=Mon..7=Sun for a YYYY-MM-DD. */
export function weekday(iso: string): number {
  const d = parseISODate(iso).getDay(); // 0=Sun
  return d === 0 ? 7 : d;
}

export function startOfWeek(iso: string): string {
  // Monday as first day
  return addDays(iso, -(weekday(iso) - 1));
}

export function endOfWeek(iso: string): string {
  return addDays(startOfWeek(iso), 6);
}

export function startOfMonth(iso: string): string {
  const [y, m] = iso.split('-');
  return `${y}-${m}-01`;
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

// ── Display formatting ──────────────────────────────────────────────────────

export function fmtDate(iso: string, opts?: Intl.DateTimeFormatOptions): string {
  return parseISODate(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...opts,
  });
}

export function fmtDayShort(iso: string): string {
  return parseISODate(iso).toLocaleDateString('en-GB', { weekday: 'short' });
}

export function fmtDateTimeIST(isoDateTime: string): string {
  return new Date(isoDateTime).toLocaleString('en-GB', {
    timeZone: DEFAULT_TZ,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function relativeDay(iso: string, tz: string = DEFAULT_TZ): string {
  const diff = daysBetween(todayISO(tz), iso);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff < 0) return `${Math.abs(diff)} days ago`;
  return `in ${diff} days`;
}

// ── Sleep math (handles crossing midnight) ──────────────────────────────────

/**
 * Minutes of sleep between a bedtime and wake time.
 * If wake is at/before bedtime on the clock, it rolls to the next day.
 * Accepts ISO datetimes; if two plain HH:MM are given, pass a reference date.
 */
export function sleepMinutes(bedtimeISO: string, wakeISO: string): number {
  const bed = new Date(bedtimeISO).getTime();
  let wake = new Date(wakeISO).getTime();
  if (wake <= bed) {
    wake += 86400000; // crossed midnight
  }
  return Math.round((wake - bed) / 60000);
}

/** Build an ISO datetime from a date (YYYY-MM-DD) and clock (HH:MM). */
export function combineDateTime(dateISO: string, hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const d = parseISODate(dateISO);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

export function nowClock(tz: string = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date());
}
