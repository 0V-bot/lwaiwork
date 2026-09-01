import { BadRequestException } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
} from 'class-validator';

import {
  ALL_ANALYTICS_MODULES,
  type AnalyticsModule,
  type AnalyticsRange,
} from '../interfaces/analytics.interface';

/**
 * Query string for `GET /api/dashboard/analytics`.
 *
 * `range` defaults to '7d' on the controller side (Nest will inject `undefined`
 * for omitted values). `modules` is optional; when absent the service treats
 * it as "all modules". We accept comma-separated values for symmetry with the
 * documented wire format (`modules=todos,habits`).
 */

const RANGE_VALUES: AnalyticsRange[] = ['7d', '30d', '90d'];
const MODULE_VALUES = ALL_ANALYTICS_MODULES as readonly AnalyticsModule[];

export class GetAnalyticsDto {
  @IsOptional()
  @IsIn(RANGE_VALUES, {
    message: `range must be one of: ${RANGE_VALUES.join(', ')}`,
  })
  range?: AnalyticsRange;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MODULE_VALUES.length)
  @IsString({ each: true })
  @IsEnum(MODULE_VALUES, { each: true, message: 'each module name must be valid' })
  @Transform(({ value }: { value: unknown }) => normaliseModules(value))
  modules?: AnalyticsModule[];
}

/**
 * Parse the `modules` query value, which the frontend sends as a
 * comma-separated string (`modules=todos,habits`). Without normalisation
 * we'd silently accept an empty array if the user lands on the page
 * cold; with it we always either parse a proper list or omit the field.
 */
function normaliseModules(value: unknown): AnalyticsModule[] | undefined {
  if (Array.isArray(value)) {
    // Already an array (e.g. `?modules=todos&modules=habits`). Filter empties.
    const cleaned = value
      .map((v) => (typeof v === 'string' ? v.trim() : ''))
      .filter((v): v is AnalyticsModule =>
        (MODULE_VALUES as readonly string[]).includes(v),
      );
    return cleaned.length === 0 ? undefined : cleaned;
  }
  if (typeof value !== 'string') return undefined;
  const parts = value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const valid = parts.filter((p): p is AnalyticsModule =>
    (MODULE_VALUES as readonly string[]).includes(p),
  );
  if (valid.length === 0) {
    // Treat empty / garbage as "no modules filter" instead of an error -
    // the dashboard defaults to "all modules" anyway. Without this the
    // front-end would 400 on `?modules=` blank-ish values.
    return undefined;
  }
  // De-dup while preserving order so downstream Set/array math stays
  // deterministic.
  return Array.from(new Set(valid));
}

/** Convenience assertion used by the service after DTO normalisation. */
export function assertAnalyticsRange(input: unknown): AnalyticsRange {
  if (typeof input === 'string' && (RANGE_VALUES as readonly string[]).includes(input)) {
    return input as AnalyticsRange;
  }
  throw new BadRequestException('range must be one of: ' + RANGE_VALUES.join(', '));
}
