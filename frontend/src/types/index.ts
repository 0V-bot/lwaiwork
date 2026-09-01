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

// ---------------------------------------------------------------------------
// Schedules — mirrors backend/src/schedules/{service, dto, entities}.
//
// Notes are encrypted at rest with AES-256-GCM; schedules are plaintext on
// purpose (same rule as todos / habits - this app only encrypts whatever
// needs to be hidden from the row-level scan, and event titles/locations
// aren't on that list).
//
// All dates are ISO-8601 strings (JSON never revives Date). `archivedAt` is
// null for active series and an ISO string once soft-archived; soft-archive
// is the same row state manipulated by DELETE /schedules/:id.
//
// RRULE is stored WITHOUT a DTSTART prefix - the service rebinds it to
// `startAt` + `timezone` at expansion time, so a single source of truth
// for the first instance.
// ---------------------------------------------------------------------------

/** Curated 6-swatch palette mirrored on the picker UI. Must match the backend
 *  regex `/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/`. */
export const SCHEDULE_COLOR_OPTIONS = [
  '#2FAF9E',
  '#5B8DEF',
  '#F59E0B',
  '#E26D8A',
  '#8B5CF6',
  '#1D9A75',
] as const;

/** IANA timezones offered as quick-pick chips in TimezoneSelect. */
export const SCHEDULE_TIMEZONE_PRESETS = [
  'Asia/Shanghai',
  'Asia/Tokyo',
  'UTC',
  'America/Los_Angeles',
] as const;

/** Reminder offset chips (minutes BEFORE startAt). Capped server-side at 1 week. */
export const SCHEDULE_REMINDER_OPTIONS = [5, 10, 15, 30, 60] as const;

export const SCHEDULE_TITLE_MAX_LEN = 200;
/** 10 KiB; same cap as the backend DESCRIPTION_MAX_LEN. */
export const SCHEDULE_DESCRIPTION_MAX_LEN = 10_240;
export const SCHEDULE_LOCATION_MAX_LEN = 200;
/** Server caps each value at 1 week (60 * 24 * 7). */
export const SCHEDULE_REMINDER_MAX_VAL = 60 * 24 * 7;
export const SCHEDULE_REMINDER_MAX_LEN = 16;

/** Full row returned by POST /schedules, PATCH /schedules/:id, GET /schedules/:id
 *  (the latter wraps it inside `ScheduleDetail.schedule`). */
export interface Schedule {
  id: string;
  userId: string;
  title: string;
  /** Plaintext description. Null when omitted. */
  description: string | null;
  /** UTC moment. For a recurring series this is the DTSTART. */
  startAt: string;
  /** Optional end. Null = open-ended / start-only event. */
  endAt: string | null;
  /** IANA tz, e.g. "Asia/Shanghai". Required even for single events. */
  timezone: string;
  allDay: boolean;
  /** RRULE line WITHOUT a DTSTART prefix. Null = non-recurring. */
  rrule: string | null;
  /** Black-listed instance starts (UTC). Each is an ISO datetime. */
  exdates: string[];
  location: string | null;
  reminderMinutes: number[];
  /** Hex token #RGB or #RRGGBB. */
  color: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Output row from `GET /schedules?from=&to=&includeArchived=`. One row per
 *  occurrence (after override merge). Sorted ascending by `instanceStartAt`. */
export interface ScheduleInstance {
  scheduleId: string;
  /** FINAL startAt for this occurrence (post-override). */
  instanceStartAt: string;
  endAt: string | null;
  title: string;
  description: string | null;
  allDay: boolean;
  /** IANA tz surfaced for date math / UX. */
  timezone: string;
  location: string | null;
  color: string;
  reminderMinutes: number[] | null;
  isOverride: boolean;
}

/** Composite PK = (scheduleId, instanceStartAt). The `truncate = true` row is
 *  the "this and future" tombstone written by DELETE with truncate. */
export interface ScheduleOverride {
  scheduleId: string;
  instanceStartAt: string;
  title: string | null;
  description: string | null;
  startAt: string | null;
  endAt: string | null;
  allDay: boolean | null;
  location: string | null;
  reminderMinutes: number[] | null;
  truncate: boolean;
}

/** Detail projection: schedule row + ALL of its overrides. `overrides` is sorted
 *  ascending by `instanceStartAt` per the service contract. */
export interface ScheduleDetail {
  schedule: Schedule;
  overrides: ScheduleOverride[];
}

/** Create payload - mirrors CreateScheduleDto. */
export interface CreateSchedulePayload {
  title: string;
  description?: string;
  startAt: string;
  endAt?: string;
  timezone: string;
  allDay?: boolean;
  /** Null or empty string = non-recurring. */
  rrule?: string | null;
  exdates?: string[];
  location?: string;
  reminderMinutes?: number[];
  color?: string;
}

/** Patch payload - only the fields the user actually changed are sent. */
export interface UpdateSchedulePayload {
  title?: string;
  description?: string | null;
  startAt?: string;
  endAt?: string | null;
  timezone?: string;
  allDay?: boolean;
  /** Empty string or null clears the recurrence. */
  rrule?: string | null;
  exdates?: string[];
  location?: string | null;
  reminderMinutes?: number[];
  color?: string;
  /** ISO datetime to archive, or null to restore. */
  archivedAt?: string | null;
}

/** Per-instance edit payload - mirrors UpdateInstanceDto. Only non-null
 *  fields are persisted; null means "inherit series default at expansion". */
export interface UpdateInstancePayload {
  title?: string;
  description?: string | null;
  startAt?: string;
  endAt?: string | null;
  allDay?: boolean;
  location?: string | null;
  reminderMinutes?: number[];
  color?: string;
}

/** Window presets for `/schedules` secondary nav. */
export type ScheduleWindow = 'today' | '7d' | '30d';
