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
  ValidateIf,
} from 'class-validator';

/**
 * Same `#RGB` / `#RRGGBB` contract as habits / notes - keeps the colour
 * palette validators in one place across modules.
 */
export const COLOR_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
export const COLOR_MESSAGE =
  'color must be #RGB or #RRGGBB (e.g. #2FAF9E)';

/** IANA timezone id; we don't validate against the OS tz database here. */
export const IANA_TZ_PATTERN = /^[A-Za-z][A-Za-z0-9_+\-/]*$/;
export const IANA_TZ_MESSAGE =
  'timezone must look like an IANA id (e.g. Asia/Shanghai)';

export const TITLE_MAX_LEN = 200;
/** ~10 KiB; same cap family as notes' CONTENT_MAX_BYTES. */
export const DESCRIPTION_MAX_LEN = 10_240;

export const LOCATION_MAX_LEN = 200;
/** Generous upper bound; client picks sensible values. */
export const REMINDER_MAX_LEN = 16;
export const REMINDER_VALUE_MAX_MIN = 60 * 24 * 7; // 1 week
export const EXDATE_MAX_LEN = 365;

/**
 * Loose RRULE form-check: must start with FREQ= and contain nothing
 * dangerous (newlines from header injection, semicolons outside of pair
 * separators). Anything stricter should be done by the rrule parser.
 */
export const RRULE_LOOSE = /^[A-Za-z0-9;=\-,.+\s]+$/;
export const RRULE_MESSAGE =
  'rrule must be a plain RRULE line (e.g. "FREQ=DAILY;COUNT=5")';

export class CreateScheduleDto {
  @ApiProperty({ minLength: 1, maxLength: TITLE_MAX_LEN, example: '每周一代码 review' })
  @IsString()
  @MinLength(1, { message: 'title must not be empty' })
  @MaxLength(TITLE_MAX_LEN)
  title!: string;

  @ApiPropertyOptional({
    maxLength: DESCRIPTION_MAX_LEN,
    example: '同步本周工作清单 + 风险项',
  })
  @IsOptional()
  @IsString()
  @MaxLength(DESCRIPTION_MAX_LEN)
  description?: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-09-07T09:00:00.000Z',
    description:
      'ISO-8601 datetime. Stored as TIMESTAMPTZ (UTC). For a recurring ' +
      'event this is the DTSTART - the first instance starts here.',
  })
  @Type(() => Date)
  @IsDate({ message: 'startAt must be a valid ISO-8601 datetime' })
  startAt!: Date;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    example: '2026-09-07T10:00:00.000Z',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate({ message: 'endAt must be a valid ISO-8601 datetime' })
  endAt?: Date;

  @ApiProperty({ example: 'Asia/Shanghai', description: 'IANA timezone id' })
  @IsString()
  @Matches(IANA_TZ_PATTERN, { message: IANA_TZ_MESSAGE })
  timezone!: string;

  @ApiPropertyOptional({ default: false, example: false })
  @IsOptional()
  @Transform(({ value }) =>
    value === true || value === 'true' || value === 1 || value === '1',
  )
  @IsBoolean()
  allDay?: boolean = false;

  @ApiPropertyOptional({
    nullable: true,
    example: 'FREQ=DAILY;COUNT=5',
    description:
      'RRULE line WITHOUT a DTSTART prefix (we inject it from `startAt`). ' +
      'NULL = single (non-recurring) event.',
  })
  @IsOptional()
  @ValidateIf((o: CreateScheduleDto) => o.rrule !== null && o.rrule !== '')
  @IsString()
  @Matches(RRULE_LOOSE, { message: RRULE_MESSAGE })
  rrule?: string | null;

  @ApiPropertyOptional({
    type: [String],
    format: 'date-time',
    description:
      'Optional list of instance starts to skip (black-list). Each value ' +
      'must be an ISO datetime. Capped at 365 entries.',
    example: ['2026-09-14T09:00:00.000Z'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(EXDATE_MAX_LEN)
  @Type(() => Date)
  @IsDate({ each: true, message: 'each exdate must be a valid ISO datetime' })
  exdates?: Date[];

  @ApiPropertyOptional({ maxLength: LOCATION_MAX_LEN, example: '会议室 A' })
  @IsOptional()
  @IsString()
  @MaxLength(LOCATION_MAX_LEN)
  location?: string;

  @ApiPropertyOptional({
    type: [Number],
    description:
      'Reminder offsets in minutes BEFORE `startAt`. e.g. [15, 60] = ' +
      'notify 15 min and 60 min before each instance. Capped per-instance; ' +
      'per-value capped at 1 week.',
    example: [15, 60],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(REMINDER_MAX_LEN)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Type(() => Number)
  reminderMinutes?: number[];

  @ApiPropertyOptional({
    example: '#2FAF9E',
    default: '#2FAF9E',
    description: 'UI palette token. Accepts #RGB or #RRGGBB.',
  })
  @IsOptional()
  @IsString()
  @Matches(COLOR_PATTERN, { message: COLOR_MESSAGE })
  color?: string;
}
