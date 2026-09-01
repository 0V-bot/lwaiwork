/**
 * Shared API types.
 *
 * These mirror the backend DTOs / entities exactly:
 *   backend/src/auth/dto/auth-response.dto.ts  -> User, AuthResponse
 *   backend/src/todos/todo.entity.ts           -> Todo
 *   backend/src/todos/todos.service.ts         -> Paginated<T> { data, meta }
 *
 * Dates arrive as ISO-8601 strings over the wire, hence `string` rather than
 * `Date` - JSON.parse never revives Date objects.
 */

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

/** Returned by POST /auth/register, /auth/login and /auth/refresh. */
export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  /** Always the literal string "Bearer". */
  tokenType: string;
  /** Access token lifetime in seconds (900 = 15 min). */
  expiresIn: number;
  user: User;
}

export interface Todo {
  id: string;
  userId: string;
  title: string;
  done: boolean;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  meta: PageMeta;
}

export interface MessageResponse {
  message: string;
}
