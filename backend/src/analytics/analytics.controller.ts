import {
  BadRequestException,
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../auth/jwt.strategy';

import {
  ANALYTICS_RANGES,
  AnalyticsService,
} from './analytics.service';
import {
  GetAnalyticsDto,
  assertAnalyticsRange,
} from './dto/get-analytics.dto';
import {
  AnalyticsResponseDto,
  AnalyticsSummaryDto,
} from './dto/analytics-response.dto';
import type {
  AnalyticsModule,
  AnalyticsRange,
  AnalyticsResponse,
  AnalyticsSummary,
} from './interfaces/analytics.interface';

/**
 * Analytics controller.
 *
 * Two read-only endpoints, both JWT-protected and scoped to the caller:
 *   * GET /api/dashboard/analytics?range=7d&modules=todos,habits
 *       Returns per-day time series + window totals for the selected modules.
 *       Default range = 7d. Default modules = all five.
 *   * GET /api/dashboard/analytics/summary
 *       Returns all-time totals (per-module counts / cumulative aggregates).
 *
 * All aggregation lives in AnalyticsService. The controller is a thin
 * mapper from query DTO to service call.
 */
@ApiTags('analytics')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('dashboard/analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get()
  @ApiOperation({
    summary: 'Per-day activity series for a selected range',
    description:
      'Returns five per-day series (todosCompleted / habitsChecked / ' +
      'notesCreated / filesUploaded / schedulesFired) over 7d/30d/90d, ' +
      'zero-padded by date so the front-end can plot without calendar ' +
      'math. Redis-cached per user for 5 minutes; a cache miss falls ' +
      'back to PostgreSQL. A single sub-query failure degrades to an ' +
      'empty array for that series only - the rest of the payload still ' +
      'returns 200 OK.',
  })
  @ApiOkResponse({ type: AnalyticsResponseDto })
  async getAnalytics(
    @CurrentUser() user: RequestUser,
    @Query() query: GetAnalyticsDto,
  ): Promise<AnalyticsResponse> {
    const range: AnalyticsRange = assertAnalyticsRange(query.range ?? '7d');

    // Defence-in-depth: the DTO already validates the value, but a
    // misbehaving middle proxy could still slip through. We re-check the
    // whitelist here.
    if (!(ANALYTICS_RANGES as readonly string[]).includes(range)) {
      throw new BadRequestException(
        `range must be one of: ${ANALYTICS_RANGES.join(', ')}`,
      );
    }

    const modules: AnalyticsModule[] | undefined = Array.isArray(query.modules)
      ? query.modules
      : undefined;

    return this.analytics.getAnalytics(user.userId, range, modules);
  }

  @Get('summary')
  @ApiOperation({
    summary: 'All-time totals across the five modules',
    description:
      'Cheap, uncached aggregate used by the dashboard summary tiles. ' +
      'Individual sub-queries are forgiving - a single failure degrades ' +
      'to zero counts for that module.',
  })
  @ApiOkResponse({ type: AnalyticsSummaryDto })
  async getSummary(@CurrentUser() user: RequestUser): Promise<AnalyticsSummary> {
    return this.analytics.getSummary(user.userId);
  }
}
