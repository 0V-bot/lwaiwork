import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { TodosModule } from '../todos/todos.module';
import { HabitsModule } from '../habits/habits.module';
import { NotesModule } from '../notes/notes.module';
import { SchedulesModule } from '../schedules/schedules.module';
import { FilesModule } from '../files/files.module';

import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

/**
 * Analytics module.
 *
 * Pure read-only aggregation - no entities of its own. The service
 * imports the schedule expansion via SchedulesService (so recurring
 * instances are computed the same way the dashboard tile does), and
 * runs the other four series through native SQL on the shared
 * DataSource.
 *
 * RedisModule is `@Global()`, so RedisService is reachable without an
 * imports entry here.
 *
 * The module deliberately does NOT register a custom repository or
 * entity - everything is either a public service call or a raw query.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([]),
    TodosModule,
    HabitsModule,
    NotesModule,
    SchedulesModule,
    FilesModule,
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
