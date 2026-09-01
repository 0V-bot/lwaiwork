'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { EventCard } from '@/components/EventCard';
import { api, toErrorMessage } from '@/lib/api';
import type { ScheduleInstance, ScheduleWindow } from '@/types';

/**
 * /schedules — window-expanded list.
 *
 * URL contract:
 *   ?window=today|7d|30d        secondary nav (defaults to 30d)
 *
 * Wire: `GET /schedules?from=<iso>&to=<iso>&includeArchived=false`. The
 * service expands every owned series into instances inside [from, to) and
 * returns one row per occurrence after per-instance overrides merge.
 *
 * We hit it with the window in BROWSER LOCAL time (today's local midnight
 * -> today+N's local midnight). Events the user created in another tz show
 * up correctly because the backend's rrule.between() does the UTC<->tz
 * conversion internally.
 *
 * `instanceStartAt` in each row is the FINAL post-merge moment - we render
 * it as a date header + time block per occurrence.
 */

// ---------------------------------------------------------------------------
// Window presets. Keep these in lock-step with ScheduleWindow in types.
// ---------------------------------------------------------------------------

const WINDOW_OPTIONS: { value: ScheduleWindow; label: string; days: number }[] =
  [
    { value: 'today', label: '今天', days: 1 },
    { value: '7d', label: '7 天', days: 7 },
    { value: '30d', label: '30 天', days: 30 },
  ];

function readWindow(params: URLSearchParams): ScheduleWindow {
  const raw = params.get('window');
  if (raw === 'today' || raw === '7d' || raw === '30d') return raw;
  return '30d';
}

/**
 * Build a [from, to) Date pair for the given window in the BROWSER's local
 * timezone. The wire format is ISO-8601 UTC (which is what JSON serializes
 * Date.toJSON() to), so the backend receives UTC and the rrule engine
 * converts internally back to each schedule's tzid.
 */
function windowBounds(window: ScheduleWindow): { from: Date; to: Date } {
  const preset = WINDOW_OPTIONS.find((w) => w.value === window)!;
  const now = new Date();
  const fromLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const toLocal = new Date(
    fromLocal.getTime() + preset.days * 24 * 60 * 60 * 1000,
  );
  return { from: fromLocal, to: toLocal };
}

// ---------------------------------------------------------------------------
// Date grouping helpers.
// ---------------------------------------------------------------------------

interface DayGroup {
  /** Heading shown above the rows ("今天" / "明天" / "YYYY-MM-DD"). */
  heading: string;
  /** Stable key for React. */
  key: string;
  rows: ScheduleInstance[];
}

/** Group by the BROWSER-local calendar day of each row's start. */
function groupByDay(rows: ScheduleInstance[]): DayGroup[] {
  const groups: DayGroup[] = [];
  const index = new Map<string, DayGroup>();

  for (const row of rows) {
    const start = new Date(row.instanceStartAt);
    const dayStart = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate(),
    );
    const key = String(dayStart.getTime());

    let group = index.get(key);
    if (!group) {
      const heading = formatDayHeading(dayStart);
      group = { heading, key, rows: [] };
      index.set(key, group);
      groups.push(group);
    }
    group.rows.push(row);
  }
  return groups;
}

function formatDayHeading(day: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  if (day.getTime() === today.getTime()) return '今天';
  if (day.getTime() === tomorrow.getTime()) return '明天';

  const yyyy = day.getFullYear();
  const mm = String(day.getMonth() + 1).padStart(2, '0');
  const dd = String(day.getDate()).padStart(2, '0');
  const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const w = weekdays[day.getDay()];
  return `${yyyy}-${mm}-${dd} · ${w}`;
}

// ---------------------------------------------------------------------------

