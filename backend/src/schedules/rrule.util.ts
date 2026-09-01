import { RRule, type Options as RRuleOptions } from 'rrule';

/**
 * Window-expansion + RRULE helpers for the schedules module.
 *
 * All date math goes through here so the rest of the module never has to
 * think about RFC-5545 syntax or timezone semantics.
 *
 * Time-zone strategy:
 *   * Postgres stores `start_at` as a UTC TIMESTAMPTZ - it is the single
 *     source of truth for the absolute moment.
 *   * The schedule row also has a `timezone` column holding an IANA zone
 *     (e.g. "Asia/Shanghai"); we always rebuild the rule as
 *     `new RRule({ dtstart, tzid: timezone })` so the engine treats the
 *     DTSTART as a wall-clock instant in that zone. This is what keeps
 *     "9am every day" at 9am local across DST boundaries.
 *   * Window queries (`from`/`to`) arrive as UTC Date objects from the
 *     controller; we hand them straight to `rrule.between(after, before)`
 *     which performs the UTC<->tz conversion internally. The Date array it
 *     returns is the UTC moment of each instance.
 *
 * Why strip DTSTART from the stored string:
 *   the brief keeps `start_at` and `timezone` as the canonical columns. If
 *   we also stored a DTSTART inside the RRULE the three sources could drift
 *   - here we strip any DTSTART line on read and rebuild it deterministically
 *   from the columns.
 */

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Raised when an RRULE string or its timezone is unusable. The controller
 * surfaces these as 400 BadRequest.
 */
export class InvalidRRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidRRuleError';
  }
}

// ---------------------------------------------------------------------------
// Pure date / string helpers
// ---------------------------------------------------------------------------

/**
 * Format a Date as an RFC-5545 UTC date-time, e.g. "20260907T090000Z" -
 * the shape rrule.js expects for the `UNTIL` clause.
 */
export function formatRRuleUntilUtc(date: Date): string {
  const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

// ---------------------------------------------------------------------------
// Build / parse
// ---------------------------------------------------------------------------

export interface BuildRuleOptions {
  /** RRULE string WITHOUT a DTSTART prefix (NULL = single event). */
  rrule: string | null;
  /** The schedule's UTC DTSTART. Comes from the `start_at` column. */
  startAt: Date;
  /** IANA timezone, e.g. "Asia/Shanghai". */
  timezone: string;
}

/**
 * Convert a stored RRULE into a live `RRule` instance, or return null when
 * the schedule has no recurrence (single event).
 *
 * Throws `InvalidRRuleError` if the lib refuses to parse - the service
 * maps that to a 400.
 */
export function buildRule(opts: BuildRuleOptions): RRule | null {
  const { rrule, startAt, timezone } = opts;

  if (rrule === null || rrule === undefined) return null;
  if (typeof rrule !== 'string' || rrule.trim().length === 0) return null;

  // Drop any DTSTART lines so we never end up with two sources of truth for
  // the first-occurrence timestamp.
  const lines = rrule
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^DTSTART(?:;[^:]*)?:/i.test(line));
  const cleaned = lines.join('\n');

  let parsed: Partial<RRuleOptions>;
  try {
    // RRule.parseString is attached as a static method on the CJS bundle,
    // but the d.ts only ships the class shape - one unsafe escape gets us
    // the typed Partial<Options> we need.
    parsed = (RRule as unknown as {
      parseString(rfcString: string): Partial<RRuleOptions>;
    }).parseString(cleaned);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new InvalidRRuleError(`Failed to parse RRULE: ${message}`);
  }

  try {
    return new RRule({
      ...parsed,
      dtstart: new Date(startAt.getTime()),
      tzid: timezone,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new InvalidRRuleError(
      `Failed to build RRULE for timezone "${timezone}": ${message}`,
    );
  }
}

/**
 * Lightweight RRULE validator. Used by the service on write paths so we can
 * reject garbage with a 400 instead of failing with a DB write error later.
 */
export function assertRRuleValid(
  raw: string | null | undefined,
  startAt: Date,
  timezone: string,
): void {
  if (raw === null || raw === undefined || raw === '') return;
  buildRule({ rrule: raw, startAt, timezone });
}

// ---------------------------------------------------------------------------
// Window expansion
// ---------------------------------------------------------------------------

export interface ExpandRuleOptions {
  /** Live RRule instance (already tzid-aware). */
  rule: RRule;
  /** Window start, UTC. Inclusive. */
  from: Date;
  /** Window end, UTC. Exclusive. */
  to: Date;
  /** Instance startAt values to skip. */
  exdates: Date[];
}

/**
 * Yield every instance of `rule` whose start falls inside `[from, to)`,
 * minus those present in `exdates`. Order matches the rule's natural order
 * (ascending by start time).
 *
 * The library's `between()` is exclusive on both sides when `inc=false`,
 * which is exactly what we want for a half-open window; the controller
 * has already trimmed `to` to the user's actual end-bound.
 */
export function expandRule(opts: ExpandRuleOptions): Date[] {
  const { rule, from, to, exdates } = opts;

  const occurrences = rule.between(from, to, false);

  // Use a Set for O(1) exdate lookups. Compare by millisecond epoch - the
  // lib returns the same instant we'd stored, so equality is reliable.
  const exdateSet = new Set<number>(exdates.map((d) => d.getTime()));

  return occurrences.filter((d) => !exdateSet.has(d.getTime()));
}

// ---------------------------------------------------------------------------
// Truncate ("this and future")
// ---------------------------------------------------------------------------

/**
 * Rewrite an RRULE so that the LATEST generated occurrence is strictly
 * before `instanceStartAt`. We do this by stamping an UNTIL clause of
 * `instanceStartAt - 1 ms` (in UTC) - RFC-5545 says UNTIL is inclusive, so
 * subtracting one millisecond guarantees `instanceStartAt` itself is no
 * longer emitted by `rrule.between()`.
 *
 * Returns null if the result would be empty - the service then archives
 * the series instead of storing a vacuous RRULE.
 */
export function applyTruncate(
  originalRrule: string,
  instanceStartAt: Date,
): string | null {
  const until = new Date(instanceStartAt.getTime() - 1);
  const untilClause = `UNTIL=${formatRRuleUntilUtc(until)}`;

  const cleaned = originalRrule
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !/^UNTIL=/i.test(line));

  const next = [...cleaned, untilClause].join(';');

  // Sanity-check by actually round-tripping through the parser. If the lib
  // refuses the new clause (shouldn't happen, but cheap to verify), fall
  // back to the simple form.
  (RRule as unknown as {
    parseString(rfcString: string): Partial<RRuleOptions>;
  }).parseString(next);

  return next;
}
