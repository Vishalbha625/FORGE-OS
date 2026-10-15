// "Just now", "5m ago", "3h ago", "Yesterday", "Oct 10", "Oct 10, 2025".
// Calendar days are the device's local days. `now` is injectable for tests.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

export function getRelativeTime(iso: string | undefined, now: Date = new Date()): string {
  if (!iso) return '';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';
  const diff = now.getTime() - then.getTime();

  if (diff < MINUTE) return 'Just now'; // also covers small clock skew into the future
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < 24 * HOUR && dayKey(then) === dayKey(now)) return `${Math.floor(diff / HOUR)}h ago`;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(then) === dayKey(yesterday)) return 'Yesterday';
  if (diff < 24 * HOUR) return `${Math.floor(diff / HOUR)}h ago`;

  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (then.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return then.toLocaleDateString('en-US', opts);
}
