import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { SchedulesService } from '../schedules/schedules.service';
import { RedisService } from '../redis/redis.service';
import {
  ALL_ANALYTICS_MODULES,
  RANGE_DAYS,
  SERIES_KEY_BY_MODULE,
  TOTALS_KEY_BY_MODULE,
  type AnalyticsModule,
  type AnalyticsPoint,
  type AnalyticsRange,
  type AnalyticsResponse,
  type AnalyticsSeries,
  type AnalyticsSummary,
  type AnalyticsSummaryTotals,
  type AnalyticsTotals,
} from './interfaces/analytics.interface';

/**
 * Analytics aggregation service.
 *
 * Two read-only endpoints:
 *   * `getAnalytics()` -> GET /api/dashboard/analytics
 *   * `getSummary()`   -> GET /api/dashboard/analytics/summary
 *
 * Composition strategy (per-series):
 *   * `Promise.allSettled` runs every series query in parallel; a single
 *     failure (e.g. notes table locked because of a maintenance job)
 *     degrades to an empty array + zero total without failing the whole
 *     endpoint. The contract is that the user always sees something, even
 *     if a section is missing.
 *
 * Recurring schedule expansion reuses the public SchedulesService
 * surface (listWindow) so we never fork the RRULE logic - the brief is
 * explicit about that ("复用 M2-3 的 instance-builder"). Any future
 * patch to the expansion engine lands here automatically the moment the
 * schedules module is rebuilt.
 *
 * Cache strategy:
 *   * 5-minute per-user cache in Redis, key derived from range + the
 *     sorted list of requested modules.
 *   * Redis is a *degradation-tolerant* dependency (see RedisService).
 *     On Redis errors we log + fall through to a live query - the user
 *     sees the right data, just without the speedup.
 *
 * Index policy:
 *   * Every SQL below is keyed on `(user_id, <date>)` (or
 *     `(habit_id IN ...)` for habit logs, which themselves index on
 *     `(user_id, date)`). All those indexes already exist on the base
 *     entities; this module adds no new schema. If 90d queries ever
 *     blow up on cold storage, drop the migration in
 *     migrations/0002-analytics-index.sql - it adds btree indexes on
 *     `(user_id, completed_proxy)` etc. without any partial-index trick
 *     (which we have to avoid: BUG-002).
 */

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Cache lifetime, in seconds. The brief specifies 5 minutes. */
const CACHE_TTL_SECONDS = 5 * 60;

/** Server-local TZ the day buckets are computed in. Same constant as M2-5. */
const SERVER_TZ = 'Asia/Shanghai';

/** Defensive cap on a single series result set. 90d * 1/day = 90, but allow
 *  headroom for the trailing date_used in odd calendar windows. */
const MAX_POINTS_PER_SERIES = 365;

