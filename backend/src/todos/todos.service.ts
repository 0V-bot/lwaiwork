import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, type FindOptionsOrder, type FindOptionsWhere } from 'typeorm';
import { Todo } from './todo.entity';
import { CreateTodoDto } from './dto/create-todo.dto';
import { UpdateTodoDto } from './dto/update-todo.dto';
import { QueryTodosDto } from './dto/query-todo.dto';

export interface Paginated<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

@Injectable()
export class TodosService {
  constructor(
    @InjectRepository(Todo)
    private readonly todos: Repository<Todo>,
  ) {}

  /**
   * SECURITY (authorisation invariant):
   * Every method below takes `userId` as its FIRST argument and folds it into
   * the WHERE clause / entity payload. There is deliberately no method that
   * accepts an id alone, so a controller cannot forget the ownership check.
   * TypeORM's `softDelete` also refuses an empty where clause, giving a second
   * line of defence against a full-table wipe.
   */
  async findAll(userId: string, query: QueryTodosDto): Promise<Paginated<Todo>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sortBy = query.sortBy ?? 'createdAt';
    const order = query.order ?? 'DESC';

    const where: FindOptionsWhere<Todo> = { userId };
    if (typeof query.done === 'boolean') {
      where.done = query.done;
    }

    // Computed key -> cast to the TypeORM order type.
    const sort = { [sortBy]: order } as FindOptionsOrder<Todo>;

    const [data, total] = await this.todos.findAndCount({
      where,
      order: sort,
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  }

  async findOne(userId: string, id: string): Promise<Todo> {
    const todo = await this.todos.findOne({ where: { id, userId } });
    if (!todo) {
      // SECURITY: 404 (not 403) - a 403 would confirm the row exists and
      // belongs to someone else, leaking information across tenants.
      throw new NotFoundException('Todo not found');
    }
    return todo;
  }

  async create(userId: string, dto: CreateTodoDto): Promise<Todo> {
    const todo = this.todos.create({
      userId, // always from the JWT, never from the request body
      title: dto.title.trim(),
      done: dto.done ?? false,
      dueAt: dto.dueAt ?? null,
    });
    return this.todos.save(todo);
  }

  async update(userId: string, id: string, dto: UpdateTodoDto): Promise<Todo> {
    const todo = await this.findOne(userId, id);

    if (dto.title !== undefined) todo.title = dto.title.trim();
    if (dto.done !== undefined) todo.done = dto.done;
    if (dto.dueAt !== undefined) todo.dueAt = dto.dueAt;

    return this.todos.save(todo);
  }

  /** Soft delete: sets deleted_at, the row stays recoverable. */
  async remove(userId: string, id: string): Promise<{ message: string }> {
    await this.findOne(userId, id);
    await this.todos.softDelete({ id, userId });
    return { message: 'Todo deleted' };
  }
}
