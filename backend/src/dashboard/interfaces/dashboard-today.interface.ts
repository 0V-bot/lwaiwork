/**
 * TypeScript types for the dashboard module.
 *
 * Mirrors the wire shape returned by `GET /api/dashboard/today` — the
 * controller does not declare DTO classes (response-only endpoint), so
 * these are the authoritative contract for the front-end.
 *
 * Notes:
 *   * `ScheduleInstance` matches the front-end `ScheduleInstance` type —
 *     we re-declare here so the dashboard service can be unit-tested
 *     without dragging in the schedules module's entity types.
 *   * Dates are serialised as ISO-8601 strings on the wire; we type them
 *     as `string | Date` to keep the in-process shape friendly to the
 *     service (which builds `Date` objects upstream) while honouring the
 *     JSON contract.
 */

export interface DashboardCounts {
  /** Number of todos with done=false. */
  todosOpen: number;
  /** Number of ACTIVE habits scheduled for today (frequencyType-aware). */
  habitsTrackedToday: number;
  /** Number of those that have a log row satisfying `count >= targetCount`. */
  habitsCompletedToday: number;
  /** Number of schedule instances (post-recurring expansion) falling in today's local window. */
  schedulesToday: number;
  /** Notes created or updated in the last 7 days. */
  notesRecent: number;
  /** Files created or updated in the last 7 days. */
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
  /** Full Habit row so the chip can render name + colour + icon. */
  id: string;
  name: string;
  color: string;
  icon: string;
  frequencyType: 'daily' | 'weekdays' | 'custom' | 'every_n_days';
  frequencyDays: number;
  targetCount: number;
  /** True iff `today` is a scheduled day for this habit. */
  scheduledToday: boolean;
  /** Sum of today's count across habit_logs. */
  todayCount: number;
  todayCompleted: boolean;
  /** ISO-8601 (created_at of today's log) or null. */
  completedAt: string | null;
}

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
  /** Server-side timestamp the snapshot was assembled at. */
  generatedAt: string;
  /** IANA timezone the snapshot was assembled in. */
  tz: string;
}
