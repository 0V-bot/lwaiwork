import { Module } from '@nestjs/common';
import { TodosModule } from '../todos/todos.module';
import { HabitsModule } from '../habits/habits.module';
import { SchedulesModule } from '../schedules/schedules.module';
import { NotesModule } from '../notes/notes.module';
import { FilesModule } from '../files/files.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

/**
 * Dashboard module.
 *
 * Pure aggregation - no entities, no repository. Imports the five source
 * modules so the service can reach each service through its public DI
 * surface. The module deliberately does NOT export anything - the
 * dashboard is a read-only leaf endpoint.
 */
@Module({
  imports: [TodosModule, HabitsModule, SchedulesModule, NotesModule, FilesModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
