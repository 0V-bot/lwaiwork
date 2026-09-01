import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  COLOR_MESSAGE,
  COLOR_PATTERN,
  DESCRIPTION_MAX_LEN,
  EXDATE_MAX_LEN,
  IANA_TZ_MESSAGE,
  IANA_TZ_PATTERN,
  LOCATION_MAX_LEN,
  REMINDER_MAX_LEN,
  RRULE_MESSAGE,
  RRULE_LOOSE,
  TITLE_MAX_LEN,
} from './create-schedule.dto';

/**
 * Partial-update payload. Every field is optional; null is treated as
 * "leave alone" unless the DTO validator explicitly says a null clears
 * the column (we don't currently expose that - clear semantics live on
 * the `archivedAt` field only).
 *
 * Same validator set as Create so the two DTOs can't drift on field
 * constraints - we re-export the constants from create.
 */
export class UpdateScheduleDto {
  @ApiPropertyOptional({ maxLength: TITLE_MAX_LEN })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(TITLE_MAX_LEN)
  title?: string;

  @ApiPropertyOptional({ maxLength: DESCRIPTION_MAX_LEN })
  @IsOptional()
  @IsString()
  @MaxLength(DESCRIPTION_MAX_LEN)
  description?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'startAt must be a valid ISO-8601 datetime' })
  startAt?: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'endAt must be a valid ISO-8601 datetime' })
  endAt?: Date;

  @ApiPropertyOptional({ description: 'IANA timezone id' })
  @IsOptional()
  @IsString()
  @Matches(IANA_TZ_PATTERN, { message: IANA_TZ_MESSAGE })
  timezone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) =>
    value === true || value === 'true' || value === 1 || value === '1',
  )
  @IsBoolean()
  allDay?: boolean;

  @ApiPropertyOptional({
    description:
      'RRULE line without DTSTART. Pass an empty string or null to clear ' +
      'the recurrence (convert to a one-off event).',
  })
  @IsOptional()
  @ValidateIf((o: UpdateScheduleDto) => o.rrule !== null && o.rrule !== '')
  @IsString()
  @Matches(RRULE_LOOSE, { message: RRULE_MESSAGE })
  rrule?: string | null;

  @ApiPropertyOptional({
    type: [String],
    format: 'date-time',
    description:
      'Replace the exdate blacklist wholesale. Omit the field to leave it ' +
      'alone; send [] to clear.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(EXDATE_MAX_LEN)
  @Type(() => Date)
  @IsDate({ each: true, message: 'each exdate must be a valid ISO datetime' })
  exdates?: Date[];

  @ApiPropertyOptional({ maxLength: LOCATION_MAX_LEN })
  @IsOptional()
  @IsString()
  @MaxLength(LOCATION_MAX_LEN)
  location?: string;

  @ApiPropertyOptional({ type: [Number] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(REMINDER_MAX_LEN)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Type(() => Number)
  reminderMinutes?: number[];

  @ApiPropertyOptional({ description: 'UI palette token (#RGB or #RRGGBB).' })
  @IsOptional()
  @IsString()
  @Matches(COLOR_PATTERN, { message: COLOR_MESSAGE })
  color?: string;

  @ApiPropertyOptional({
    description:
      'Set to a non-null ISO datetime to archive the series, or null to ' +
      'restore it. Mirrors the same tri-state pattern used by notes.',
  })
  @IsOptional()
  archivedAt?: Date | string | null;
}