/**
 * TypeORM / PG returns `date_trunc('day', ts AT TIME ZONE 'tz')::date` as a
 * JavaScript `Date` whose midnight component is in the server-local TZ. We
 * normalise to YYYY-MM-DD by going through Date#toISOString and slicing the
 * head - this is timezone-stable because the `AT TIME ZONE` already shifted
 * the value.
 */

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly schedulesService: SchedulesService,
    private readonly redis: RedisService,
  ) {}

  // ===========================================================================
  // GET /api/dashboard/analytics
  // ===========================================================================

  async getAnalytics(
    userId: string,
    range: AnalyticsRange,
    requestedModules?: AnalyticsModule[],
  ): Promise<AnalyticsResponse> {
    const modules = requestedModules && requestedModules.length > 0
      ? requestedModules
      : (ALL_ANALYTICS_MODULES as readonly AnalyticsModule[]).slice();

    const cacheKey = this.buildCacheKey(userId, range, modules);
    const cached = await this.readCache(cacheKey);
    if (cached) return cached;

    const days = RANGE_DAYS[range];
    const today = nowInTz(new Date(), SERVER_TZ);
    const start = startOfDayInTz(addDays(today, -(days - 1), SERVER_TZ), SERVER_TZ);
    const endExclusive = startOfDayInTz(addDays(today, 1, SERVER_TZ), SERVER_TZ);

    // Pull all five series in parallel, scoped to the requested module set.
    // `Promise.allSettled` keeps one query failure from killing the payload.
    const results = await Promise.allSettled([
      modules.includes('todos') ? this.todosCompletedSeries(userId, start, endExclusive) : Promise.resolve(emptySeries()),
      modules.includes('habits') ? this.habitsCheckedSeries(userId, start, endExclusive) : Promise.resolve(emptySeries()),
      modules.includes('notes') ? this.notesCreatedSeries(userId, start, endExclusive) : Promise.resolve(emptySeries()),
      modules.includes('files') ? this.filesUploadedSeries(userId, start, endExclusive) : Promise.resolve(emptySeries()),
      modules.includes('schedules')
        ? this.schedulesFiredSeries(userId, start, endExclusive)
        : Promise.resolve(emptySeries()),
    ]);

    const series: AnalyticsSeries = {
      todosCompleted: extractSeries('todosCompleted', results[0], this.logger),
      habitsChecked: extractSeries('habitsChecked', results[1], this.logger),
      notesCreated: extractSeries('notesCreated', results[2], this.logger),
      filesUploaded: extractSeries('filesUploaded', results[3], this.logger),
      schedulesFired: extractSeries('schedulesFired', results[4], this.logger),
    };

    const totals: AnalyticsTotals = {
      todosCompleted: sumPoints(series.todosCompleted),
      habitsChecked: sumPoints(series.habitsChecked),
      notesCreated: sumPoints(series.notesCreated),
      filesUploaded: sumPoints(series.filesUploaded),
      schedulesFired: sumPoints(series.schedulesFired),
    };

    const generatedAt = new Date();
    const response: AnalyticsResponse = {
      range,
      startDate: formatDate(start),
      endDate: formatDate(endExclusive),
      tz: SERVER_TZ,
      generatedAt: generatedAt.toISOString(),
      series,
      totals,
      cachedUntil: new Date(generatedAt.getTime() + CACHE_TTL_SECONDS * 1000).toISOString(),
    };

    await this.writeCache(cacheKey, response);
    return response;
  }

  // ===========================================================================
  // GET /api/dashboard/analytics/summary
  // ===========================================================================

  async getSummary(userId: string): Promise<AnalyticsSummary> {
    // Run every count query in parallel. We don't bother caching this one -
    // a summary is a tiny payload and count() on an indexed column is cheap.
    const [
      todosR,
      habitsR,
      notesR,
      filesR,
      schedulesR,
      activeSinceR,
    ] = await Promise.allSettled([
      this.summaryTodos(userId),
      this.summaryHabits(userId),
      this.summaryNotes(userId),
      this.summaryFiles(userId),
      this.summarySchedules(userId),
      this.findActiveSince(userId),
    ]);

    const totals: AnalyticsSummaryTotals = {
      todos: unwrap(todosR, 'summaryTodos', this.logger, { total: 0, completed: 0, open: 0 }),
      habits: unwrap(habitsR, 'summaryHabits', this.logger, {
        total: 0,
        activeDays: 0,
        longestStreak: 0,
      }),
      notes: unwrap(notesR, 'summaryNotes', this.logger, { total: 0, totalChars: 0 }),
      files: unwrap(filesR, 'summaryFiles', this.logger, { total: 0, totalBytes: 0 }),
      schedules: unwrap(schedulesR, 'summarySchedules', this.logger, { total: 0, upcoming7d: 0 }),
    };

    const activeSince = activeSinceR.status === 'fulfilled' ? activeSinceR.value : null;

    return { totals, activeSince };
  }

  // ===========================================================================
  // Series queries (each one is its own micro-method so a failure is scoped)
  // ===========================================================================

  /**
   * "Todos completed" on day X.
   *
   * KNOWN DEGRADATION: the schema does NOT have a `completed_at` column on
   * `todos` - the only boolean marker is `done`, and `updated_at` is bumped
   * on every save (title edit, due_at change, etc.). Approximation: we
   * project a day's completions as the count of `done=true` rows whose
   * `updated_at AT TIME ZONE` is in the bucket AND whose `updated_at` is
   * on-or-after `deleted_at IS NULL` transition.
   *
   * This is the same approach the dashboard tile uses (countOpen falls back
   * to "current done rows") and is good enough for a chart. Migrating to a
   * proper `completed_at` column would require a write-path change on every
   * PATCH in TodosService, which is out of scope for M2-6.
   */
  private async todosCompletedSeries(
    userId: string,
    start: Date,
    endExclusive: Date,
  ): Promise<AnalyticsPoint[]> {
    const sql = `
      SELECT date_trunc('day', updated_at AT TIME ZONE 'Asia/Shanghai')::date AS day,
             COUNT(*)::int AS count
        FROM todos
       WHERE user_id = $1
         AND done = true
         AND deleted_at IS NULL
         AND updated_at >= $2
         AND updated_at <  $3
       GROUP BY day
       ORDER BY day
    `;
    const rows = (await this.dataSource.query(sql, [
      userId,
      start.toISOString(),
      endExclusive.toISOString(),
    ])) as Array<{ day: Date | string; count: number | string }>;
    return rows.map((r) => ({ date: toIsoDate(r.day), count: Number(r.count) }));
  }

  /**
   * Habit check-ins per day. `habit_logs.date` is already a calendar date
   * (PG `date` type), so no tz shift needed - but we still bucket by it so
   * the timezone-agnostic semantics line up with the user's mental model.
   *
   * Index used: `IDX_habit_logs_user_date (user_id, date)` from M2-2.
   */
  private async habitsCheckedSeries(
    userId: string,
    start: Date,
    endExclusive: Date,
  ): Promise<AnalyticsPoint[]> {
    const sql = `
      SELECT hl.date::text AS day,
             COUNT(*)::int AS count
        FROM habit_logs hl
        JOIN habits h ON h.id = hl.habit_id
       WHERE h.user_id = $1
         AND hl.user_id = $1
         AND hl.date >= $2::date
         AND hl.date <  $3::date
       GROUP BY hl.date
       ORDER BY hl.date
    `;
    const startDate = formatDate(start);
    const endDate = formatDate(endExclusive);
    const rows = (await this.dataSource.query(sql, [
      userId,
      startDate,
      endDate,
    ])) as Array<{ day: string; count: number | string }>;
    return rows.map((r) => ({ date: r.day, count: Number(r.count) }));
  }

  /**
   * Notes created per day. The body is encrypted; we project only metadata
   * (created_at) and the aggregate `COUNT(*)` - so an MASTER_KEY outage is
   * irrelevant here.
   */
  private async notesCreatedSeries(
    userId: string,
    start: Date,
    endExclusive: Date,
  ): Promise<AnalyticsPoint[]> {
    const sql = `
      SELECT date_trunc('day', created_at AT TIME ZONE 'Asia/Shanghai')::date AS day,
             COUNT(*)::int AS count
        FROM notes
       WHERE user_id = $1
         AND created_at >= $2
         AND created_at <  $3
       GROUP BY day
       ORDER BY day
    `;
    const rows = (await this.dataSource.query(sql, [
      userId,
      start.toISOString(),
      endExclusive.toISOString(),
    ])) as Array<{ day: Date | string; count: number | string }>;
    return rows.map((r) => ({ date: toIsoDate(r.day), count: Number(r.count) }));
  }

  /**
   * Files uploaded per day (server-side `created_at`).
   */
  private async filesUploadedSeries(
    userId: string,
    start: Date,
    endExclusive: Date,
  ): Promise<AnalyticsPoint[]> {
    const sql = `
      SELECT date_trunc('day', created_at AT TIME ZONE 'Asia/Shanghai')::date AS day,
             COUNT(*)::int AS count
        FROM files
       WHERE user_id = $1
         AND created_at >= $2
         AND created_at <  $3
       GROUP BY day
       ORDER BY day
    `;
    const rows = (await this.dataSource.query(sql, [
      userId,
      start.toISOString(),
      endExclusive.toISOString(),
    ])) as Array<{ day: Date | string; count: number | string }>;
    return rows.map((r) => ({ date: toIsoDate(r.day), count: Number(r.count) }));
  }

  /**
   * Recurring schedule instance expansions. This is the only series that
   * cannot be answered with a single SQL query - we lean on
   * SchedulesService.listWindow, which already does the RRULE/between
   * walk + override merge + truncate tombstone handling. We then bucket
   * the resulting instance array by `instanceStartAt`.
   *
   * Performance: the listWindow call walks every owned series and
   * expands only inside [start, endExclusive). For a 90-day window the
   * worst case is a single user with hundreds of recurring series -
   * still bounded; we accept the cost.
   */
  private async schedulesFiredSeries(
    userId: string,
    start: Date,
    endExclusive: Date,
  ): Promise<AnalyticsPoint[]> {
    // `includeArchived=true`: archived schedules should still count -
    // the user may have just archived a finished series and is still
    // interested in its activity. Same call signature as the dashboard
    // tile in M2-5.
    const instances = await this.schedulesService.listWindow(
      userId,
      start,
      endExclusive,
      true,
    );

    const counts = new Map<string, number>();
    for (const inst of instances) {
      const localDay = formatDateInTz(inst.instanceStartAt, SERVER_TZ);
      counts.set(localDay, (counts.get(localDay) ?? 0) + 1);
    }

    return Array.from(counts.entries())
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([date, count]) => ({ date, count }));
  }

  // ===========================================================================
  // Summary sub-queries
  // ===========================================================================

  private async summaryTodos(
    userId: string,
  ): Promise<AnalyticsSummaryTotals['todos']> {
    const sql = `
      SELECT COUNT(*) FILTER (WHERE true)::int                                   AS total,
             COUNT(*) FILTER (WHERE done = true)::int                            AS completed,
             COUNT(*) FILTER (WHERE done = false)::int                           AS open
        FROM todos
       WHERE user_id = $1
         AND deleted_at IS NULL
    `;
    const rows = (await this.dataSource.query(sql, [userId])) as Array<{
      total: number | string;
      completed: number | string;
      open: number | string;
    }>;
    const r = rows[0] ?? { total: 0, completed: 0, open: 0 };
    return {
      total: Number(r.total),
      completed: Number(r.completed),
      open: Number(r.open),
    };
  }

  private async summaryHabits(
    userId: string,
  ): Promise<AnalyticsSummaryTotals['habits']> {
    // Two cheap aggregates in parallel-friendly order:
    //   * total: count of habits (active + archived)
    //   * activeDays: distinct date strings in habit_logs for this user
    //   * longestStreak: longest run of consecutive days with >=1 log
    //
    // The streak calculation is an SQL window-query; we compute it in a
    // single round-trip rather than dragging every log row over the wire.
    const sql = `
      WITH habit_log_days AS (
        SELECT DISTINCT date::text AS day
          FROM habit_logs
         WHERE user_id = $1
      ),
      -- "Calendar gaps" trick: consecutive days have the same ROW_NUMBER -
      -- day-to-RN gap. We group on the gap to identify runs.
      runs AS (
        SELECT day,
               day::date - (ROW_NUMBER() OVER (ORDER BY day))::int AS grp
          FROM habit_log_days
      ),
      longest AS (
        SELECT COALESCE(MAX(c), 0)::int AS len
          FROM (
            SELECT COUNT(*)::int AS c
              FROM runs
             GROUP BY grp
          ) t
      ),
      total_count AS (
        SELECT COUNT(*)::int AS total FROM habits WHERE user_id = $1
      )
      SELECT (SELECT total FROM total_count)        AS total,
             (SELECT COUNT(*) FROM habit_log_days)   AS active_days,
             (SELECT len      FROM longest)          AS longest_streak
    `;
    const rows = (await this.dataSource.query(sql, [userId])) as Array<{
      total: number | string;
      active_days: number | string;
      longest_streak: number | string;
    }>;
    const r = rows[0] ?? { total: 0, active_days: 0, longest_streak: 0 };
    return {
      total: Number(r.total),
      activeDays: Number(r.active_days),
      longestStreak: Number(r.longest_streak),
    };
  }

  private async summaryNotes(
    userId: string,
  ): Promise<AnalyticsSummaryTotals['notes']> {
    // `preview` is plaintext up to 200 chars and carries the first ~200 chars
    // of content; using it as a proxy for totalChars would undercount long
    // notes. For an aggregate summary we deliberately fall back to the sum
    // of preview-lengths (cheap, single round-trip, decrypt-free). The
    // front-end call-out clarifies the approximation.
    const sql = `
      SELECT COUNT(*)::int     AS total,
             COALESCE(SUM(LENGTH(preview)), 0)::bigint AS total_chars
        FROM notes
       WHERE user_id = $1
    `;
    const rows = (await this.dataSource.query(sql, [userId])) as Array<{
      total: number | string;
      total_chars: number | string;
    }>;
    const r = rows[0] ?? { total: 0, total_chars: 0 };
    return {
      total: Number(r.total),
      // Preview is capped to 200 chars; we expose the raw sum so the user
      // gets a sense of magnitude. A future "encrypt-aware" totalChars is
      // out of scope for MVP.
      totalChars: Number(r.total_chars),
    };
  }

  private async summaryFiles(
    userId: string,
  ): Promise<AnalyticsSummaryTotals['files']> {
    const sql = `
      SELECT COUNT(*)::int                AS total,
             COALESCE(SUM(size), 0)::bigint AS total_bytes
        FROM files
       WHERE user_id = $1
         AND archived_at IS NULL
    `;
    const rows = (await this.dataSource.query(sql, [userId])) as Array<{
      total: number | string;
      total_bytes: number | string;
    }>;
    const r = rows[0] ?? { total: 0, total_bytes: 0 };
    return {
      total: Number(r.total),
      totalBytes: Number(r.total_bytes),
    };
  }

  private async summarySchedules(
    userId: string,
  ): Promise<AnalyticsSummaryTotals['schedules']> {
    // `total` is series count (every row, archived or not);
    // `upcoming7d` is post-RRULE expansion into "now + 7 days" - reusing
    // SchedulesService.listWindow keeps the recurring math single-sourced.
    const totalQ = this.dataSource.query(
      'SELECT COUNT(*)::int AS total FROM schedules WHERE user_id = $1',
      [userId],
    );
    const now = new Date();
    const weekAhead = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
    const upcomingQ = this.schedulesService.listWindow(userId, now, weekAhead, true);

    const [totalRows, instances] = await Promise.all([totalQ, upcomingQ]);
    const totalR = totalRows as Array<{ total: number | string }>;
    return {
      total: Number(totalR[0]?.total ?? 0),
      upcoming7d: instances.length,
    };
  }

  /** Smallest `created_at` (or analogue) across all 5 tables - "active since". */
  private async findActiveSince(userId: string): Promise<string | null> {
    const sql = `
      SELECT MIN(day) AS earliest
        FROM (
          SELECT created_at AS day FROM todos       WHERE user_id = $1 AND deleted_at IS NULL
          UNION ALL
          SELECT created_at AS day FROM habits      WHERE user_id = $1
          UNION ALL
          SELECT created_at AS day FROM notes       WHERE user_id = $1
          UNION ALL
          SELECT created_at AS day FROM files       WHERE user_id = $1
          UNION ALL
          SELECT created_at AS day FROM schedules   WHERE user_id = $1
        ) src
    `;
    const rows = (await this.dataSource.query(sql, [userId])) as Array<{ earliest: Date | string | null }>;
    const v = rows[0]?.earliest;
    if (!v) return null;
    return toIsoDate(v);
  }

  // ===========================================================================
  // Cache helpers
  // ===========================================================================

  private buildCacheKey(
    userId: string,
    range: AnalyticsRange,
    modules: readonly AnalyticsModule[],
  ): string {
    // Sorted module list keeps the key stable regardless of caller order.
    const sorted = [...modules].sort().join(',');
    return `analytics:${userId}:${range}:${sorted}`;
  }

  private async readCache(key: string): Promise<AnalyticsResponse | null> {
    if (!this.redis.isHealthy) return null;
    try {
      const raw = await this.redis.get(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as AnalyticsResponse;
      // Cache must include the same shape the controller returns - the response
      // is JSON-safe (all dates are strings on the wire). We do a shallow shape
      // sanity check so a corrupt cache entry doesn't poison the response.
      if (typeof parsed !== 'object' || parsed === null) return null;
      if (!parsed.series || !parsed.totals) return null;
      return parsed;
    } catch (err) {
      this.logger.warn(
        `Redis cache read failed for key=${key}; falling through to DB. ${stringifyError(err)}`,
      );
      return null;
    }
  }

  private async writeCache(key: string, value: AnalyticsResponse): Promise<void> {
    if (!this.redis.isHealthy) return;
    try {
      await this.redis.set(key, JSON.stringify(value), CACHE_TTL_SECONDS);
    } catch (err) {
      this.logger.warn(
        `Redis cache write failed for key=${key}; response still returned. ${stringifyError(err)}`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Module-private helpers
// ---------------------------------------------------------------------------

function emptySeries(): AnalyticsPoint[] {
  return [];
}

function extractSeries(
  label: string,
  settled: PromiseSettledResult<AnalyticsPoint[]>,
  logger: Logger,
): AnalyticsPoint[] {
  if (settled.status === 'fulfilled') {
    const arr = settled.value;
    if (arr.length > MAX_POINTS_PER_SERIES) {
      // Defensive trim so a buggy scheduler can't blow up the payload.
      logger.warn(`series "${label}" returned ${arr.length} rows; trimming to ${MAX_POINTS_PER_SERIES}.`);
      return arr.slice(0, MAX_POINTS_PER_SERIES);
    }
    return arr;
  }
  logger.warn(`series "${label}" failed; returning empty array. ${stringifyError(settled.reason)}`);
  return [];
}

function unwrap<T>(
  result: PromiseSettledResult<T>,
  label: string,
  logger: Logger,
  fallback: T,
): T {
  if (result.status === 'fulfilled') return result.value;
  logger.warn(
    `summary sub-query "${label}" failed; returning empty. ${stringifyError(result.reason)}`,
  );
  return fallback;
}

function sumPoints(points: AnalyticsPoint[]): number {
  let s = 0;
  for (const p of points) s += p.count;
  return s;
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Format any "calendar date" the DB returned (a JS Date whose day component is
 * already in the server TZ because we shifted with `AT TIME ZONE 'Asia/Shanghai'`,
 * OR a `pg date`-as-string) into the canonical `YYYY-MM-DD` form.
 *
 * We slice through `toISOString()` for JS Date (which gives UTC), then take
 * the leading 10 chars. For a date that has already been shifted into
 * `Asia/Shanghai` the local midnight now sits at -08:00 UTC, which means
 * `toISOString().slice(0,10)` would off-by-one. Safer: pull the date
 * components via Intl.DateTimeFormat with `Asia/Shanghai`. For string input
 * we accept the first 10 chars when it already matches the format.
 */
function toIsoDate(input: Date | string | null | undefined): string {
  if (!input) return '';
  if (typeof input === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(input)) return input.slice(0, 10);
    const d = new Date(input);
    if (Number.isNaN(d.getTime())) return '';
    return formatDateInTz(d, SERVER_TZ);
  }
  if (input instanceof Date) {
    return formatDateInTz(input, SERVER_TZ);
  }
  return '';
}

function formatDateInTz(d: Date, tz: string): string {
  // en-CA yields ISO-like YYYY-MM-DD regardless of platform locale.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function formatDate(d: Date): string {
  return formatDateInTz(d, SERVER_TZ);
}

/** "Today" rendered in `tz` - the anchor for the day-window. */
function nowInTz(d: Date, tz: string): Date {
  // Returns a Date whose UTC instant corresponds to 00:00 in `tz` on the
  // calendar day `d` belongs to. We probe at noon for DST stability.
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  const [y, m, day] = ymd.split('-').map((v) => Number(v)) as [number, number, number];
  return startOfDayInTz(new Date(Date.UTC(y, m - 1, day, 12)), tz);
}

function startOfDayInTz(d: Date, tz: string): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  const [y, m, day] = ymd.split('-').map((v) => Number(v)) as [number, number, number];
  const noonProbe = new Date(Date.UTC(y, m - 1, day, 12));
  const offsetMin = tzOffsetMinutesAt(noonProbe, tz);
  return new Date(Date.UTC(y, m - 1, day, 0, 0, 0) - offsetMin * 60_000);
}

/** Minutes east of UTC for `tz` at instant `d`. Positive east. */
function tzOffsetMinutesAt(d: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'longOffset',
  }).formatToParts(d);
  const part = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  const match = /GMT([+-])(\d{2}):?(\d{2})?/.exec(part);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2] ?? '0');
  const mins = Number(match[3] ?? '0');
  return sign * (hours * 60 + mins);
}

