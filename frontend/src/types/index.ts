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

// ---------------------------------------------------------------------------
// Files — mirrors backend/src/files/{files.service.ts, dto/*.ts, entities/*}.
//
// Upload flow is three-step on purpose:
//   1. POST /files/upload-ticket  → returns a 5-min POST-policy + ossKey.
//   2. PUT  (multipart/form-data) → client PUTs bytes directly to OSS.
//   3. POST /files/confirm        → server persists the row from the OSS ETag.
//
// The backend is the source of truth for `isImage` (re-validated against the
// whitelist) so the client never has to guess at thumbnail rendering.
//
// All dates are ISO-8601 strings. `archivedAt` is null for active files
// and an ISO string once soft-archived. `downloadUrl` is short-lived
// (~5 min) and exists only on FileDetail (not FileSummary) to keep list
// payloads small.
// ---------------------------------------------------------------------------

/** Mirrors backend FILE_MAX_SIZE = 100 MiB. Used to surface the limit before
 *  the browser starts a PUT that the backend will reject. */
export const FILE_MAX_SIZE = 100 * 1024 * 1024;
/** Hard cap on original filename length (matches the backend DTO). */
export const FILE_FILENAME_MAX_LEN = 255;

/**
 * Accept-string for `<input accept="...">`. Mirrors the backend whitelist
 * (image/* + application/pdf + text/plain|csv|markdown + application/json +
 * application/zip). The backend explicitly rejects `application/octet-stream`
 * so we deliberately omit it here too.
 */
export const FILE_ACCEPT =
  'image/png,image/jpeg,image/gif,image/webp,image/svg+xml,' +
  'application/pdf,' +
  'text/plain,text/csv,text/markdown,' +
  'application/json,' +
  'application/zip';

