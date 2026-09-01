import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, type EntityManager } from 'typeorm';
import { Habit, type HabitFrequencyType } from './entities/habit.entity';
import { HabitLog } from './entities/habit-log.entity';
import { CreateHabitDto } from './dto/create-habit.dto';
import { UpdateHabitDto } from './dto/update-habit.dto';
import { CheckHabitDto } from './dto/check-habit.dto';
import { type HabitStatsRange } from './dto/habit-stats-query.dto';
import {
  addUtcDays,
  eachUtcDay,
  isScheduledDay,
  utcDayDiff,
  utcToday,
} from './habit-date.util';

// ---------------------------------------------------------------------------
// Response shapes (returned by service). Kept as interfaces (not classes) so we
// do not double the entity count - the controller only declares them in
// @ApiOkResponse({ description: ... }).
// ---------------------------------------------------------------------------

export interface HabitWithToday {
  id: string;
  userId: string;
  name: string;
  color: string;
  icon: string;
  frequencyType: HabitFrequencyType;
  frequencyDays: number;
  targetCount: number;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** Sum of today's `count` across habit_logs for this habit (0 if no log yet). */
  todayCount: number;
  /** `todayCount >= targetCount`. */
  todayCompleted: boolean;
}

export interface HeatmapPoint {
  date: string;
  count: number;
  completed: boolean;
}

export interface HabitStats {
  habitId: string;
  range: HabitStatsRange;
  rangeStart: string;
  rangeEnd: string;
  totalCheckins: number;
  scheduledDays: number;
  checkedScheduledDays: number;
  /** `checkedScheduledDays / scheduledDays`, rounded to 4 fractional digits. */
  completionRate: number;
  currentStreak: number;
  longestStreak: number;
  /** One point per day in [rangeStart, rangeEnd] - `count=0` is included. */
  heatmap: HeatmapPoint[];
}

export interface OverallStats {
  totalHabits: number;
  activeHabits: number;
  archivedHabits: number;
  todayCompleted: number;
  todayPending: number;
  /** `checkedHabits / scheduledHabits` across the last 7 UTC days, 4 dp. */
  weekCompletionRate: number;
}

const RANGE_DAYS: Record<HabitStatsRange, number> = {
  '30d': 30,
  '90d': 90,
  '365d': 365,
};

// ---------------------------------------------------------------------------

@Injectable()
export class HabitsService {
  private readonly logger = new Logger(HabitsService.name);

  constructor(
    @InjectRepository(Habit)
    private readonly habits: Repository<Habit>,
    @InjectRepository(HabitLog)
    private readonly habitLogs: Repository<HabitLog>,
    private readonly dataSource: DataSource,
  ) {}

  // ===========================================================================
  // CRUD
  // ===========================================================================

  /**
   * List habits for the caller, joined with today's log so the UI can render
   * the "checked today?" pill without a second round-trip. Archived habits
   * are excluded - their existence would confuse the daily view and they are
   * reachable through `?includeArchived=true` style filters later if needed.
   */
  async findAll(userId: string): Promise<HabitWithToday[]> {
    const today = utcToday();

    const rows = await this.habits
      .createQueryBuilder('h')
      .leftJoin(
        HabitLog,
        'log',
        'log.habit_id = h.id AND log.user_id = h.user_id AND log.date = :today',
        { today },
      )
      .addSelect('COALESCE(log.count, 0)', 'today_count')
      .where('h.user_id = :userId', { userId })
      .andWhere('h.archived_at IS NULL')
      .orderBy('h.created_at', 'DESC')
      .getRawAndEntities();

    return rows.entities.map((habit, idx) => {
      const todayCount = Number(rows.raw[idx]?.today_count ?? 0);
      return this.toHabitWithToday(habit, todayCount);
    });
  }

  async findOne(userId: string, id: string): Promise<HabitWithToday> {
    const today = utcToday();
    const habit = await this.habits.findOne({ where: { id, userId } });
    if (!habit) {
      // 404 (not 403) so a 403 response cannot be used to confirm a foreign row.
      throw new NotFoundException('Habit not found');
    }
    const todayLog = await this.habitLogs.findOne({
      where: { habitId: habit.id, userId, date: today },
    });
    return this.toHabitWithToday(habit, todayLog?.count ?? 0);
  }

