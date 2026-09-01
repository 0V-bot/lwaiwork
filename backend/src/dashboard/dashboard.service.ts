import { Injectable, Logger } from '@nestjs/common';
import { SchedulesService } from '../schedules/schedules.service';
import { HabitsService } from '../habits/habits.service';
import { TodosService } from '../todos/todos.service';
import { NotesService } from '../notes/notes.service';
import { FilesService } from '../files/files.service';
import type {
  DashboardCounts,
  DashboardFileSummary,
  DashboardHabitEntry,
  DashboardNoteSummary,
  DashboardOpenTodo,
  DashboardScheduleInstance,
  DashboardToday,
} from './interfaces/dashboard-today.interface';

/**
 * Dashboard aggregation service.
 *
 * Single endpoint: `GET /api/dashboard/today`. Returns a one-shot snapshot
 * of the user's day - counts, top-N lists, today's habits + events.
 *
 * Composition strategy:
 *   * Each source module is queried through its public service surface
 *     (the same surface its controller uses). We deliberately do NOT
 *     bypass into the repositories directly so authorisation / row-level
 *     filters stay in one place.
 *   * `Promise.allSettled` runs the five queries in parallel; a single
 *     failure (e.g. notes store unavailable because MASTER_KEY is broken)
 *     does NOT 500 the whole endpoint - it logs and degrades to an
 *     empty section with counts=0.
 *
 * Future: if a single user's dashboard ever turns out to be slow (5 round
 * trips against PG), wrap the assembled payload in
 *   Redis.set(`dashboard:today:${userId}`, JSON.stringify(payload), 'EX', 60)
 * with a read-through. Not implemented in MVP.
 */