export interface FileSummary {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  ossKey: string;
  isImage: boolean;
  /** Pixel width. Null unless isImage === true. */
  width: number | null;
  /** Pixel height. Null unless isImage === true. */
  height: number | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Detail projection returned by GET /files/:id and POST /files/confirm.
 *  Carries a short-lived signed download URL so the gallery view can render
 *  a thumbnail immediately without a follow-up GET /files/:id/download-url. */
export interface FileDetail extends FileSummary {
  /** OSS signed GET URL; valid for ~5 minutes. */
  downloadUrl: string;
  /** ISO-8601 expiry timestamp for `downloadUrl`. */
  downloadUrlExpiresAt: string;
}

/** Response shape from POST /files/upload-ticket. */
export interface UploadTicketResponse {
  /** OSS POST endpoint the client PUTs the multipart body to. */
  uploadUrl: string;
  /** Object key the client PUTs under. Echoed back to /confirm. */
  ossKey: string;
  /** ISO-8601 expiry timestamp for the POST policy. */
  expiresAt: string;
  /** Reserved UUID for the eventual row (not persisted yet). */
  fileId: string;
  /** Multipart form fields the client MUST include before the file part. */
  form: {
    key: string;
    policy: string;
    OSSAccessKeyId: string;
    signature: string;
    'x-oss-success-action-status': '200';
    'Content-Type'?: string;
  };
}

/** Request body for POST /files/upload-ticket. Mirrors backend UploadTicketDto. */
export interface RequestUploadTicketPayload {
  filename: string;
  contentType: string;
  size: number;
}

/** Request body for POST /files/confirm. Mirrors backend ConfirmUploadDto. */
export interface ConfirmUploadPayload {
  ossKey: string;
  /** ETag as returned by OSS in the PUT response, quotes included. */
  etag: string;
  size: number;
  width?: number;
  height?: number;
}

/** Query string for GET /files. Mirrors backend ListFilesDto. */
export interface ListFilesQuery {
  page?: number;
  limit?: number;
  includeArchived?: boolean;
  imagesOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Dashboard — mirrors backend/src/dashboard/{interfaces/dashboard-today.interface.ts}.
//
// GET /dashboard/today returns one aggregated snapshot. The widget count
// tiles stay cheap (single sub-queries), and the lists are bounded to
// keep the payload under ~10 KB even with a heavy backlog.
// ---------------------------------------------------------------------------

export interface DashboardCounts {
  /** Todos with done=false. */
  todosOpen: number;
  /** Active habits scheduled for today (frequencyType-aware). */
  habitsTrackedToday: number;
  /** Habits that have a log row satisfying `count >= targetCount` today. */
  habitsCompletedToday: number;
  /** Schedule instances (post-RRULE expansion) for today. */
  schedulesToday: number;
  /** Notes created/updated in the last 7 days. */
  notesRecent: number;
  /** Files created/updated in the last 7 days. */
  filesRecent: number;
}

export interface DashboardOpenTodo {
  id: string;
  title: string;
  /** ISO-8601 or null. */
  dueAt: string | null;
  createdAt: string;
}

export interface DashboardHabitEntry {
  id: string;
  name: string;
  color: string;
  icon: string;
  frequencyType: 'daily' | 'weekdays' | 'custom' | 'every_n_days';
  frequencyDays: number;
  targetCount: number;
  scheduledToday: boolean;
  todayCount: number;
  todayCompleted: boolean;
  /** ISO-8601 (created_at of today's log) or null. */
  completedAt: string | null;
}

/** Mirrors ScheduleInstance but is owned by the dashboard module so a
 *  missing exports drift in /schedules doesn't break the dashboard build. */
export interface DashboardScheduleInstance {
  scheduleId: string;
  instanceStartAt: string;
  endAt: string | null;
  title: string;
  description: string | null;
  allDay: boolean;
  timezone: string;
  location: string | null;
  color: string;
  reminderMinutes: number[] | null;
  isOverride: boolean;
}

export interface DashboardNoteSummary {
  id: string;
  title: string;
  preview: string;
  tags: string[];
  color: string;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardFileSummary {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  ossKey: string;
  isImage: boolean;
  width: number | null;
  height: number | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardToday {
  counts: DashboardCounts;
  openTodos: DashboardOpenTodo[];
  habitsToday: DashboardHabitEntry[];
  eventsToday: DashboardScheduleInstance[];
  recentNotes: DashboardNoteSummary[];
  recentFiles: DashboardFileSummary[];
  /** ISO-8601 timestamp the snapshot was assembled at. */
  generatedAt: string;
  /** IANA timezone the snapshot was assembled in (Asia/Shanghai). */
  tz: string;
}

// ---------------------------------------------------------------------------
// Analytics (M2-6) — mirrors backend/src/analytics/{interfaces, dto}.
//
// Two endpoints back the /analytics page:
//   * GET /api/dashboard/analytics?range=7d&modules=todos,habits,...
//       returns five per-day series + window totals + a `cachedUntil`
//       TTL marker. Cached server-side in Redis for 5 minutes.
//   * GET /api/dashboard/analytics/summary
//       returns all-time cumulative tiles (totals per module + the
//       oldest row date for the `active since` caption).
//
// All counts on the wire are plain `number`; no BIGINT strings. Dates
// are always ISO strings (`YYYY-MM-DD` for buckets, full ISO for
// `generatedAt` / `cachedUntil`).
// ---------------------------------------------------------------------------

export type AnalyticsRange = '7d' | '30d' | '90d';

export type AnalyticsModule =
  | 'todos'
  | 'habits'
  | 'notes'
  | 'files'
  | 'schedules';

/** One row of a per-day series. */
export interface AnalyticsPoint {
  /** YYYY-MM-DD, ascending across the array. */
  date: string;
  /** Events on that date. */
  count: number;
}

/** Five parallel series - one per metric. */
export interface AnalyticsSeries {
  todosCompleted: AnalyticsPoint[];
  habitsChecked: AnalyticsPoint[];
  notesCreated: AnalyticsPoint[];
  filesUploaded: AnalyticsPoint[];
  schedulesFired: AnalyticsPoint[];
}

/** Sums of each series over the requested window. */
export interface AnalyticsTotals {
  todosCompleted: number;
  habitsChecked: number;
  notesCreated: number;
  filesUploaded: number;
  schedulesFired: number;
}

/** Wire shape of GET /api/dashboard/analytics. */
export interface AnalyticsResponse {
  range: AnalyticsRange;
  /** Inclusive start date in server-local TZ. */
  startDate: string;
  /** Exclusive end date (one day past the last bucket). */
  endDate: string;
  /** IANA timezone the bucketing happened in. */
  tz: string;
  /** Server instant the payload was assembled at. */
  generatedAt: string;
  series: AnalyticsSeries;
  totals: AnalyticsTotals;
  /** TTL marker; the cache itself lives server-side. */
  cachedUntil: string;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export interface AnalyticsSummaryTotals {
  todos: { total: number; completed: number; open: number };
  /**
   * `longestStreak` is computed in a single SQL pass over distinct
   * `habit_logs.date` values for the user. `activeDays` is the count
   * of those distinct dates. Note: this counts the number of distinct
   * calendar days that had >=1 log row for any of the user's habits,
   * not the number of completed scheduled slots.
   */
  habits: { total: number; activeDays: number; longestStreak: number };
  /**
   * `totalChars` is the sum of `preview`-length, not the decrypted
   * content length. This avoids the master-key dependency in the
   * aggregate endpoint; the value is documented as a lower-bound
   * estimate on the dashboard.
   */
  notes: { total: number; totalChars: number };
  files: { total: number; totalBytes: number };
  /** `upcoming7d` is post-RRULE expansion for the next 7 days. */
  schedules: { total: number; upcoming7d: number };
}

/** Wire shape of GET /api/dashboard/analytics/summary. */
export interface AnalyticsSummary {
  totals: AnalyticsSummaryTotals;
  /** YYYY-MM-DD of the user's oldest row across any module, or null. */
  activeSince: string | null;
}

/** Visualisation palettes - one slot per metric, in fixed order. */
export const ANALYTICS_SERIES_COLORS = [
  'indigo-500',
  'teal-500',
  'amber-500',
  'rose-500',
  'violet-500',
] as const;

/** UI-friendly label + hex mapping for each series. */
export const ANALYTICS_SERIES_META: Record<
  keyof AnalyticsSeries,
  { label: string; hex: string; modules: AnalyticsModule[] }
> = {
  todosCompleted: { label: '待办完成', hex: '#6366F1', modules: ['todos'] },
  habitsChecked:  { label: '习惯打卡', hex: '#2FAF9E', modules: ['habits'] },
  notesCreated:   { label: '新建笔记', hex: '#F59E0B', modules: ['notes'] },
  filesUploaded:  { label: '上传文件', hex: '#E26D8A', modules: ['files'] },
  schedulesFired: { label: '日程触发', hex: '#8B5CF6', modules: ['schedules'] },
};

/** Reverse map: analytics module -> series key. */
export const ANALYTICS_MODULE_TO_SERIES: Record<AnalyticsModule, keyof AnalyticsSeries> = {
  todos: 'todosCompleted',
  habits: 'habitsChecked',
  notes: 'notesCreated',
  files: 'filesUploaded',
  schedules: 'schedulesFired',
};
