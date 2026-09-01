import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

/**
 * Swagger response shapes for `GET /api/dashboard/today`.
 *
 * The endpoint is read-only and takes no query/body parameters, so there
 * are no request DTOs. The classes below exist purely so Swagger / OpenAPI
 * picks up the response schema — the actual data is constructed in
 * `DashboardService` and projected via the interfaces in
 * `./interfaces/dashboard-today.interface.ts`.
 *
 * Class-validator decorators are intentionally omitted: the response
 * shapes are server-controlled and never validated against user input.
 */

// ---------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------

export class DashboardCountsDto {
  @ApiProperty({ example: 7, description: 'Todos with done=false' })
  todosOpen: number;

  @ApiProperty({ example: 3, description: 'Active habits scheduled for today' })
  habitsTrackedToday: number;

  @ApiProperty({ example: 1, description: 'Habits already at >= targetCount today' })
  habitsCompletedToday: number;

  @ApiProperty({ example: 4, description: 'Schedule instances (post-RRULE expansion) for today' })
  schedulesToday: number;

  @ApiProperty({ example: 5, description: 'Notes created/updated in the last 7 days' })
  notesRecent: number;

  @ApiProperty({ example: 2, description: 'Files created/updated in the last 7 days' })
  filesRecent: number;
}

// ---------------------------------------------------------------------------
// List rows
// ---------------------------------------------------------------------------

export class DashboardOpenTodoDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: '提交周报' })
  title: string;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  dueAt: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: string;
}

export class DashboardHabitEntryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: '晨跑' })
  name: string;

  @ApiProperty({ example: '#2FAF9E' })
  color: string;

  @ApiProperty({ example: 'check' })
  icon: string;

  @ApiProperty({ enum: ['daily', 'weekdays', 'custom', 'every_n_days'] })
  frequencyType: 'daily' | 'weekdays' | 'custom' | 'every_n_days';

  @ApiProperty({ example: 1 })
  frequencyDays: number;

  @ApiProperty({ example: 1 })
  targetCount: number;

  @ApiProperty({ description: 'True iff today is a scheduled day for this habit' })
  scheduledToday: boolean;

  @ApiProperty({ description: "Sum of today's count across habit_logs" })
  todayCount: number;

  @ApiProperty({ description: 'todayCount >= targetCount' })
  todayCompleted: boolean;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  completedAt: string | null;
}

export class DashboardScheduleInstanceDto {
  @ApiProperty({ format: 'uuid' })
  scheduleId: string;

  @ApiProperty({ type: String, format: 'date-time' })
  instanceStartAt: string;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  endAt: string | null;

  @ApiProperty({ example: '团队周会' })
  title: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  description: string | null;

  @ApiProperty()
  allDay: boolean;

  @ApiProperty({ example: 'Asia/Shanghai' })
  timezone: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  location: string | null;

  @ApiProperty({ example: '#2FAF9E' })
  color: string;

  @ApiPropertyOptional({ type: [Number], nullable: true })
  reminderMinutes: number[] | null;

  @ApiProperty({ description: 'True iff an override row contributed to this instance' })
  isOverride: boolean;
}

export class DashboardNoteSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: '本周要点' })
  title: string;

  @ApiProperty({ example: '讨论了 Q3 路线图…' })
  preview: string;

  @ApiProperty({ type: [String] })
  tags: string[];

  @ApiProperty({ example: '#2FAF9E' })
  color: string;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  archivedAt: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: string;
}

export class DashboardFileSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'roadmap.pdf' })
  filename: string;

  @ApiProperty({ example: 'application/pdf' })
  contentType: string;

  @ApiProperty({ example: 184320 })
  size: number;

  @ApiProperty({ example: 'users/.../uuid.pdf' })
  ossKey: string;

  @ApiProperty()
  isImage: boolean;

  @ApiPropertyOptional({ type: Number, nullable: true })
  width: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  height: number | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  archivedAt: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

export class DashboardTodayDto {
  @ApiProperty({ type: DashboardCountsDto })
  @Type(() => DashboardCountsDto)
  counts: DashboardCountsDto;

  @ApiProperty({ type: [DashboardOpenTodoDto] })
  @Type(() => DashboardOpenTodoDto)
  openTodos: DashboardOpenTodoDto[];

  @ApiProperty({ type: [DashboardHabitEntryDto] })
  @Type(() => DashboardHabitEntryDto)
  habitsToday: DashboardHabitEntryDto[];

  @ApiProperty({ type: [DashboardScheduleInstanceDto] })
  @Type(() => DashboardScheduleInstanceDto)
  eventsToday: DashboardScheduleInstanceDto[];

  @ApiProperty({ type: [DashboardNoteSummaryDto] })
  @Type(() => DashboardNoteSummaryDto)
  recentNotes: DashboardNoteSummaryDto[];

  @ApiProperty({ type: [DashboardFileSummaryDto] })
  @Type(() => DashboardFileSummaryDto)
  recentFiles: DashboardFileSummaryDto[];

  @ApiProperty({ type: String, format: 'date-time' })
  generatedAt: string;

  @ApiProperty({ example: 'Asia/Shanghai' })
  tz: string;
}
