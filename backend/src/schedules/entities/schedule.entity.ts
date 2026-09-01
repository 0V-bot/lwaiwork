import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ScheduleOverride } from './schedule-override.entity';

/**
 * One row per schedule (single or recurring), owned by exactly one user.
 *
 * Time handling:
 *   * `startAt` / `endAt` are stored as TIMESTAMPTZ (UTC under the hood).
 *   * `timezone` is the IANA zone the user gave us (e.g. "Asia/Shanghai").
 *     It does NOT shift the absolute UTC moment - the on-disk `startAt` is
 *     canonical. The zone is only used for display + for the RRULE engine
 *     so that "9am every Monday" stays at 9am local even across DST.
 *   * `allDay = true` means the UI should render a day-level chip instead of
 *     a clock; the DB still keeps the timestamp (start of day in `timezone`).
 *
 * RRULE contract:
 *   * `rrule` is null -> single event, only one instance ever.
 *   * `rrule` is set  -> the RRULE string goes with `startAt` + `timezone`
 *     into the expansion engine. We deliberately DO NOT embed DTSTART inside
 *     the stored string - `startAt` is the single source of truth.
 *
 * Per-instance edits live in `schedule_overrides` (OneToMany below).
 *
 * SECURITY: every service query MUST fold `user_id` into WHERE; a cross-tenant
 * read or write returns 404 (not 403) so the response cannot be used to probe
 * row existence - same rule as habits/notes/todos.
 */
@Entity({ name: 'schedules' })
@Index('IDX_schedules_user_archived', ['userId', 'archivedAt'])
@Index('IDX_schedules_user_start', ['userId', 'startAt'])
export class Schedule {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * Owner. Always sourced from the validated JWT principal (`@CurrentUser`),
   * never from a request body field - same rule as HabitsService / TodosService.
   */
  @Column({ name: 'user_id', type: 'uuid' })
  @Index('IDX_schedules_user_id')
  userId!: string;

  @Column({ type: 'varchar', length: 200 })
  title!: string;

  /** Plaintext description. Optional. */
  @Column({ type: 'text', nullable: true })
  description!: string | null;

  /** Canonical UTC moment of the first (and only, if no rrule) instance. */
  @Column({ name: 'start_at', type: 'timestamptz' })
  startAt!: Date;

  /** Optional end. NULL means an open-ended / start-only event. */
  @Column({ name: 'end_at', type: 'timestamptz', nullable: true })
  endAt!: Date | null;

  /** IANA tz, e.g. "Asia/Shanghai". Required even for single events. */
  @Column({ type: 'varchar', length: 64 })
  timezone!: string;

  @Column({ name: 'all_day', type: 'boolean', default: false })
  allDay!: boolean;

  /**
   * RRULE string WITHOUT a DTSTART prefix. NULL means a one-off event.
   * The expansion engine merges it with `startAt` + `timezone` itself.
   * Example values: "FREQ=DAILY;COUNT=5", "FREQ=WEEKLY;BYDAY=MO,WE,FR".
   */
  @Column({ type: 'text', nullable: true })
  rrule!: string | null;

  /**
   * Black-list of instance starts that should be skipped during expansion
   * (a "delete this one occurrence" UX). Stored on the series row so the
   * window-query stays a single round-trip.
   *
   * TIMESTAMPTZ[] in Postgres - each element is a UTC moment.
   */
  @Column({ name: 'exdates', type: 'timestamptz', array: true, default: () => "'{}'" })
  exdates!: Date[];

  @Column({ type: 'varchar', length: 200, nullable: true })
  location!: string | null;

  /**
   * Reminder offsets in MINUTES BEFORE `startAt`. e.g. `[15, 60]` means a
   * notification 15 min and 60 min before each instance. M2 only stores this;
   * the actual push delivery is a later milestone.
   */
  @Column({ name: 'reminder_minutes', type: 'int', array: true, default: () => "'{}'" })
  reminderMinutes!: number[];

  /** UI palette token (#RGB / #RRGGBB). Defaults to teal like the other modules. */
  @Column({ type: 'varchar', length: 16, default: '#2FAF9E' })
  color!: string;

  /**
   * Soft archive marker. Same rationale as Habit.archivedAt / Note.archivedAt:
   * we want archived rows queryable (e.g. for un-archive UI) so we use a
   * plain nullable Column, NOT @DeleteDateColumn.
   */
  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  // ---------------------------------------------------------------- relations
  /**
   * Per-instance overrides. Inverse side of ScheduleOverride.schedule. Not
   * eagerly loaded - the list endpoint joins explicitly only when needed.
   */
  @OneToMany(() => ScheduleOverride, (ov) => ov.schedule)
  overrides?: ScheduleOverride[];
}