@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  /** Server-local TZ used to define "today". Fixed to Asia/Shanghai. */
  private static readonly TZ = 'Asia/Shanghai';

  /** Lookback for `notesRecent` / `filesRecent` counts. */
  private static readonly RECENT_WINDOW_DAYS = 7;

  /** Cap on the `openTodos` list - 10 keeps the dashboard readable. */
  private static readonly OPEN_TODOS_LIMIT = 10;

  /** Cap on the `recentNotes` / `recentFiles` lists. */
  private static readonly RECENT_LIMIT = 5;

  constructor(
    private readonly todosService: TodosService,
    private readonly habitsService: HabitsService,
    private readonly schedulesService: SchedulesService,
    private readonly notesService: NotesService,
    private readonly filesService: FilesService,
  ) {}

  // ===========================================================================
  // Public API
  // ===========================================================================

  async getToday(userId: string): Promise<DashboardToday> {
    const now = new Date();
    const { start: dayStart, end: dayEnd } = tzDayBounds(now, DashboardService.TZ);
    const recentSince = new Date(
      now.getTime() - DashboardService.RECENT_WINDOW_DAYS * 24 * 3600 * 1000,
    );

    // TODO(perf): wrap the assembled payload in a per-user Redis cache
    //   key=`dashboard:today:${userId}`, TTL=60s, to absorb refresh storms.
    //   Not implemented in MVP.

    // Five independent queries - run in parallel. `allSettled` so a single
    // failure degrades gracefully (empty section + 0 count) rather than
    // 500-ing the whole endpoint.
    const results = await Promise.allSettled([
      this.todosService.findOpen(userId, DashboardService.OPEN_TODOS_LIMIT),
      this.habitsService.findForToday(userId),
      this.schedulesService.listWindow(userId, dayStart, dayEnd, false),
      this.notesService.findRecent(userId, DashboardService.RECENT_LIMIT),
      this.filesService.findRecent(userId, DashboardService.RECENT_LIMIT),
    ]);

    const [todosR, habitsR, eventsR, notesR, filesR] = results;

    // --- todos ----------------------------------------------------------
    const openTodosRaw = unwrap(todosR, 'todos', this.logger);
    const openTodos: DashboardOpenTodo[] = openTodosRaw.map((row) => ({
      id: row.id,
      title: row.title,
      dueAt: row.dueAt ? row.dueAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    }));

    // --- habits ---------------------------------------------------------
    const habitsRaw = unwrap(habitsR, 'habits', this.logger);
    const habitsToday: DashboardHabitEntry[] = habitsRaw.map((h) => ({
      id: h.habit.id,
      name: h.habit.name,
      color: h.habit.color,
      icon: h.habit.icon,
      frequencyType: h.habit.frequencyType,
      frequencyDays: h.habit.frequencyDays,
      targetCount: h.habit.targetCount,
      scheduledToday: h.scheduledToday,
      todayCount: h.todayCount,
      todayCompleted: h.todayCompleted,
      completedAt: h.completedAt ? h.completedAt.toISOString() : null,
    }));

    // --- events ---------------------------------------------------------
    const eventsRaw = unwrap(eventsR, 'schedules', this.logger);
    const eventsToday: DashboardScheduleInstance[] = eventsRaw.map((e) => ({
      scheduleId: e.scheduleId,
      instanceStartAt: e.instanceStartAt.toISOString(),
      endAt: e.endAt ? e.endAt.toISOString() : null,
      title: e.title,
      description: e.description ?? null,
      allDay: e.allDay,
      timezone: e.timezone,
      location: e.location ?? null,
      color: e.color,
      reminderMinutes: e.reminderMinutes ?? null,
      isOverride: e.isOverride,
    }));

    // --- notes ----------------------------------------------------------
    const recentNotesRaw = unwrap(notesR, 'notes', this.logger);
    const recentNotes: DashboardNoteSummary[] = recentNotesRaw.map((n) => ({
      id: n.id,
      title: n.title,
      preview: n.preview,
      tags: n.tags,
      color: n.color,
      archivedAt: n.archivedAt ? n.archivedAt.toISOString() : null,
      createdAt: n.createdAt.toISOString(),
      updatedAt: n.updatedAt.toISOString(),
    }));

    // --- files ----------------------------------------------------------
    const recentFilesRaw = unwrap(filesR, 'files', this.logger);
    const recentFiles: DashboardFileSummary[] = recentFilesRaw.map((f) => ({
      id: f.id,
      filename: f.filename,
      contentType: f.contentType,
      size: f.size,
      ossKey: f.ossKey,
      isImage: f.isImage,
      width: f.width,
      height: f.height,
      archivedAt: f.archivedAt ? f.archivedAt.toISOString() : null,
      createdAt: f.createdAt.toISOString(),
      updatedAt: f.updatedAt.toISOString(),
    }));

    // --- counts ---------------------------------------------------------
    // `openTodos` is bounded to OPEN_TODOS_LIMIT but the dashboard count
    // should reflect the FULL backlog, not just the first page. We do a
    // tiny extra query (count) — cheap and index-backed by user_id.
    let todosOpen = openTodosRaw.length;
    if (todosR.status === 'fulfilled') {
      try {
        todosOpen = await this.countOpenTodos(userId);
      } catch (err) {
        // Don't let a count failure downgrade the whole payload.
        this.logger.warn(
          `countOpenTodos failed for userId=${userId}; falling back to list length (${todosOpen}). ${stringifyError(err)}`,
        );
      }
    }

    let notesRecent = recentNotesRaw.length;
    if (notesR.status === 'fulfilled') {
      try {
        notesRecent = await this.countRecentNotes(userId, recentSince);
      } catch (err) {
        this.logger.warn(
          `countRecentNotes failed for userId=${userId}; falling back to list length (${notesRecent}). ${stringifyError(err)}`,
        );
      }
    }

    let filesRecent = recentFilesRaw.length;
    if (filesR.status === 'fulfilled') {
      try {
        filesRecent = await this.countRecentFiles(userId, recentSince);
      } catch (err) {
        this.logger.warn(
          `countRecentFiles failed for userId=${userId}; falling back to list length (${filesRecent}). ${stringifyError(err)}`,
        );
      }
    }

    const counts: DashboardCounts = {
      todosOpen,
      habitsTrackedToday: habitsToday.filter((h) => h.scheduledToday).length,
      habitsCompletedToday: habitsToday.filter(
        (h) => h.scheduledToday && h.todayCompleted,
      ).length,
      schedulesToday: eventsToday.length,
      notesRecent,
      filesRecent,
    };

    return {
      counts,
      openTodos,
      habitsToday,
      eventsToday,
      recentNotes,
      recentFiles,
      generatedAt: now.toISOString(),
      tz: DashboardService.TZ,
    };
  }

  // ===========================================================================
  // Count helpers (cheap, single-purpose queries)
  // ===========================================================================

  /**
   * Count rows in the service-private repository. Lives here rather than
   * in TodosService so we don't pollute that module's public surface with
   * dashboard-only helpers.
   */
  private async countOpenTodos(userId: string): Promise<number> {
    // Access through the same TypeORM repository the service uses; reach
    // in via the only public getter TodosService exposes (`findOpen`) is
    // expensive for an unbounded user, so we call a private count path.
    //   To keep coupling low we use the `findOpen` result count as the
    //   fallback when this fails (see caller).
    //   The implementation is a 1-shot SQL via a deliberately-minimal
    //   helper on the same service - we extend the service surface in
    //   a way that doesn't change any business method.
    return this.todosService.countOpen(userId);
  }

  private async countRecentNotes(userId: string, since: Date): Promise<number> {
    return this.notesService.countRecent(userId, since);
  }

  private async countRecentFiles(userId: string, since: Date): Promise<number> {
    return this.filesService.countRecent(userId, since);
  }
}

