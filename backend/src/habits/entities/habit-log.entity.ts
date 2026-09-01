import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Habit } from './habit.entity';

/**
 * A single check-in for a habit on a specific (UTC) calendar day.
 *
 * One row per (habit, date) - enforced both by the schema (UNIQUE constraint)
 * and by the service (uses upsert on POST /habits/:id/check). `count > 0` for
 * "checked at least once"; the "is today done?" check is
 * `log.count >= habit.targetCount`.
 */
@Entity({ name: 'habit_logs' })
@Unique('UQ_habit_logs_habit_date', ['habitId', 'date'])
@Index('IDX_habit_logs_user_date', ['userId', 'date'])
export class HabitLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Owner. Duplicated (denormalised) on the log row so streak queries never
   * have to join the habits table just to scope by user.
   */
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'habit_id', type: 'uuid' })
  habitId: string;

  /**
   * Calendar day in UTC, formatted `YYYY-MM-DD` (postgres `date`).
   * Stored as string for deterministic JSON serialisation.
   */
  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'int', default: 1 })
  count: number;

  @Column({ type: 'varchar', length: 255, nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  // ---------------------------------------------------------------- relations
  @ManyToOne(() => Habit, (habit) => habit.logs, {
    onDelete: 'CASCADE',
    nullable: false,
  })
  @JoinColumn({ name: 'habit_id' })
  habit?: Habit;
}