  async create(userId: string, dto: CreateHabitDto): Promise<HabitWithToday> {
    const habit = this.habits.create({
      userId, // always from the JWT, never from the request body
      name: dto.name.trim(),
      color: dto.color ?? '#2FAF9E',
      icon: dto.icon ?? 'check',
      frequencyType: dto.frequencyType ?? 'daily',
      frequencyDays: dto.frequencyDays ?? 1,
      targetCount: dto.targetCount ?? 1,
      archivedAt: null,
    });
    const saved = await this.habits.save(habit);
    return this.toHabitWithToday(saved, 0);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateHabitDto,
  ): Promise<HabitWithToday> {
    const habit = await this.findHabitOrThrow(userId, id);

    if (dto.name !== undefined) habit.name = dto.name.trim();
    if (dto.color !== undefined) habit.color = dto.color;
    if (dto.icon !== undefined) habit.icon = dto.icon;
    if (dto.frequencyType !== undefined) habit.frequencyType = dto.frequencyType;
    if (dto.frequencyDays !== undefined) habit.frequencyDays = dto.frequencyDays;
    if (dto.targetCount !== undefined) habit.targetCount = dto.targetCount;
    // `archivedAt` accepts null to un-archive, an ISO string to re-archive.
    if (dto.archivedAt !== undefined) {
      habit.archivedAt =
        dto.archivedAt === null || dto.archivedAt === ''
          ? null
          : new Date(dto.archivedAt);
    }

    const saved = await this.habits.save(habit);

    const today = utcToday();
    const todayLog = await this.habitLogs.findOne({
      where: { habitId: saved.id, userId, date: today },
    });
    return this.toHabitWithToday(saved, todayLog?.count ?? 0);
  }

  /**
   * Soft-archive. The row stays around so historical streaks do not break if
   * the user un-archives later. Mirrors the `archivedAt` semantics in the
   * entity (a plain nullable Column, NOT @DeleteDateColumn).
   */
  async archive(userId: string, id: string): Promise<{ message: string }> {
    const habit = await this.findHabitOrThrow(userId, id);
    if (habit.archivedAt === null) {
      habit.archivedAt = new Date();
      await this.habits.save(habit);
    }
    // Idempotent: re-archiving an archived habit is a no-op success.
    return { message: 'Habit archived' };
  }

  // ===========================================================================
  // Check-in / check-out
  // ===========================================================================

  /**
   * Upsert: habit_logs is UNIQUE(habit_id, date), so we increment `count` when
   * the row already exists for that (habit, date). This makes "check then
   * cancel then check again" behave naturally and lets the API be called
   * repeatedly in a day (e.g. a water-tracking habit whose targetCount=8).
   */
  async check(
    userId: string,
    id: string,
    dto: CheckHabitDto,
  ): Promise<HabitLog> {
    const habit = await this.findHabitOrThrow(userId, id);
    const date = dto.date ?? utcToday();
    const count = dto.count ?? 1;
    const note = dto.note ?? null;

    if (count < 1) {
      throw new BadRequestException('count must be >= 1');
    }

    return this.dataSource.transaction(async (manager: EntityManager) => {
      const repo = manager.getRepository(HabitLog);
      const existing = await repo.findOne({
        where: { habitId: habit.id, userId, date },
      });
      if (existing) {
        existing.count += count;
        // Note is replaced, not appended - simpler API contract.
        if (note !== null) existing.note = note;
        return repo.save(existing);
      }
      const created = repo.create({ habitId: habit.id, userId, date, count, note });
      return repo.save(created);
    });
  }

  /**
   * Cancel a check-in. Idempotent: deleting a non-existent log returns 204-like
   * 200 success ("nothing to undo") rather than 404, so a stale mobile client
   * does not surface a misleading error.
   */
  async uncheck(
    userId: string,
    id: string,
    date: string,
  ): Promise<{ message: string }> {
    const habit = await this.findHabitOrThrow(userId, id);
    const result = await this.habitLogs.delete({
      habitId: habit.id,
      userId,
      date,
    });
    if (result.affected && result.affected > 0) {
      return { message: 'Check-in removed' };
    }
    return { message: 'No check-in to remove' };
  }

  // ===========================================================================
  // Stats
  // ===========================================================================

