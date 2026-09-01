import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { HabitLog } from './habit-log.entity';

/**
 * Frequency modes for a habit. Each value determines how the streak/stats
 * services decide whether a given calendar day is a "scheduled" one:
 *
 *   - 'daily'         every day counts
 *   - 'weekdays'      Mon..Fri only (ISO weekday 1..5)
 *   - 'custom'        reserved for future per-weekday bitmasks; currently
 *                     behaves as 'daily' until the API exposes the bitmask
 *                     in CheckHabitDto. Documented here so consumers do not
 *                     assume custom == weekdays.
 *   - 'every_n_days'  every `frequency_days` day, starting on `created_at`
 */
export type HabitFrequencyType = 'daily' | 'weekdays' | 'custom' | 'every_n_days';

@Entity({ name: 'habits' })
@Index('IDX_habits_user_archived', ['userId', 'archivedAt'])
export class Habit {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /**
   * Owner. Every HabitsService method folds this into the WHERE clause / payload
   * (same rule as TodosService). Never derived from request body.
   */
  @Column({ name: 'user_id', type: 'uuid' })
  @Index('IDX_habits_user_id')
  userId: string;

  @Column({ type: 'varchar', length: 64 })
  name: string;

  @Column({ type: 'varchar', length: 16, default: '#2FAF9E' })
  color: string;

  @Column({ type: 'varchar', length: 32, default: 'check' })
  icon: string;

  @Column({
    name: 'frequency_type',
    type: 'varchar',
    length: 16,
    default: 'daily',
  })
  frequencyType: HabitFrequencyType;

  /**
   * Only meaningful when frequencyType='every_n_days' (e.g. 3 = every 3 days).
   * Stored on every row for simplicity; ignored by the streak algorithm otherwise.
   */
  @Column({ name: 'frequency_days', type: 'int', default: 1 })
  frequencyDays: number;

  @Column({ name: 'target_count', type: 'int', default: 1 })
  targetCount: number;

  /**
   * Soft archive marker. We do NOT use @DeleteDateColumn here because:
   *   1. archived habits should be fetchable (un-archive is a real use case);
   *   2. the controller filters `archivedAt IS NULL` explicitly in list();
   *   3. stats endpoints deliberately include archived habits so historical
   *      streaks survive an archive/restore round-trip.
   */
  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  // ---------------------------------------------------------------- relations
  /** Inverse side of HabitLog.habit. Not eagerly loaded; only joined when needed. */
  @OneToMany(() => HabitLog, (log) => log.habit)
  logs?: HabitLog[];
}