export default function SchedulesListPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const windowPreset = readWindow(searchParams);

  const [rows, setRows] = useState<ScheduleInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search input is local; submit routes to /schedules/search?q=...
  const [queryDraft, setQueryDraft] = useState('');
  const [searchSubmitting, setSearchSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const bounds = windowBounds(windowPreset);
      const list = await api.get<ScheduleInstance[]>('/schedules', {
        query: {
          from: bounds.from.toISOString(),
          to: bounds.to.toISOString(),
          includeArchived: false,
        },
      });
      setRows(list);
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [windowPreset]);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => groupByDay(rows), [rows]);

  function handleWindowChange(next: ScheduleWindow) {
    if (next === windowPreset) return;
    const params = new URLSearchParams();
    if (next !== '30d') params.set('window', next);
    const qs = params.toString();
    router.push(qs ? `/schedules?${qs}` : '/schedules');
  }

  function handleSearchSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = queryDraft.trim();
    if (!q || searchSubmitting) return;
    setSearchSubmitting(true);
    router.push(`/schedules/search?q=${encodeURIComponent(q)}`);
  }

  return (
    <div>
      {/* ------------------------------------------------------- header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-ink">
            日程
          </h1>
          <p className="mt-1.5 text-[13px] text-ink-muted">
            你即将要发生的事 — 每天都会展开，未归档实例默认隐藏已归档。
          </p>
        </div>
        <Link
          href="/schedules/new"
          className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-teal-500 px-5 text-[15px] font-medium tracking-tight text-white transition-colors hover:bg-teal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
            <path
              d="M8 3v10M3 8h10"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          新建
        </Link>
      </div>

      {/* ------------------------------------------------------- search */}
      <form
        onSubmit={handleSearchSubmit}
        noValidate
        className="mt-7"
        role="search"
      >
        <label htmlFor="schedules-search" className="sr-only">
          搜索日程
        </label>
        <div className="relative">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-muted"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4">
              <circle
                cx="7"
                cy="7"
                r="4.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path
                d="M11 11l3 3"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <input
            id="schedules-search"
            type="search"
            value={queryDraft}
            onChange={(event) => setQueryDraft(event.target.value)}
            placeholder="搜索标题…"
            className="block w-full rounded-md border border-line bg-white py-2.5 pl-9 pr-3 text-[15px] text-ink outline-none transition-colors placeholder:text-ink-muted/50 focus:border-teal-500"
          />
        </div>
      </form>

      {/* -------------------------------------------------- window tabs */}
      <nav
        aria-label="时间窗口"
        className="mt-7 flex items-center gap-6 border-b border-line"
      >
        {WINDOW_OPTIONS.map((opt) => {
          const active = opt.value === windowPreset;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => handleWindowChange(opt.value)}
              aria-current={active ? 'page' : undefined}
              className={[
                '-mb-px border-b-2 pb-2.5 text-[13px] transition-colors',
                active
                  ? 'border-teal-500 font-medium text-ink'
                  : 'border-transparent text-ink-muted hover:text-ink',
              ].join(' ')}
            >
              {opt.label}
            </button>
          );
        })}
        <span className="ml-auto pb-2.5 text-[12px] text-ink-muted">
          {loading ? '加载中…' : `${rows.length} 项`}
        </span>
      </nav>

      {/* ------------------------------------------------------- error */}
      {error ? (
        <p
          role="alert"
          className="mt-6 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-[13px] leading-5 text-red-600"
        >
          {error}
        </p>
      ) : null}

      {/* ------------------------------------------------------- list */}
      {loading ? (
        <div className="mt-6 space-y-3" aria-busy>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-lg border border-line bg-white"
            />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState windowPreset={windowPreset} />
      ) : (
        <div className="mt-6 space-y-7">
          {grouped.map((group) => (
            <section key={group.key} aria-labelledby={`day-${group.key}`}>
              <h2
                id={`day-${group.key}`}
                className="mb-2.5 text-[12px] font-medium uppercase tracking-wider text-ink-muted"
              >
                {group.heading}
              </h2>
              <ul className="space-y-2.5">
                {group.rows.map((row) => (
                  <li key={`${row.scheduleId}:${row.instanceStartAt}`}>
                    <EventCard event={row} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function EmptyState({ windowPreset }: { windowPreset: ScheduleWindow }) {
  const label =
    windowPreset === 'today'
      ? '今天'
      : windowPreset === '7d'
        ? '7 天内'
        : '30 天内';
  return (
    <div className="mt-12 flex flex-col items-center text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-teal-50 text-2xl">
        📅
      </span>
      <p className="mt-5 text-[15px] leading-6 text-ink">{label}还没有日程</p>
      <p className="mt-1 max-w-sm text-[13px] leading-5 text-ink-muted">
        从一个简单的会议开始，或者新建一条重复的例行安排。
      </p>
      <Link
        href="/schedules/new"
        className="mt-7 inline-flex h-11 items-center justify-center rounded-md bg-teal-500 px-6 text-[15px] font-medium text-white transition-colors hover:bg-teal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
      >
        新建日程
      </Link>
    </div>
  );
}