  async getStats(
    userId: string,
    id: string,
    range: HabitStatsRange,
  ): Promise<HabitStats> {
    const habit = await this.findHabitOrThrow(userId, id);

    const today = utcToday();
    const days = RANGE_DAYS[range];
    // rangeStart is inclusive; rangeEnd is today (inclusive). Keeping the
    // window length exact avoids off-by-one in completion-rate reporting.
    const rangeStart = addUtcDays(today, -(days - 1));
    const rangeEnd = today;

    const logs = await this.habitLogs.find({
      where: { habitId: habit.id, userId },
      order: { date: 'ASC' },
    });
    const logsByDate = new Set(logs.map((l) => l.date));
    const countByDate = new Map<string, number>();
    for (const l of logs) countByDate.set(l.date, l.count);

    const { currentStreak, longestStreak, scheduledDays, checkedScheduledDays } =
      computeStreaks({
        habit,
        logsByDate,
        // For historical longest streaks we look at the whole log history, not
        // just the visible window - the user may have been tracking for years.
        // Current streak is bounded by today either way.
        historyStart: minOf(
          toUtcDateStringOnly(habit.createdAt),
          rangeStart,
        ),
        rangeEnd: today,
        computeCurrentStreak: true,
      });

    // Heatmap is rendered strictly inside the requested window - the UI page
    // for "last 30 days" must not show data from before that.
    const heatmap: HeatmapPoint[] = eachUtcDay(rangeStart, rangeEnd).map(
      (d) => ({
        date: d,
        count: countByDate.get(d) ?? 0,
        completed: (countByDate.get(d) ?? 0) >= habit.targetCount,
      }),
    );

    return {
      habitId: habit.id,
      range,
      rangeStart,
      rangeEnd,
      totalCheckins: logs.filter((l) => l.date >= rangeStart && l.date <= rangeEnd)
        .reduce((acc, l) => acc + l.count, 0),
      scheduledDays,
      checkedScheduledDays,
      completionRate:
        scheduledDays === 0
          ? 0
          : round4(checkedScheduledDays / scheduledDays),
      currentStreak,
      longestStreak,
      heatmap,
    };
  }

  async getOverallStats(userId: string): Promise<OverallStats> {
    const today = utcToday();
    const weekStart = addUtcDays(today, -6); // 7-day window, inclusive of today

    // Single round-trip: pull every habit + its last 7 days of logs, then
    // compute everything in-memory. This is bounded by `habits * 7` rows per
    // user - micro-optimisation for a feature that will stay per-user for a
    // long time.
    const habits = await this.habits.find({ where: { userId } });
    const habitIds = habits.map((h) => h.id);
    const recentLogs =
      habitIds.length === 0
        ? []
        : await this.habitLogs
            .createQueryBuilder('log')
            .where('log.user_id = :userId', { userId })
            .andWhere('log.habit_id IN (:...habitIds)', { habitIds })
            .andWhere('log.date >= :weekStart', { weekStart })
            .andWhere('log.date <= :today', { today })
            .getMany();

    const logsByHabit = new Map<string, Map<string, number>>();
    for (const log of recentLogs) {
      let inner = logsByHabit.get(log.habitId);
      if (!inner) {
        inner = new Map<string, number>();
        logsByHabit.set(log.habitId, inner);
      }
      inner.set(log.date, (inner.get(log.date) ?? 0) + log.count);
    }

    let todayCompleted = 0;
    let weeklyScheduled = 0;
    let weeklyDone = 0;

    for (const habit of habits) {
      if (habit.archivedAt === null) {
        if (habitIds.length > 0) {
          const todayCount =
            logsByHabit.get(habit.id)?.get(today) ?? 0;
          if (todayCount >= habit.targetCount) todayCompleted += 1;
        }
        for (const day of eachUtcDay(weekStart, today)) {
          if (isScheduledDay(day, habit)) {
            weeklyScheduled += 1;
            const cnt = logsByHabit.get(habit.id)?.get(day) ?? 0;
            if (cnt >= habit.targetCount) weeklyDone += 1;
          }
        }
      }
    }

    const activeHabits = habits.filter((h) => h.archivedAt === null).length;

    return {
      totalHabits: habits.length,
      activeHabits,
      archivedHabits: habits.length - activeHabits,
      todayCompleted,
      todayPending: Math.max(0, activeHabits - todayCompleted),
      weekCompletionRate:
        weeklyScheduled === 0 ? 0 : round4(weeklyDone / weeklyScheduled),
    };
  }