/**
 * Move a "calendar day" forward by `deltaDays`. We work purely in the local
 * date space (YYYY-MM-DD) and turn that back into a UTC Date at 00:00
 * server-local, so DST days (none in Asia/Shanghai, but in general) handle
 * themselves.
 */
function addDays(d: Date, deltaDays: number, tz: string): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  const [y, m, day] = ymd.split('-').map((v) => Number(v)) as [number, number, number];
  // Use noon UTC to dodge DST drift; bring the date into the server tz.
  const noonProbe = new Date(Date.UTC(y, m - 1, day + deltaDays, 12));
  const offsetMin = tzOffsetMinutesAt(noonProbe, tz);
  return new Date(
    Date.UTC(
      noonProbe.getUTCFullYear(),
      noonProbe.getUTCMonth(),
      noonProbe.getUTCDate(),
      0,
      0,
      0,
    ) - offsetMin * 60_000,
  );
}

/** Allowed module set, used by tests and the controller's whitelist. */
export const ANALYTICS_MODULES = ALL_ANALYTICS_MODULES;

/** Range list, exported for the controller's whitelist test. */
export const ANALYTICS_RANGES: readonly AnalyticsRange[] = [
  '7d',
  '30d',
  '90d',
];

// Re-export the keys mapping so callers (controllers) can use it directly
// without reaching back into the interfaces file.
export { SERIES_KEY_BY_MODULE, TOTALS_KEY_BY_MODULE };
