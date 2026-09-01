import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

export class CreateHabitDto {
  @ApiProperty({ example: '早起', minLength: 1, maxLength: 64 })
  @IsString()
  @MinLength(1, { message: 'name must not be empty' })
  @MaxLength(64, { message: 'name must be at most 64 characters' })
  name: string;

  @ApiPropertyOptional({
    example: '#2FAF9E',
    description: 'Hex color token (#RRGGBB). Defaults to teal.',
    default: '#2FAF9E',
  })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, {
    message: 'color must match #RRGGBB (e.g. #2FAF9E)',
  })
  color?: string;

  @ApiPropertyOptional({
    example: 'sun',
    description: 'Emoji or icon name. Defaults to "check".',
    default: 'check',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  icon?: string;

  @ApiPropertyOptional({
    enum: FREQUENCY_VALUES,
    default: 'daily',
    description: 'Schedule type. Determines which days are "scheduled".',
  })
  @IsOptional()
  @IsIn(FREQUENCY_VALUES, {
    message: `frequencyType must be one of: ${FREQUENCY_VALUES.join(', ')}`,
  })
  frequencyType?: HabitFrequencyType;

  @ApiPropertyOptional({
    example: 3,
    minimum: 1,
    maximum: 365,
    description: 'Used only when frequencyType="every_n_days". Defaults to 1.',
    default: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  frequencyDays?: number;

  @ApiPropertyOptional({
    example: 1,
    minimum: 1,
    maximum: 100,
    description: 'Required check-ins per scheduled day. Defaults to 1.',
    default: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  targetCount?: number;
}