  // ===========================================================================
  // Internals
  // ===========================================================================

  /** Throws NotFoundException with a generic message (no row-existence leak). */
  private async findHabitOrThrow(userId: string, id: string): Promise<Habit> {
    const habit = await this.habits.findOne({ where: { id, userId } });
    if (!habit) throw new NotFoundException('Habit not found');
    return habit;
  }

  private toHabitWithToday(habit: Habit, todayCount: number): HabitWithToday {
    return {
      id: habit.id,
      userId: habit.userId,
      name: habit.name,
      color: habit.color,
      icon: habit.icon,
      frequencyType: habit.frequencyType,
      frequencyDays: habit.frequencyDays,
      targetCount: habit.targetCount,
      archivedAt: habit.archivedAt,
      createdAt: habit.createdAt,
      updatedAt: habit.updatedAt,
      todayCount,
      todayCompleted: todayCount >= habit.targetCount,
    };
  }
}

// ===========================================================================
// Module-level helpers (kept out of the class so they are easy to unit test
// and tree-shakable).
// ===========================================================================

/** Two-pass scan over [historyStart, rangeEnd], skipping non-scheduled days.
 *
 *  currentStreak: starts at `rangeEnd`. The first scheduled day on or before
 *  `rangeEnd` is the "anchor" - if it has no log, currentStreak = 0 (today is
 *  a scheduled day and you missed it). From that anchor we walk left, only
 *  landing on scheduled days; missing one zeros the counter.
 *
 *  longestStreak: straight left-to-right scan. Non-scheduled days are
 *  skipped (they neither reset nor extend a streak); scheduled days must
 *  have a log to extend it, otherwise the current run zeros out and the
 *  longest-so-far is kept.
 */
export function computeStreaks(opts: {
  habit: { frequencyType: HabitFrequencyType; frequencyDays: number; createdAt: Date };
  logsByDate: Set<string>;
  historyStart: string;
  rangeEnd: string;
  computeCurrentStreak: boolean;
}): {
  currentStreak: number;
  longestStreak: number;
  scheduledDays: number;
  checkedScheduledDays: number;
} {
  const { habit, logsByDate, historyStart, rangeEnd } = opts;

  if (utcDayDiff(historyStart, rangeEnd) < 0) {
    return {
      currentStreak: 0,
      longestStreak: 0,
      scheduledDays: 0,
      checkedScheduledDays: 0,
    };
  }

  const days = eachUtcDay(historyStart, rangeEnd);

  let longest = 0;
  let run = 0;
  let scheduledDays = 0;
  let checkedScheduledDays = 0;

  for (const day of days) {
    if (!isScheduledDay(day, habit)) continue;
    scheduledDays += 1;
    const has = logsByDate.has(day);
    if (has) {
      checkedScheduledDays += 1;
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }

  let currentStreak = 0;
  if (opts.computeCurrentStreak) {
    // Walk left from `rangeEnd`. Skip non-scheduled days without ending the
    // streak; end the streak at the first scheduled day that has no log.
    let cursor = rangeEnd;
    let started = false;
    while (utcDayDiff(historyStart, cursor) >= 0) {
      if (isScheduledDay(cursor, habit)) {
        if (logsByDate.has(cursor)) {
          currentStreak += 1;
          started = true;
        } else if (started) {
          // Already inside a run - missing this scheduled day breaks it.
          break;
        }
        // If not yet started and the day is missing: stay in pre-state.
      }
      if (cursor === historyStart) break;
      cursor = addUtcDays(cursor, -1);
    }
  }

  return { currentStreak, longestStreak: longest, scheduledDays, checkedScheduledDays };
}

/** Convert a Date or string to YYYY-MM-DD (UTC). Re-export for convenience. */
function toUtcDateStringOnly(input: Date | string): string {
  if (typeof input === 'string') {
    // Already a YYYY-MM-DD format? Keep as-is; otherwise normalise.
    if (/^\d{4}-\d{2}-\d{2}$/.test(input)) return input;
    return new Date(input).toISOString().slice(0, 10);
  }
  const y = input.getUTCFullYear();
  const m = String(input.getUTCMonth() + 1).padStart(2, '0');
  const day = String(input.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Lexically smaller YYYY-MM-DD comes first. */
function minOf(a: string, b: string): string {
  return a <= b ? a : b;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
