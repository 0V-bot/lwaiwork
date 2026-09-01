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
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../auth/jwt.strategy';
import { CreateScheduleDto } from './dto/create-schedule.dto';
import { UpdateScheduleDto } from './dto/update-schedule.dto';
import { QuerySchedulesDto } from './dto/query-schedules.dto';
import { InstanceQueryDto, UpdateInstanceDto } from './dto/instance-action.dto';
import {
  SchedulesService,
  type ScheduleDetail,
} from './schedules.service';
import { Schedule } from './entities/schedule.entity';
import { ScheduleOverride } from './entities/schedule-override.entity';
import type { ScheduleInstanceDto } from './instance-builder';

/**
 * Schedule module. Every endpoint is JWT-protected and the userId always
 * comes from the validated principal (`@CurrentUser()`) - the DTOs accept
 * no userId field, so a client cannot read or mutate another tenant's rows.
 *
 * Route ordering: `/schedules` paths with literal segments would shadow
 * `:id`, so every parametric route is keyed under `/schedules/:id/...` and
 * the literal `/` is fine here because there's no GET-with-literal segment.
 */
@ApiTags('schedules')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('schedules')
export class SchedulesController {
  constructor(private readonly schedulesService: SchedulesService) {}

  // ---------------------------------------------------------------- list / create
  @Get()
  @ApiOperation({
    summary: 'Expand my schedules into instances inside [from, to)',
    description:
      'Returns one row per occurrence - including per-instance overrides - ' +
      'sorted ascending by startAt. Archived series are hidden by default.',
  })
  @ApiOkResponse({ description: 'Array of instance rows.' })
  list(
    @CurrentUser() user: RequestUser,
    @Query() query: QuerySchedulesDto,
  ): Promise<ScheduleInstanceDto[]> {
    return this.schedulesService.listWindow(
      user.userId,
      query.from,
      query.to,
      query.includeArchived,
    );
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a schedule (single or recurring)',
    description:
      'Pass an RRULE (without DTSTART) to make the event recurring; omit ' +
      'it for a one-off. We validate the RRULE + timezone eagerly so a ' +
      'typo surfaces as 400 instead of a 500 on the next expand.',
  })
  @ApiCreatedResponse({ type: Schedule })
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateScheduleDto,
  ): Promise<Schedule> {
    return this.schedulesService.create(user.userId, dto);
  }

  // ---------------------------------------------------------------- per-schedule
  @Get(':id')
  @ApiOperation({
    summary: 'Get a schedule with its per-instance overrides',
  })
  @ApiOkResponse({ description: 'Schedule + override rows.' })
  @ApiNotFoundResponse({
    description: 'Schedule not found, or the row belongs to someone else.',
  })
  findOne(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<ScheduleDetail> {
    return this.schedulesService.findOne(user.userId, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update the series (affects every NON-overridden instance)',
    description:
      'PATCH on the series leaves existing overrides intact - they take ' +
      'precedence at expansion time.',
  })
  @ApiOkResponse({ description: 'Updated schedule row.' })
  @ApiNotFoundResponse({ description: 'Schedule not found.' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateScheduleDto,
  ): Promise<Schedule> {
    return this.schedulesService.update(user.userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Soft-archive a schedule (idempotent)',
    description:
      'Sets `archivedAt = now()` instead of deleting the row. Re-archiving ' +
      'an already-archived row is a no-op success.',
  })
  @ApiOkResponse({ description: '{ "message": "Schedule archived" }' })
  archive(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<{ message: string }> {
    return this.schedulesService.archive(user.userId, id);
  }

  // ---------------------------------------------------------------- per-instance
  @Patch(':id/instance')
  @ApiOperation({
    summary: 'Edit ONE occurrence (write a schedule_override row)',
    description:
      '`instanceStartAt` in the query is the ORIGINAL occurrence time of ' +
      'the target instance (the row keyed by the calendar). Unspecified ' +
      'fields inherit the series default at expansion time.',
  })
  @ApiOkResponse({ type: ScheduleOverride })
  patchInstance(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() query: InstanceQueryDto,
    @Body() dto: UpdateInstanceDto,
  ): Promise<ScheduleOverride> {
    return this.schedulesService.patchInstance(
      user.userId,
      id,
      query.instanceStartAt,
      dto,
    );
  }

  @Delete(':id/instance')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete ONE occurrence (or "this and future" with truncate=true)',
    description:
      'Default behaviour: push `instanceStartAt` onto the series exdate ' +
      'blacklist. With `truncate=true`: rewrite the RRULE so that no ' +
      'future occurrence is emitted, and write a tombstone override so ' +
      'later series edits cannot accidentally re-enable them.',
  })
  @ApiOkResponse({
    description:
      '{ "message": "Instance deleted" } / "Truncated at instance" / ' +
      '"Schedule archived"',
  })
  removeInstance(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query() query: InstanceQueryDto,
  ): Promise<{ message: string }> {
    return this.schedulesService.deleteInstance(
      user.userId,
      id,
      query.instanceStartAt,
      query.truncate === true,
    );
  }
}
