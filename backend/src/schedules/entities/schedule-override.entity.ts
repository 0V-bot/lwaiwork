import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { Schedule } from './schedule.entity';

/**
 * One row per (schedule, instanceStartAt). Carries per-instance edits:
 *
 *   * Field-level overrides (`title`, `description`, `startAt`, `endAt`,
 *     `allDay`, `location`, `reminderMinutes`) - each is nullable, and a
 *     null means "inherit the series default at expansion time". This is
 *     what lets the front-end PATCH a single field on one instance without
 *     touching the rest.
 *
 *   * `truncate = true` is the "this and future" tombstone for a single
 *     DELETE call. The expansion engine stops yielding further instances as
 *     soon as it hits an override row with this flag set.
 *
 * Composite PK (`schedule_id`, `instance_start_at`) doubles as the lookup
 * index the service uses for O(log N) point reads during window expansion.
 *
 * No `createdAt`/`updatedAt`: rows are upserted and the effective value
 * comes from whichever fields are non-null. Adding timestamps here would
 * just bloat the table for zero UX value.
 */
@Entity({ name: 'schedule_overrides' })
@Index('IDX_schedule_overrides_schedule_start', ['scheduleId', 'instanceStartAt'])
export class ScheduleOverride {
  @PrimaryColumn({ name: 'schedule_id', type: 'uuid' })
  scheduleId!: string;

  @PrimaryColumn({ name: 'instance_start_at', type: 'timestamptz' })
  instanceStartAt!: Date;

  @Column({ type: 'varchar', length: 200, nullable: true })
  title!: string | null;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  /**
   * If non-null, replaces the series' `startAt` for this instance (UTC).
   * Lets the user push a single occurrence to a different day/time.
   */
  @Column({ name: 'start_at', type: 'timestamptz', nullable: true })
  startAt!: Date | null;

  @Column({ name: 'end_at', type: 'timestamptz', nullable: true })
  endAt!: Date | null;

  @Column({ name: 'all_day', type: 'boolean', nullable: true })
  allDay!: boolean | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  location!: string | null;

  /** See Schedule.reminderMinutes. NULL means "keep series default". */
  @Column({ name: 'reminder_minutes', type: 'int', array: true, nullable: true })
  reminderMinutes!: number[] | null;

  /**
   * "This and future" tombstone. The expansion engine stops yielding further
   * instances from this schedule as soon as it meets a row with truncate=true.
   */
  @Column({ type: 'boolean', default: false })
  truncate!: boolean;

  // ---------------------------------------------------------------- relations
  @ManyToOne(() => Schedule, (schedule) => schedule.overrides, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'schedule_id' })
  schedule?: Schedule;
}
