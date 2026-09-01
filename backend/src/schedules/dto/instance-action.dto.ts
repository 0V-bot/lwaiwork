import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
} from 'class-validator';
import {
  COLOR_PATTERN,
  COLOR_MESSAGE,
  DESCRIPTION_MAX_LEN,
  LOCATION_MAX_LEN,
  REMINDER_MAX_LEN,
  TITLE_MAX_LEN,
} from './create-schedule.dto';

/**
 * Body for `PATCH /schedules/:id/instance`.
 *
 * Each field optional, same semantics as UpdateScheduleDto's body but
 * scoped to a single occurrence. Only non-null fields are written into
 * `schedule_overrides`; any null means "inherit series default at
 * expansion time".
 *
 * NOTE: the `instanceStartAt` identifier lives in the QUERY string, not
 * here - see InstanceQueryDto.
 */
export class UpdateInstanceDto {
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

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description: 'Override the startAt of just this instance.',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'startAt must be a valid ISO-8601 datetime' })
  startAt?: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'endAt must be a valid ISO-8601 datetime' })
  endAt?: Date;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) =>
    value === true || value === 'true' || value === 1 || value === '1',
  )
  @IsBoolean()
  allDay?: boolean;

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
}

/**
 * Query for `PATCH/DELETE /schedules/:id/instance` - identifies the
 * single occurrence AND optionally carries the `truncate` flag for the
 * "this and future" semantics on DELETE.
 */
export class InstanceQueryDto {
  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Original startAt of the instance to act on.',
  })
  @Type(() => Date)
  @IsDate({ message: 'instanceStartAt must be a valid ISO-8601 datetime' })
  instanceStartAt!: Date;

  @ApiProperty({
    required: false,
    default: false,
    description:
      'DELETE only: set true to delete the instance AND every later ' +
      'occurrence of the same series ("this and future").',
  })
  @Transform(({ value }) =>
    value === true || value === 'true' || value === 1 || value === '1',
  )
  @IsBoolean()
  truncate?: boolean = false;
}
