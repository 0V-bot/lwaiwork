import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export const HABIT_STATS_RANGES = ['30d', '90d', '365d'] as const;
export type HabitStatsRange = (typeof HABIT_STATS_RANGES)[number];

/**
 * Query string for `GET /habits/:id/stats`. `range` is a token, not a free
 * number, so we never have to worry about "10y" or "0d" requests.
 */
export class HabitStatsQueryDto {
  @ApiPropertyOptional({
    enum: HABIT_STATS_RANGES,
    default: '30d',
    description: 'Window of history to compute stats over.',
  })
  @IsOptional()
  @IsIn(HABIT_STATS_RANGES as unknown as string[])
  range?: HabitStatsRange;
}
