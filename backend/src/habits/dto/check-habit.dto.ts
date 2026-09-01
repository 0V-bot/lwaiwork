import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Max,
  Min,
} from 'class-validator';

/**
 * Body of `POST /habits/:id/check`. All fields optional - missing ones are
 * defaulted by the service (today, count=1, no note). Repeat check-ins on the
 * same day *increment* the count rather than insert a second row, because
 * habit_logs has a UNIQUE(habitId, date) constraint.
 */
export class CheckHabitDto {
  @ApiPropertyOptional({
    example: '2026-09-15',
    description:
      'UTC calendar day, YYYY-MM-DD. Defaults to today (UTC). Past days ' +
      'are allowed for back-filling missed check-ins.',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  @IsDateString({}, { message: 'date must be a real calendar date' })
  date?: string;

  @ApiPropertyOptional({
    example: 1,
    minimum: 1,
    maximum: 100,
    description:
      'How many units this check-in adds. Defaults to 1. Habit completion ' +
      'requires `sum(count) >= habit.targetCount` for the day.',
    default: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  count?: number;

  @ApiPropertyOptional({
    example: 'felt great',
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string;
}
