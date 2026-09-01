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
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TodosService } from './todos.service';
import { CreateTodoDto } from './dto/create-todo.dto';
import { UpdateTodoDto } from './dto/update-todo.dto';
import { QueryTodosDto } from './dto/query-todo.dto';
import { Todo } from './todo.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { RequestUser } from '../auth/jwt.strategy';

/**
 * End-to-end verification module. All 5 endpoints are JWT protected and
 * scoped to the caller via `@CurrentUser()` - a user can only ever read or
 * mutate their own rows.
 */
@ApiTags('todos')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('todos')
export class TodosController {
  constructor(private readonly todosService: TodosService) {}

  @Get()
  @ApiOperation({ summary: 'List my todos (paginated, filterable)' })
  @ApiOkResponse({ description: 'Paginated todo list' })
  findAll(
    @CurrentUser() user: RequestUser,
    @Query() query: QueryTodosDto,
  ): ReturnType<TodosService['findAll']> {
    return this.todosService.findAll(user.userId, query);
  }

  @Post()
  @ApiOperation({ summary: 'Create a todo owned by me' })
  @ApiCreatedResponse({ type: Todo })
  create(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateTodoDto,
  ): Promise<Todo> {
    return this.todosService.create(user.userId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one of my todos' })
  @ApiOkResponse({ type: Todo })
  findOne(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<Todo> {
    return this.todosService.findOne(user.userId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Partially update one of my todos' })
  @ApiOkResponse({ type: Todo })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateTodoDto,
  ): Promise<Todo> {
    return this.todosService.update(user.userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete one of my todos' })
  @ApiOkResponse({ description: '{ "message": "Todo deleted" }' })
  remove(
    @CurrentUser() user: RequestUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): ReturnType<TodosService['remove']> {
    return this.todosService.remove(user.userId, id);
  }
}
