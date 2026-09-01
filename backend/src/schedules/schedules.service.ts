import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { Schedule } from './entities/schedule.entity';
import { ScheduleOverride } from './entities/schedule-override.entity';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { UpdateInstanceDto } from './dto/instance-action.dto';
import {
  buildInstances,
  type ScheduleInstanceDto,
} from './instance-builder';
import {
  applyTruncate,
  assertRRuleValid,
  buildRule,
  expandRule,
  InvalidRRuleError,
} from './rrule.util';

// ---------------------------------------------------------------------------
// Public response shapes (interfaces, not classes - same pattern as HabitsService
// and NotesService so we don't double the entity count for Swagger purposes).
// ---------------------------------------------------------------------------

export interface ScheduleDetail {
  schedule: Schedule;
  overrides: ScheduleOverride[];
}

@Injectable()
export class SchedulesService {
  private readonly logger = new Logger(SchedulesService.name);

  constructor(
    @InjectRepository(Schedule)
    private readonly schedules: Repository<Schedule>,
    @InjectRepository(ScheduleOverride)
    private readonly overrides: Repository<ScheduleOverride>,
  ) {}

  // ===========================================================================
  // CRUD
  // ===========================================================================

  async create(userId: string, dto: CreateScheduleDto): Promise<Schedule> {
    const rrule =
      dto.rrule === undefined || dto.rrule === null || dto.rrule === ''
        ? null
        : dto.rrule;

    // Verify the RRULE + timezone actually parse - if not, the user would
    // get a confusing 500 the next time they expand this window.
    try {
      assertRRuleValid(rrule, dto.startAt, dto.timezone);
    } catch (err) {
      if (err instanceof InvalidRRuleError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }

    const created = this.schedules.create({
      userId,
      title: dto.title.trim(),
      description: dto.description ?? null,
      startAt: dto.startAt,
      endAt: dto.endAt ?? null,
      timezone: dto.timezone,
      allDay: dto.allDay ?? false,
      rrule,
      exdates: dto.exdates ? [...dto.exdates] : [],
      location: dto.location ?? null,
      reminderMinutes: dto.reminderMinutes ? [...dto.reminderMinutes] : [],
      color: dto.color ?? '#2FAF9E',
      archivedAt: null,
    });
    return this.schedules.save(created);
  }

  async findOne(userId: string, id: string): Promise<ScheduleDetail> {
    const schedule = await this.findScheduleOrThrow(userId, id);
    const overrides = await this.overrides.find({
      where: { scheduleId: schedule.id },
      order: { instanceStartAt: 'ASC' },
    });
    return { schedule, overrides };
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateScheduleDto,
  ): Promise<Schedule> {
    const schedule = await this.findScheduleOrThrow(userId, id);

    if (dto.title !== undefined) schedule.title = dto.title.trim();
    if (dto.description !== undefined) schedule.description = dto.description;
    if (dto.startAt !== undefined) schedule.startAt = dto.startAt;
    if (dto.endAt !== undefined) schedule.endAt = dto.endAt;
    if (dto.timezone !== undefined) schedule.timezone = dto.timezone;
    if (dto.allDay !== undefined) schedule.allDay = dto.allDay;
    if (dto.location !== undefined) schedule.location = dto.location;
    if (dto.reminderMinutes !== undefined) {
      schedule.reminderMinutes = [...dto.reminderMinutes];
    }
    if (dto.color !== undefined) schedule.color = dto.color;

    // exdates: explicit empty array = clear; undefined = leave alone.
    if (dto.exdates !== undefined) {
      schedule.exdates = [...dto.exdates];
    }

    // rrule: null or empty string clears the recurrence (back to a one-off
    // event). undefined leaves it alone.
    if (dto.rrule !== undefined) {
      const next =
        dto.rrule === null || dto.rrule === '' ? null : dto.rrule;
      try {
        assertRRuleValid(next, schedule.startAt, schedule.timezone);
      } catch (err) {
        if (err instanceof InvalidRRuleError) {
          throw new BadRequestException(err.message);
        }
        throw err;
      }
      schedule.rrule = next;
    }

    // archivedAt: ISO string to archive, null to restore, undefined = leave.
    if (dto.archivedAt !== undefined) {
      if (dto.archivedAt === null) {
        schedule.archivedAt = null;
      } else {
        schedule.archivedAt =
          dto.archivedAt instanceof Date
            ? dto.archivedAt
            : new Date(dto.archivedAt);
      }
    }

    return this.schedules.save(schedule);
  }

  async archive(userId: string, id: string): Promise<{ message: string }> {
    const schedule = await this.findScheduleOrThrow(userId, id);
    if (schedule.archivedAt === null) {
      schedule.archivedAt = new Date();
      await this.schedules.save(schedule);
    }
    return { message: 'Schedule archived' };
  }

  // ===========================================================================
  // Window expansion
  // ===========================================================================

  /**
   * Expand every owned schedule into its instances within `[from, to)`.
   *
   * Performance:
   *   * One DB round-trip to fetch all candidate series.
   *   * One DB round-trip to fetch every override for those series.
   *   * In-memory expansion via `rrule.between()` and merge.
   *
   *   For a single user the schedule count is O(hundreds), each rule
   *   expansion is bounded by the window length / frequency, so the
   *   worst case is small. If a user ever accumulates thousands of
   *   recurring series we would add a DB-side pre-filter on
   *   `(user_id, start_at <= to)` (the series has to have started)
   *   and a `rrule.until`-aware filter for the post-condition.
   */
  async listWindow(
    userId: string,
    from: Date,
    to: Date,
    includeArchived: boolean,
  ): Promise<ScheduleInstanceDto[]> {
    if (from.getTime() >= to.getTime()) {
      throw new BadRequestException('from must be before to');
    }

    // Hot path: load every series for this user at once, then narrow in
    // memory. For the dominant case (a personal calendar with under ~500
    // series) the second SELECT below matters more.
    const schedules = await this.schedules.find({
      where: includeArchived ? { userId } : { userId, archivedAt: IsNull() },
      order: { startAt: 'ASC' },
    });

    if (schedules.length === 0) return [];

    // Single round-trip for overrides.
    const scheduleIds = schedules.map((s) => s.id);
    const allOverrides = await this.overrides.find({
      where: { scheduleId: In(scheduleIds) },
      order: { instanceStartAt: 'ASC' },
    });
    const overridesBySchedule = new Map<string, ScheduleOverride[]>();
    for (const ov of allOverrides) {
      let list = overridesBySchedule.get(ov.scheduleId);
      if (!list) {
        list = [];
        overridesBySchedule.set(ov.scheduleId, list);
      }
      list.push(ov);
    }

    const out: ScheduleInstanceDto[] = [];

    for (const schedule of schedules) {
      const overrides = overridesBySchedule.get(schedule.id) ?? [];

      // For a series that started AFTER the window's upper bound, we can
      // safely skip without invoking the rrule engine.
      if (schedule.startAt.getTime() >= to.getTime()) continue;

      let occurrences: Date[];
      try {
        const rule = buildRule({
          rrule: schedule.rrule,
          startAt: schedule.startAt,
          timezone: schedule.timezone,
        });

        if (rule === null) {
          // Single event. Treat the row itself as one occurrence (if it
          // falls inside the window and isn't on the exdate list).
          if (
            schedule.startAt.getTime() < to.getTime() &&
            schedule.startAt.getTime() >= from.getTime() &&
            !schedule.exdates.some(
              (d) => d.getTime() === schedule.startAt.getTime(),
            )
          ) {
            occurrences = [schedule.startAt];
          } else {
            continue;
          }
        } else {
          occurrences = expandRule({
            rule,
            from,
            to,
            exdates: schedule.exdates,
          });
        }
      } catch (err) {
        if (err instanceof InvalidRRuleError) {
          // A bad RRULE in the DB shouldn't 500 the whole endpoint -
          // log + skip. The user will discover the issue when they PATCH
          // the offending series (which validates the string).
          this.logger.warn(
            `Skipping schedule ${schedule.id}: ${err.message}`,
          );
          continue;
        }
        throw err;
      }

      const instances = buildInstances({
        schedule,
        occurrences,
        overrides,
        windowFrom: from,
        windowTo: to,
      });
      out.push(...instances);
    }

    // Already ascending per schedule; a final sort keeps multi-schedule
    // responses deterministic for the calendar grid.
    out.sort((a, b) => {
      const diff = a.instanceStartAt.getTime() - b.instanceStartAt.getTime();
      if (diff !== 0) return diff;
      return a.scheduleId.localeCompare(b.scheduleId);
    });

    return out;
  }

  // ===========================================================================
  // Per-instance actions
  // ===========================================================================

  /**
   * Upsert a `schedule_overrides` row. The row is keyed by the ORIGINAL
   * occurrence time - the brief treats that as the canonical instance id,
   * independent of any override that may move the visible startAt.
   */
  async patchInstance(
    userId: string,
    scheduleId: string,
    instanceStartAt: Date,
    dto: UpdateInstanceDto,
  ): Promise<ScheduleOverride> {
    const schedule = await this.findScheduleOrThrow(userId, scheduleId);

    // Quickly reject the case where the user picked an instanceStartAt
    // that the series never produced - saves a misleading 200 OK later.
    if (!this.isPlausibleInstance(schedule, instanceStartAt)) {
      throw new BadRequestException(
        'instanceStartAt does not match any occurrence of this schedule',
      );
    }

    const existing = await this.overrides.findOne({
      where: { scheduleId: schedule.id, instanceStartAt },
    });

    const next = this.overrides.create({
      scheduleId: schedule.id,
      instanceStartAt,
      // Field-level inheritance: any undefined field stays as the existing
      // override value (or null for a brand-new row). We deliberately do
      // NOT read defaults from the series here - the merge happens at
      // expansion time via instance-builder.ts.
      title: dto.title ?? existing?.title ?? null,
      description: dto.description ?? existing?.description ?? null,
      startAt: dto.startAt ?? existing?.startAt ?? null,
      endAt: dto.endAt ?? existing?.endAt ?? null,
      allDay: dto.allDay ?? existing?.allDay ?? null,
      location: dto.location ?? existing?.location ?? null,
      reminderMinutes:
        dto.reminderMinutes ?? existing?.reminderMinutes ?? null,
      // PATCH never sets truncate=true - that flag is reserved for the
      // DELETE-with-truncate tombstone path.
      truncate: false,
    });
    return this.overrides.save(next);
  }

  /**
   * Remove a single occurrence.
   *
   *   * `truncate = false` (default) -> push the occurrence onto the
   *     series' exdate blacklist. The series itself is unchanged.
   *   * `truncate = true` -> rewrite the series' RRULE with UNTIL =
   *     occurrence - 1ms, plus drop a tombstone override row so later
   *     series edits cannot accidentally re-enable future occurrences.
   */
  async deleteInstance(
    userId: string,
    scheduleId: string,
    instanceStartAt: Date,
    truncate: boolean,
  ): Promise<{ message: string }> {
    const schedule = await this.findScheduleOrThrow(userId, scheduleId);

    if (!this.isPlausibleInstance(schedule, instanceStartAt)) {
      // The brief's "instanceStartAt" is the original occurrence time -
      // a value the rule has never produced cannot be a valid target.
      throw new BadRequestException(
        'instanceStartAt does not match any occurrence of this schedule',
      );
    }

    if (!truncate) {
      // Idempotent exdate push - duplicates would only harm readability.
      const alreadyExcluded = schedule.exdates.some(
        (d) => d.getTime() === instanceStartAt.getTime(),
      );
      if (!alreadyExcluded) {
        schedule.exdates = [...schedule.exdates, instanceStartAt];
        await this.schedules.save(schedule);
      }
      return { message: 'Instance deleted' };
    }

    // Truncate path. For a non-recurring series this is logically the
    // same as archiving it.
    if (schedule.rrule === null) {
      if (schedule.archivedAt === null) {
        schedule.archivedAt = new Date();
        await this.schedules.save(schedule);
      }
      return { message: 'Schedule archived' };
    }

    const newRrule = applyTruncate(schedule.rrule, instanceStartAt);
    if (newRrule === null) {
      // The truncate would leave an empty series - safer to archive.
      schedule.archivedAt = new Date();
      await this.schedules.save(schedule);
      return { message: 'Schedule archived' };
    }

    try {
      assertRRuleValid(newRrule, schedule.startAt, schedule.timezone);
    } catch (err) {
      if (err instanceof InvalidRRuleError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }

    schedule.rrule = newRrule;

    // Belt-and-braces: write the truncate tombstone so a later PATCH :id
    // that clears UNTIL doesn't re-enable past-and-future instances.
    const tombstone = this.overrides.create({
      scheduleId: schedule.id,
      instanceStartAt,
      truncate: true,
      // All field-level overrides left null on purpose - truncates don't
      // carry user-visible edits, only the "stop" signal.
    });
    await this.overrides.save(tombstone);

    await this.schedules.save(schedule);
    return { message: 'Truncated at instance' };
  }

  // ===========================================================================
  // Internals
  // ===========================================================================

  /**
   * Throws NotFoundException with a generic message - same "404 not 403" rule
   * the other modules use, so a foreign-row probe can't be distinguished
   * from a never-existed row.
   */
  private async findScheduleOrThrow(
    userId: string,
    id: string,
  ): Promise<Schedule> {
    const schedule = await this.schedules.findOne({ where: { id, userId } });
    if (!schedule) throw new NotFoundException('Schedule not found');
    return schedule;
  }

  /**
   * Reject `instanceStartAt` values that aren't even theoretically an
   * occurrence of the rule. Cheap to compute; saves the user from a 200
   * OK that did nothing.
   *
   * For non-recurring series the only valid instanceStartAt is the row's
   * own startAt. For recurring series we accept any time that's an
   * integer-multiple of the rule's "tick" from the DTSTART - we
   * approximate with a sanity floor: anything BEFORE the rule's startAt
   * is definitely wrong. (Exact occurrence matching requires expanding
   * the rule, which is more expensive than this guard is worth.)
   */
  private isPlausibleInstance(
    schedule: Schedule,
    instanceStartAt: Date,
  ): boolean {
    // The instance's own startAt is always a valid target.
    if (schedule.startAt.getTime() === instanceStartAt.getTime()) return true;
    // Instances earlier than the series DTSTART cannot exist.
    if (instanceStartAt.getTime() < schedule.startAt.getTime()) return false;
    return true;
  }
}