// ---------------------------------------------------------------------------
// Internal helpers (module-private; not exported)
// ---------------------------------------------------------------------------

/**
 * Resolve a `Promise.allSettled` result to either its value or an empty
 * fallback. Always logs the failure so the operator can correlate with
 * degraded dashboard behaviour.
 */
function unwrap<T>(
  result: PromiseSettledResult<T>,
  label: string,
  logger: Logger,
): T extends Array<infer U> ? U[] : T {
  if (result.status === 'fulfilled') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return result.value as any;
  }
  logger.warn(
    `dashboard sub-query "${label}" failed; returning empty. ${stringifyError(result.reason)}`,
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return [] as any;
}

function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// ---------------------------------------------------------------------------
// Timezone-aware day boundaries (reused from rrule-free window expansion).
// ---------------------------------------------------------------------------

/**
 * Return the UTC instants marking the start (inclusive) and end (exclusive)
 * of the calendar day in `tz` that `now` belongs to. The end is computed
 * by adding 24 hours rather than via DST arithmetic — for our fixed
 * Asia/Shanghai TZ (no DST) this is exact; for zones with DST it can drift
 * by an hour across the spring-forward boundary, which is acceptable for
 * a dashboard widget.
 */
function tzDayBounds(now: Date, tz: string): { start: Date; end: Date } {
  const start = startOfDayInTz(now, tz);
  return { start, end: new Date(start.getTime() + 24 * 3600 * 1000) };
}

/**
 * Get the YYYY-MM-DD string of `now` rendered in `tz`. We use `en-CA`
 * because its formatted output is ISO-8601-like (4-digit year, 2-digit
 * month, 2-digit day, hyphen separators), avoiding locale-specific
 * surprises like "9/1/2026" or "01/09/2026".
 */
function localDateInTz(now: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Minutes east of UTC for `tz` at instant `date`. Positive for east.
 * Format of the longOffset part is "GMT+HH:MM" / "GMT-HH:MM".
 */
function tzOffsetMinutesAt(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'longOffset',
  }).formatToParts(date);
  const part = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  const match = /GMT([+-])(\d{2}):?(\d{2})?/.exec(part);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  const hours = Number(match[2] ?? '0');
  const mins = Number(match[3] ?? '0');
  return sign * (hours * 60 + mins);
}

/**
 * UTC instant of local 00:00:00 in `tz` on the calendar day of `now`.
 * Probe a noon-instant to read the offset (DST transitions are
 * usually around 02:00 / 03:00, never noon, so this is stable).
 */
function startOfDayInTz(now: Date, tz: string): Date {
  const [y, m, d] = localDateInTz(now, tz)
    .split('-')
    .map((v) => Number(v)) as [number, number, number];
  const noonProbe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const offsetMin = tzOffsetMinutesAt(noonProbe, tz);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - offsetMin * 60_000);
}
