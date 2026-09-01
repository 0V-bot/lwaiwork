/**
 * TypeScript types for the analytics module.
 *
 * Mirrors the wire shape returned by:
 *   * GET /api/dashboard/analytics      -> `AnalyticsResponse`
 *   * GET /api/dashboard/analytics/summary -> `AnalyticsSummary`
 *
 * Conventions:
 *   * Dates on the wire are ISO-8601 strings (`YYYY-MM-DD` for day
 *     buckets; full `...T...Z` for `generatedAt` / `cachedUntil`).
 *   * `series[*]` arrays are always ascending by date and zero-padded
 *     so the front-end can render the chosen range without doing its
 *     own calendar math.
 *   * `cachedUntil` is informational - the front-end may use it to
 *     decide whether a manual refresh is worth a fresh hit, but the
 *     server is always the source of truth.
 */

export type AnalyticsRange = '7d' | '30d' | '90d';

export type AnalyticsModule =
  | 'todos'
  | 'habits'
  | 'notes'
  | 'files'
  | 'schedules';

/** All modules the endpoint recognises - sentinel for "no filtering". */
export const ALL_ANALYTICS_MODULES: readonly AnalyticsModule[] = [
  'todos',
  'habits',
  'notes',
  'files',
  'schedules',
] as const;

/** One row of a series: count of `X` events on `date`. */
export interface AnalyticsPoint {
  /** Local date in YYYY-MM-DD. */
  date: string;
  /** Number of events on that date. */
  count: number;
}

/** One dataset per tracked metric. Order is fixed (ascending by date). */
export interface AnalyticsSeries {
  todosCompleted: AnalyticsPoint[];
  habitsChecked: AnalyticsPoint[];
  notesCreated: AnalyticsPoint[];
  filesUploaded: AnalyticsPoint[];
  schedulesFired: AnalyticsPoint[];
}

/** Sums of each series over the entire window. */
export interface AnalyticsTotals {
  todosCompleted: number;
  habitsChecked: number;
  notesCreated: number;
  filesUploaded: number;
  schedulesFired: number;
}

/** Wire shape of GET /api/dashboard/analytics. */
export interface AnalyticsResponse {
  range: AnalyticsRange;
  /** Inclusive start of the day window, YYYY-MM-DD, server-local tz. */
  startDate: string;
  /** Exclusive end of the day window, YYYY-MM-DD, server-local tz. */
  endDate: string;
  /** IANA timezone the bucketing was done in. Currently fixed to Asia/Shanghai. */
  tz: string;
  /** Server instant the payload was assembled. */
  generatedAt: string;
  series: AnalyticsSeries;
  totals: AnalyticsTotals;
  /** Informational: when this payload will become stale (5-minute window). */
  cachedUntil: string;
}

// ---------------------------------------------------------------------------
// Summary endpoint
// ---------------------------------------------------------------------------

/**
 * Wire shape of GET /api/dashboard/analytics/summary. Counts are
 * all-time for the caller, never windowed. `activeSince` is the
 * oldest row the user has (any of the five tables); the front-end
 * uses it to render the "active since" caption on the summary tiles.
 */
export interface AnalyticsSummary {
  totals: AnalyticsSummaryTotals;
  /** YYYY-MM-DD of the user's oldest row (any module). Null when there is no data yet. */
  activeSince: string | null;
}

export interface AnalyticsSummaryTotals {
  todos: { total: number; completed: number; open: number };
  habits: { total: number; activeDays: number; longestStreak: number };
  notes: { total: number; totalChars: number };
  files: { total: number; totalBytes: number };
  schedules: { total: number; upcoming7d: number };
}

/** Mapping AnalyticsModule -> the corresponding key in `AnalyticsTotals`. */
export const TOTALS_KEY_BY_MODULE: Record<AnalyticsModule, keyof AnalyticsTotals> = {
  todos: 'todosCompleted',
  habits: 'habitsChecked',
  notes: 'notesCreated',
  files: 'filesUploaded',
  schedules: 'schedulesFired',
};

/**
 * Mapping AnalyticsModule -> the matching series key. Kept here so
 * controllers/services use the same constants table (no magic strings).
 */
export const SERIES_KEY_BY_MODULE: Record<AnalyticsModule, keyof AnalyticsSeries> = {
  todos: 'todosCompleted',
  habits: 'habitsChecked',
  notes: 'notesCreated',
  files: 'filesUploaded',
  schedules: 'schedulesFired',
};

/** Day-count for each range. Used to trim point arrays + sanity-check inputs. */
export const RANGE_DAYS: Record<AnalyticsRange, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};
