import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../auth/jwt.strategy';
import { CreateHabitDto } from './dto/create-habit.dto';
import { UpdateHabitDto } from './dto/update-habit.dto';
import { CheckHabitDto } from './dto/check-habit.dto';
import { UncheckHabitQueryDto } from './dto/uncheck-habit-query.dto';
import { HabitStatsQueryDto, HABIT_STATS_RANGES } from './dto/habit-stats-query.dto';
import {
  HabitsService,
  type HabitStats,
  type HabitWithToday,
  type OverallStats,
} from './habits.service';
import { HabitLog } from './entities/habit-log.entity';
import { utcToday } from './habit-date.util';

/**
 * Habit tracker module. Every endpoint is JWT-protected and scoped to the
 * caller - a user can only see or mutate their own habits, matching the
 * pattern from TodosController.
 */
@ApiTags('habits')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('habits')
export class HabitsController {
  constructor(private readonly habitsService: HabitsService) {}

  /** Order matters: literal segments before parametric ones. */
  // ---------------------------------------------------------------- aggregate
  @Get('stats')
  @ApiOperation({
    summary: 'Overall stats across all of my habits (today + last 7 days)',
  })
  @ApiOkResponse({
    description:
      'Counts active habits, today completed/pending and a 7-day completion rate',
  })
  getOverall(@CurrentUser() user: RequestUser): Promise<OverallStats> {
    return this.habitsService.getOverallStats(user.userId);
  }

  // ---------------------------------------------------------------- list / create
  @Get()
  @ApiOperation({ summary: 'List my active habits (today check-in included)' })
  @ApiOkResponse({ description: 'Array of habits with `todayCompleted` flag' })
  findAll(@CurrentUser() user: RequestUser): Promise<HabitWithToday[]> {
    return this.habitsService.findAll(user.userId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a habit owned by me' })
  @ApiCreatedResponse({ description: 'The new habit with `todayCompleted=false`' })
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateHabitDto,
  ): Promise<HabitWithToday> {
    return this.habitsService.create(user.userId, dto);
  }

  // ---------------------------------------------------------------- per-habit
  @Get(':id')
  @ApiOperation({ summary: 'Get one of my habits' })
  @ApiOkResponse({ description: 'The habit with `todayCompleted` flag' })
  findOne(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<HabitWithToday> {
    return this.habitsService.findOne(user.userId, id);
  }

  @Get(':id/stats')
  @ApiOperation({
    summary: 'Stats for one habit: streak, completion rate, daily heatmap',
  })
  @ApiOkResponse({
    description:
      'Streak numbers plus an array of {date, count, completed} for every day in the range',
  })
  getStats(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() query: HabitStatsQueryDto,
  ): Promise<HabitStats> {
    return this.habitsService.getStats(
      user.userId,
      id,
      query.range ?? '30d',
    );
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Partially update one of my habits' })
  @ApiOkResponse({ description: 'Updated habit with `todayCompleted` flag' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateHabitDto,
  ): Promise<HabitWithToday> {
    return this.habitsService.update(user.userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-archive one of my habits' })
  @ApiOkResponse({ description: '{ "message": "Habit archived" }' })
  archive(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<{ message: string }> {
    return this.habitsService.archive(user.userId, id);
  }

  // ---------------------------------------------------------------- check-in
  @Post(':id/check')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Check in for a day (idempotent per date; increments count)',
  })
  @ApiCreatedResponse({ type: HabitLog })
  @ApiOkResponse({ description: 'Returns the upserted habit_log row' })
  check(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: CheckHabitDto,
  ): Promise<HabitLog> {
    return this.habitsService.check(user.userId, id, dto);
  }

  @Delete(':id/check')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel today\u2019s check-in (or another day via ?date=YYYY-MM-DD)',
  })
  @ApiOkResponse({
    description:
      '{ "message": "Check-in removed" } or { "message": "No check-in to remove" }',
  })
  uncheck(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() query: UncheckHabitQueryDto,
  ): Promise<{ message: string }> {
    return this.habitsService.uncheck(user.userId, id, query.date ?? utcToday());
  }
}

// Reference the constant so ts-loader keeps it referenced for Swagger pick-up.
void HABIT_STATS_RANGES;
