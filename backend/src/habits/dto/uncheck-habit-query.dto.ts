import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, Matches } from 'class-validator';

/**
 * Query string for `DELETE /habits/:id/check`. The day is required so a
 * misclick cannot wipe the entire history.
 */
export class UncheckHabitQueryDto {
  @ApiPropertyOptional({
    example: '2026-09-15',
    description: 'UTC calendar day to remove. Defaults to today (UTC).',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  @IsDateString({}, { message: 'date must be a real calendar date' })
  date?: string;
}
