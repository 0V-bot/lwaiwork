import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDate } from 'class-validator';

/**
 * Query string for `GET /schedules`.
 *
 * Required window: `from` and `to` are inclusive ISO datetimes interpreted
 * as UTC. The service calls `rrule.between(from, to, false)` with these,
 * so any instance whose start falls in `[from, to)` is returned.
 *
 * `includeArchived` defaults to false; archived series are skipped by the
 * window expansion just like a hard delete would.
 */
export class QuerySchedulesDto {
  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-09-01T00:00:00.000Z',
    description: 'Window start (inclusive), UTC.',
  })
  @Type(() => Date)
  @IsDate({ message: 'from must be a valid ISO-8601 datetime' })
  from!: Date;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-12-31T00:00:00.000Z',
    description:
      'Window end (EXCLUSIVE on the rrule side, treated as a half-open ' +
      'interval internally). To capture the last day of the month, pass ' +
      'the FIRST second of the NEXT day as `to`.',
  })
  @Type(() => Date)
  @IsDate({ message: 'to must be a valid ISO-8601 datetime' })
  to!: Date;

  @ApiProperty({
    default: false,
    example: false,
    description: 'Set true to also expand archived series.',
  })
  @Transform(({ value }) =>
    value === true || value === 'true' || value === 1 || value === '1',
  )
  @IsBoolean()
  includeArchived: boolean = false;
}
