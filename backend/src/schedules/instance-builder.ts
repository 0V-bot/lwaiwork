import type { Schedule } from './entities/schedule.entity';
import type { ScheduleOverride } from './entities/schedule-override.entity';

/**
 * Output shape of one row from `GET /schedules?from=&to=` - what each
 * instance looks like after merging the series defaults with a
 * possibly-present override.
 *
 * The data is kept minimal on purpose: it is the column-set the calendar
 * UI needs to draw a chip per day without fetching the full series row.
 */
export interface ScheduleInstanceDto {
  scheduleId: string;
  /**
   * Final startAt for THIS instance (after the override). If the user
   * PATCHed the instance to a different day the response carries the new
   * time, not the original occurrence.
   */
  instanceStartAt: Date;
  /** Final endAt for this instance. May be omitted by an allDay series. */
  endAt?: Date | null;
  title: string;
  description?: string | null;
  allDay: boolean;
  /** IANA zone - surfaced for the UI's date math. */
  timezone: string;
  location?: string | null;
  color: string;
  reminderMinutes?: number[];
  /** True iff an override row contributed to this instance. */
  isOverride: boolean;
}

// ---------------------------------------------------------------------------
// Override lookup
// ---------------------------------------------------------------------------

/**
 * Pre-bucket overrides by original start time so the expansion loop can
 * do O(1) per-occurrence lookups instead of scanning the whole array.
 */
function indexOverrides(
  overrides: ScheduleOverride[],
): Map<number, ScheduleOverride> {
  const map = new Map<number, ScheduleOverride>();
  for (const ov of overrides) {
    map.set(ov.instanceStartAt.getTime(), ov);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

/**
 * Apply an override on top of a series row to produce one instance DTO.
 * Every override field defaults to the series value when null - that's
 * the "field-level override" UX the brief describes.
 */
function mergeIntoInstance(
  schedule: Schedule,
  occurrence: Date,
  override: ScheduleOverride | undefined,
): ScheduleInstanceDto | null {
  // Use the override's startAt only if the user actually set one;
  // null means "stay where the series put me". A truncate row carries no
  // meaning here - the caller handles it before reaching this helper.
  const finalStartAt =
    override?.startAt instanceof Date && !isNaN(override.startAt.getTime())
      ? override.startAt
      : occurrence;

  const finalTitle = override?.title ?? schedule.title;
  const finalDescription = override?.description ?? schedule.description;
  const finalEndAt =
    override?.endAt instanceof Date && !isNaN(override.endAt.getTime())
      ? override.endAt
      : schedule.endAt;
  const finalAllDay = override?.allDay ?? schedule.allDay;
  const finalLocation = override?.location ?? schedule.location;
  const finalReminders =
    override?.reminderMinutes ?? schedule.reminderMinutes;

  return {
    scheduleId: schedule.id,
    instanceStartAt: finalStartAt,
    endAt: finalEndAt,
    title: finalTitle,
    description: finalDescription,
    allDay: finalAllDay,
    timezone: schedule.timezone,
    location: finalLocation,
    color: schedule.color,
    reminderMinutes: finalReminders,
    isOverride: override !== undefined,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface BuildInstancesOptions {
  schedule: Schedule;
  /** Sorted ascending occurrence starts emitted by `expandRule`. */
  occurrences: Date[];
  /** Per-instance overrides - any not matched are silently ignored. */
  overrides: ScheduleOverride[];
  /**
   * Window bounds (UTC). Used to drop an instance whose effective start
   * was moved OUTSIDE the queried window. The original `from`/`to` from
   * the client, not the trimmed values.
   */
  windowFrom: Date;
  windowTo: Date;
}

/**
 * Walk every occurrence produced by `rrule.between`, applying overrides.
 * Stops yielding further instances after the first `truncate=true` row.
 *
 * The result is undefined-keyed-stable: occurrences are visited in the
 * order `expandRule` returned them (ascending start time), so calendar
 * UIs can stream the list day-by-day without re-sorting.
 */
export function buildInstances(
  opts: BuildInstancesOptions,
): ScheduleInstanceDto[] {
  const { schedule, occurrences, overrides, windowFrom, windowTo } = opts;

  const overrideIndex = indexOverrides(overrides);
  const windowFromMs = windowFrom.getTime();
  const windowToMs = windowTo.getTime();

  const out: ScheduleInstanceDto[] = [];

  for (const occurrence of occurrences) {
    const override = overrideIndex.get(occurrence.getTime());

    if (override && override.truncate) {
      // "This and future" tombstone. The schedule row itself has been
      // rewritten to include UNTIL=<occurrence - 1ms> by the time the GET
      // runs, so occurrences past this point normally never appear - but
      // we still guard here as a safety net (and for any race condition
      // where the GET happens between the DELETE and the rrule rewrite).
      break;
    }

    const instance = mergeIntoInstance(schedule, occurrence, override);
    if (!instance) continue;

    // If the user moved this instance to a different day, make sure that
    // moved startAt still falls inside the requested window. Otherwise the
    // caller would see a stray instance outside their query range.
    const t = instance.instanceStartAt.getTime();
    if (t < windowFromMs || t >= windowToMs) continue;

    out.push(instance);
  }

  return out;
}
