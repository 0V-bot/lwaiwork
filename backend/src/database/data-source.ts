/**
 * Standalone TypeORM DataSource - used by the CLI (`npm run migration:*`).
 * The Nest runtime uses DatabaseModule instead; NEVER import this file from src.
 */
import { config } from 'dotenv';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { User } from '../users/user.entity';
import { Todo } from '../todos/todo.entity';
import { Habit } from '../habits/entities/habit.entity';
import { HabitLog } from '../habits/entities/habit-log.entity';
import { Note } from '../notes/entities/note.entity';
import { Schedule } from '../schedules/entities/schedule.entity';
import { ScheduleOverride } from '../schedules/entities/schedule-override.entity';

config({ path: '.env' });

const synchronize = process.env.TYPEORM_SYNCHRONIZE === 'true';

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  url: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/lwaiwork',
  entities: [User, Todo, Habit, HabitLog, Note, Schedule, ScheduleOverride],
  migrations: [__dirname + '/../../migrations/*{.ts,.js}'],
  synchronize,
  dropSchema: false,
  logging: ['error', 'warn', 'migration'],
};

export const AppDataSource = new DataSource(dataSourceOptions);
