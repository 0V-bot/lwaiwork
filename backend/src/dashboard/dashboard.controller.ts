import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../auth/jwt.strategy';
import { DashboardService } from './dashboard.service';
import { DashboardTodayDto } from './dto/dashboard-today.dto';
import type { DashboardToday } from './interfaces/dashboard-today.interface';

/**
 * Dashboard controller.
 *
 * Single endpoint: `GET /api/dashboard/today`. JWT-protected, scoped to
 * the caller via `@CurrentUser()`. Aggregates a one-shot snapshot from
 * todos / habits / schedules / notes / files in parallel; a single
 * sub-module failure degrades to an empty section (see DashboardService).
 */
@ApiTags('dashboard')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('today')
  @ApiOperation({
    summary: 'Get my today snapshot (counts + top lists)',
    description:
      'Returns the user-scoped counts and top-N lists (open todos, today\'s ' +
      'habits, today\'s schedule instances, recent notes and files) assembled ' +
      'in parallel. Single sub-module failures degrade to empty + 0 count, ' +
      'never a 5xx for the whole response.',
  })
  @ApiOkResponse({ type: DashboardTodayDto })
  today(@CurrentUser() user: RequestUser): Promise<DashboardToday> {
    return this.dashboardService.getToday(user.userId);
  }
}
