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

// ---------------------------------------------------------------------------
// Habits — mirrors backend/src/habits/{habits.service.ts, entities/*}.
// `archivedAt` may arrive as null (active) or an ISO string. JSON never
// revives Date objects, so createdAt / updatedAt / archivedAt are `string`.
// ---------------------------------------------------------------------------

export type HabitFrequencyType = 'daily' | 'weekdays' | 'custom' | 'every_n_days';
export type HabitStatsRange = '30d' | '90d' | '365d';

export interface Habit {
  id: string;
  userId: string;
  name: string;
  /** Hex #RRGGBB token, defaults to '#2FAF9E'. */
  color: string;
  /** Free-form emoji or icon name (e.g. 'check', '☕'). */
  icon: string;
  frequencyType: HabitFrequencyType;
  frequencyDays: number;
  targetCount: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Returned by GET /habits and most /habits/:id endpoints. */
export interface HabitWithToday extends Habit {
  /** Sum of today's count across habit_logs. 0 if no log row yet. */
  todayCount: number;
  todayCompleted: boolean;
}

export interface HeatmapPoint {
  /** UTC date in YYYY-MM-DD. */
  date: string;
  /** Sum of count for that day. */
  count: number;
  /** count >= habit.targetCount. */
  completed: boolean;
}

export interface HabitStats {
  habitId: string;
  range: HabitStatsRange;
  rangeStart: string;
  rangeEnd: string;
  totalCheckins: number;
  scheduledDays: number;
  checkedScheduledDays: number;
  /** Rounded to 4 dp. 0 when scheduledDays === 0. */
  completionRate: number;
  currentStreak: number;
  longestStreak: number;
  /** One entry per day in [rangeStart, rangeEnd]; count=0 included. */
  heatmap: HeatmapPoint[];
}

export interface OverallStats {
  totalHabits: number;
  activeHabits: number;
  archivedHabits: number;
  todayCompleted: number;
  todayPending: number;
  weekCompletionRate: number;
}

export interface HabitLog {
  id: string;
  userId: string;
  habitId: string;
  date: string;
  count: number;
  note: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Notes — mirrors backend/src/notes/{notes.service.ts, dto/*.ts, entities/*}.
//
// Notes are encrypted at rest with AES-256-GCM (see backend crypto-aes-gcm).
// The list / search responses omit the body to keep payloads small; only the
// previews are exposed. Full body comes through GET /notes/:id. From the
// front-end's point of view everything is plaintext — no key material lives
// in the browser.
//
// All dates are ISO-8601 strings (JSON never revives Date). `archivedAt`
// is null for active notes and an ISO string once soft-archived; soft-archive
// is the same row state manipulated by DELETE /notes/:id.
// ---------------------------------------------------------------------------

/** Curated 6-swatch palette mirrored on the picker UI. Must match the backend
 *  regex `/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/`. */
export const NOTE_COLOR_OPTIONS = [
  '#2FAF9E',
  '#5B8DEF',
  '#F59E0B',
  '#E26D8A',
  '#8B5CF6',
  '#1D9A75',
] as const;

export const NOTE_TAGS_MAX = 32;
export const NOTE_TAG_MAX_LEN = 32;
/** 50 KiB UTF-8 hard cap enforced by the backend. */
export const NOTE_CONTENT_MAX_BYTES = 50 * 1024;
export const NOTE_TITLE_MAX_LEN = 200;

/** List-row projection returned by GET /notes and POST /notes/search.
 *  No `content` field on purpose - the frontend never renders the full body
 *  from a list call. */
export interface NoteSummary {
  id: string;
  title: string;
  preview: string;
  tags: string[];
  /** Hex #RGB or #RRGGBB (see NOTE_COLOR_OPTIONS for the curated values). */
  color: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Detail projection returned by GET /notes/:id and the create / update flows. */
export interface NoteDetail extends NoteSummary {
  content: string;
}

/** Create payload - mirrors backend CreateNoteDto. */
export interface CreateNotePayload {
  title: string;
  content: string;
  tags?: string[];
  color?: string;
}

/** Patch payload - every field optional; only the fields present are sent to
 *  PATCH /notes/:id so the backend re-encrypts only what changed. */
export type UpdateNotePayload = Partial<CreateNotePayload>;

/** Search payload - mirrors backend SearchNoteDto. */
export interface SearchNotePayload {
  query: string;
  tag?: string;
}
