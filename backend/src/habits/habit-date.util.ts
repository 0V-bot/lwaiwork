/**
 * Pure date helpers for the habits module. No external deps.
 *
 * All strings are UTC calendar dates in `YYYY-MM-DD` form. We deliberately
 * use the UTC day boundary everywhere: the frontend renders local dates, but
 * the streak / stats logic is anchored to a single timezone, otherwise two
 * users five timezones apart would see different "current streaks" for the
 * same underlying habit - confusing and unsynchronisable.
 *
 * Acceptance: every helper below is deterministic and total (no NaN paths).
 */

/** Convert a Date (or ISO string) to YYYY-MM-DD in UTC. */
export function toUtcDateString(input: Date | string): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  if (Number.isNaN(d.getTime())) {
    throw new Error(`toUtcDateString: invalid date input ${String(input)}`);
  }
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse a YYYY-MM-DD string into a Date anchored at UTC midnight. */
export function parseUtcDate(date: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) {
    throw new Error(`parseUtcDate: expected YYYY-MM-DD, got "${date}"`);
  }
  const [, y, m, d] = match;
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
}

/** UTC weekday: 0 = Sunday, 1 = Monday, ..., 6 = Saturday. */
export function utcDayOfWeek(date: string): number {
  return parseUtcDate(date).getUTCDay();
}

/** Add (or subtract when negative) `n` days in UTC, returning a YYYY-MM-DD. */
export function addUtcDays(date: string, n: number): string {
  const d = parseUtcDate(date);
  d.setUTCDate(d.getUTCDate() + n);
  return toUtcDateString(d);
}

/** Whole UTC days between two YYYY-MM-DD strings (b - a). */
export function utcDayDiff(a: string, b: string): number {
  return Math.round((parseUtcDate(b).getTime() - parseUtcDate(a).getTime()) / 86_400_000);
}

/** Today in UTC as YYYY-MM-DD. */
export function utcToday(): string {
  return toUtcDateString(new Date());
}

/**
 * True iff `date` is a "scheduled" day for the habit, per its frequencyType.
 * Used by both current/longest streak and completion-rate calculations.
 */
export function isScheduledDay(date: string, habit: ScheduledLike): boolean {
  switch (habit.frequencyType) {
    case 'daily':
      return true;
    case 'weekdays': {
      const dow = utcDayOfWeek(date);
      return dow >= 1 && dow <= 5;
    }
    case 'custom':
      // No bitmask exposed yet (see habit.entity.ts). Treated as daily so
      // users with `custom` habits still see a non-zero streak.
      return true;
    case 'every_n_days': {
      const n = Math.max(1, Math.floor(habit.frequencyDays));
      const createdDate = toUtcDateString(habit.createdAt);
      const diff = utcDayDiff(createdDate, date);
      return diff >= 0 && diff % n === 0;
    }
    default:
      // Defensive default - unknown frequencies still produce a streak
      // rather than throwing (Habit.frequencyType is TS-typed but values
      // stored before a deploy could be anything).
      return true;
  }
}

/** Minimal shape needed by isScheduledDay - accepts a Habit or a partial. */
export interface ScheduledLike {
  frequencyType: 'daily' | 'weekdays' | 'custom' | 'every_n_days';
  frequencyDays: number;
  createdAt: Date;
}

/** Enumerate every calendar day from `start` through `end`, inclusive, UTC. */
export function eachUtcDay(start: string, end: string): string[] {
  if (utcDayDiff(start, end) < 0) return [];
  const out: string[] = [];
  let cursor = start;
  out.push(cursor);
  while (cursor !== end) {
    cursor = addUtcDays(cursor, 1);
    out.push(cursor);
  }
  return out;
}
