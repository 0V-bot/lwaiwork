import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Swagger response shape for GET /api/dashboard/analytics.
 *
 * These classes exist ONLY so Swagger picks up the response schema; the
 * actual payload is built by AnalyticsService and projected through the
 * interfaces in `../interfaces/analytics.interface.ts`. We deliberately
 * skip class-validator decorators on response DTOs (server-controlled).
 */

export class AnalyticsPointDto {
  @ApiProperty({ example: '2026-08-26', description: 'YYYY-MM-DD in the server-local timezone.' })
  date: string;

  @ApiProperty({ example: 3 })
  count: number;
}

export class AnalyticsSeriesDto {
  @ApiProperty({ type: [AnalyticsPointDto] })
  todosCompleted: AnalyticsPointDto[];

  @ApiProperty({ type: [AnalyticsPointDto] })
  habitsChecked: AnalyticsPointDto[];

  @ApiProperty({ type: [AnalyticsPointDto] })
  notesCreated: AnalyticsPointDto[];

  @ApiProperty({ type: [AnalyticsPointDto] })
  filesUploaded: AnalyticsPointDto[];

  @ApiProperty({ type: [AnalyticsPointDto] })
  schedulesFired: AnalyticsPointDto[];
}

export class AnalyticsTotalsDto {
  @ApiProperty({ example: 17 })
  todosCompleted: number;

  @ApiProperty({ example: 24 })
  habitsChecked: number;

  @ApiProperty({ example: 5 })
  notesCreated: number;

  @ApiProperty({ example: 3 })
  filesUploaded: number;

  @ApiProperty({ example: 12 })
  schedulesFired: number;
}

export class AnalyticsResponseDto {
  @ApiProperty({ enum: ['7d', '30d', '90d'] })
  range: '7d' | '30d' | '90d';

  @ApiProperty({ example: '2026-08-26' })
  startDate: string;

  @ApiProperty({ example: '2026-09-02', description: 'Exclusive end (one day after the last bucket).' })
  endDate: string;

  @ApiProperty({ example: 'Asia/Shanghai' })
  tz: string;

  @ApiProperty({ type: String, format: 'date-time' })
  generatedAt: string;

  @ApiProperty({ type: AnalyticsSeriesDto })
  series: AnalyticsSeriesDto;

  @ApiProperty({ type: AnalyticsTotalsDto })
  totals: AnalyticsTotalsDto;

  @ApiProperty({ type: String, format: 'date-time', description: 'TTL marker; cache is purely informational.' })
  cachedUntil: string;
}

// ---------------------------------------------------------------------------
// Summary DTO
// ---------------------------------------------------------------------------

export class AnalyticsSummaryTodosDto {
  @ApiProperty() total: number;
  @ApiProperty() completed: number;
  @ApiProperty() open: number;
}

export class AnalyticsSummaryHabitsDto {
  @ApiProperty() total: number;
  @ApiProperty({ description: 'Distinct days with at least one check-in.' })
  activeDays: number;
  @ApiProperty() longestStreak: number;
}

export class AnalyticsSummaryNotesDto {
  @ApiProperty() total: number;
  @ApiProperty({ description: 'Sum of content lengths (post-decryption) in characters.' })
  totalChars: number;
}

export class AnalyticsSummaryFilesDto {
  @ApiProperty() total: number;
  @ApiProperty({ description: 'Sum of file sizes in bytes.' })
  totalBytes: number;
}

export class AnalyticsSummarySchedulesDto {
  @ApiProperty() total: number;
  @ApiProperty({ description: 'Instances firing in the next 7 days (post-RRULE expansion).' })
  upcoming7d: number;
}

export class AnalyticsSummaryTotalsDto {
  @ApiProperty({ type: AnalyticsSummaryTodosDto }) todos: AnalyticsSummaryTodosDto;
  @ApiProperty({ type: AnalyticsSummaryHabitsDto }) habits: AnalyticsSummaryHabitsDto;
  @ApiProperty({ type: AnalyticsSummaryNotesDto }) notes: AnalyticsSummaryNotesDto;
  @ApiProperty({ type: AnalyticsSummaryFilesDto }) files: AnalyticsSummaryFilesDto;
  @ApiProperty({ type: AnalyticsSummarySchedulesDto }) schedules: AnalyticsSummarySchedulesDto;
}

export class AnalyticsSummaryDto {
  @ApiProperty({ type: AnalyticsSummaryTotalsDto }) totals: AnalyticsSummaryTotalsDto;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: '2025-01-15',
    description: 'Oldest row date across any module; null when the user has no data yet.',
  })
  activeSince: string | null;
}
