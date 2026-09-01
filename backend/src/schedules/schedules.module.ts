import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Schedule } from './entities/schedule.entity';
import { ScheduleOverride } from './entities/schedule-override.entity';
import { SchedulesService } from './schedules.service';
import { SchedulesController } from './schedules.controller';

/**
 * Schedules module.
 *
 * Imports both entities via `TypeOrmModule.forFeature` so the service can
 * `@InjectRepository` them. No providers beyond the service + controller
 * - the heavy lifting (RRULE build, window expansion, override merge)
 * lives in standalone helper files (`rrule.util.ts`, `instance-builder.ts`)
 * to keep the service focused on HTTP-shaped orchestration.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Schedule, ScheduleOverride])],
  controllers: [SchedulesController],
  providers: [SchedulesService],
})
export class SchedulesModule {}
