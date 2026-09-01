import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import type { HabitFrequencyType } from '../entities/habit.entity';

const FREQUENCY_VALUES: HabitFrequencyType[] = [
  'daily',
  'weekdays',
  'custom',
  'every_n_days',
];

/**
 * All fields optional. Frequency type / counts can be updated together with
 * the name; the streak algorithm always reads the *current* values, so a
 * mid-life change to frequency correctly resets nothing - it just changes
 * which days are considered "scheduled" going forward.
 */
export class UpdateHabitDto {
  @ApiPropertyOptional({ example: '早起 (6:00 前)' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  name?: string;

  @ApiPropertyOptional({ example: '#F59E0B' })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, {
    message: 'color must match #RRGGBB',
  })
  color?: string;

  @ApiPropertyOptional({ example: 'coffee' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  icon?: string;

  @ApiPropertyOptional({ enum: FREQUENCY_VALUES })
  @IsOptional()
  @IsIn(FREQUENCY_VALUES)
  frequencyType?: HabitFrequencyType;

  @ApiPropertyOptional({ minimum: 1, maximum: 365 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  frequencyDays?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  targetCount?: number;

  @ApiPropertyOptional({
    description: 'Set to a non-null ISO timestamp to archive; null to restore.',
    type: String,
    format: 'date-time',
  })
  @IsOptional()
  archivedAt?: Date | string | null;
}
