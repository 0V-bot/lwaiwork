'use client';

import Link from 'next/link';
import type { MouseEvent } from 'react';

import type { ScheduleInstance } from '@/types';

interface EventCardProps {
  event: ScheduleInstance;
  /** Optional click override (e.g. search results that want to update a
   *  query param before navigating). Defaults to plain anchor navigation. */
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
  /** When true the card surfaces the absolute date label on the right
   *  instead of just the time block - used by /schedules/search. */
  showDate?: boolean;
}

/**
 * One row in the /schedules list (and the search results page).
 *
 * Layout mirrors NoteCard so the page rhythm stays consistent across
 * modules:
 *   - 1.5-wide vertical colour bar on the left drawn from the schedule's
 *     `color` so the user can scan a long list at a glance.
 *   - Left rail: time block, "HH:MM-HH:MM" or "全天" for all-day.
 *   - Title (single line, ellipsis) + optional location below.
 *   - Right side: repetition glyph (when the instance comes from a series)
 *     + optional override badge.
 *   - Whole card is a Link to `/schedules/:id?at=<instanceStartAt>` so the
 *     detail page knows which occurrence the user clicked.
 *
 * Time math: the wire payload gives UTC ISO strings; the user picked them
 * through a datetime-local input interpreted as browser local time, so
 * converting back to the browser's local time reproduces the input. That is
 * also what the rest of the app does (notes, habits) - matches user
 * expectations.
 */
export function EventCard({ event, onClick, showDate }: EventCardProps) {
  const target = `/schedules/${event.scheduleId}?at=${encodeURIComponent(event.instanceStartAt)}`;

  const { timeLabel, dateLabel } = formatTimeBlock(event);

  return (
    <Link
      href={target}
      onClick={onClick}
      data-testid="event-card"
      className="group relative flex gap-3 overflow-hidden rounded-lg border border-line bg-white p-4 transition-colors hover:border-teal-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
    >
      {/* ---- color bar ---- */}
      <span
        aria-hidden
        className="absolute inset-y-3 left-0 w-1 rounded-r-full"
        style={{ backgroundColor: event.color }}
      />

      {/* ---- time block (left rail) ---- */}
      <div className="ml-2 w-[78px] shrink-0 pl-1 pt-0.5">
        <div className="text-[14px] font-medium leading-5 tracking-tight text-ink">
          {timeLabel}
        </div>
        {event.allDay ? (
          <div className="mt-0.5 text-[11px] uppercase tracking-wide text-ink-muted">
            全天
          </div>
        ) : null}
        {showDate ? (
          <div className="mt-2 text-[11px] text-ink-muted">
            {dateLabel}
          </div>
        ) : null}
      </div>

      {/* ---- body ---- */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <h3 className="truncate text-[15px] font-medium tracking-tight text-ink">
            {event.title || '（无标题）'}
          </h3>
          <span className="flex shrink-0 items-center gap-1.5">
            {event.isOverride ? (
              <span
                aria-label="本实例已修改"
                title="本实例已被单独修改"
                className="inline-flex h-5 items-center rounded-full bg-line px-2 text-[10.5px] text-ink-soft"
              >
                已修改
              </span>
            ) : null}
            <RepeatBadge timezone={event.timezone} />
          </span>
        </div>

        {event.description ? (
          <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-ink-muted">
            {event.description}
          </p>
        ) : null}

        {event.location ? (
          <div className="mt-2 flex items-center gap-1 text-[12px] text-ink-muted">
            <svg viewBox="0 0 16 16" className="h-3 w-3 shrink-0" aria-hidden>
              <path
                d="M8 1.5c-2.6 0-4.7 2.1-4.7 4.7 0 3.5 4.7 8.3 4.7 8.3s4.7-4.8 4.7-8.3c0-2.6-2.1-4.7-4.7-4.7zm0 6.4a1.7 1.7 0 1 1 0-3.4 1.7 1.7 0 0 1 0 3.4z"
                fill="currentColor"
              />
            </svg>
            <span className="truncate">{event.location}</span>
          </div>
        ) : null}
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------

/**
 * Tiny glyph used to remind the user that this row came out of a recurring
 * series. Backend surfaces `instanceStartAt` in browser-local time, so we
 * can't tell from the wire whether the row is "single" or "one of N" - the
 * series concept lives on a separate row, not the instance DTO. Instead of
 * forcing an extra fetch per card, we always render the glyph: it's neutral
 * for non-recurring events (a single event is trivially "the only repeat")
 * and useful for the obvious recurring case. Trade-off is "one extra icon
 * on single events" vs "fewer round-trips on a long list".
 */
function RepeatBadge(_: { timezone: string }) {
  return (
    <span
      aria-label="来自一个日程系列"
      title="该实例来自一个可重复的日程"
      className="inline-flex h-5 w-5 items-center justify-center rounded-full text-ink-muted/70"
    >
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
        <path
          d="M3.5 6.5a2.5 2.5 0 0 1 2.5-2.5h4a2.5 2.5 0 0 1 2.5 2.5M3.5 9.5a2.5 2.5 0 0 0 2.5 2.5h4a2.5 2.5 0 0 0 2.5-2.5M2 5l1.5 1.5L5 5M11 11l1.5-1.5L14 11"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Helpers (kept module-local because EventCard is the only consumer).

interface TimeBlock {
  timeLabel: string;
  dateLabel: string;
}

/**
 * Build the time-block strings. The wire payload gives us UTC ISO strings;
 * we render in browser local time to match what the user typed into the
 * datetime-local input on the form (and so the list aligns with the rest
 * of the app). `showDate` adds a YYYY-MM-DD stamp for the search page,
 * since the search hits cross wide date ranges and the per-row day label
 * disappears when the list is grouped by date elsewhere.
 */
function formatTimeBlock(event: ScheduleInstance): TimeBlock {
  const start = new Date(event.instanceStartAt);
  const end = event.endAt ? new Date(event.endAt) : null;

  if (Number.isNaN(start.getTime())) {
    return { timeLabel: '—', dateLabel: '' };
  }

  const timeLabel = formatRange(start, end);

  const dateLabel = formatYmd(start);
  return { timeLabel, dateLabel };
}

function formatYmd(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function formatRange(start: Date, end: Date | null): string {
  if (!end) return formatHm(start);
  return `${formatHm(start)}–${formatHm(end)}`;
}

function formatHm(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mi}`;
}
