'use client';

import { useCallback, useEffect, useState } from 'react';

import { EventsCard } from '@/components/dashboard/EventsCard';
import { FilesCard } from '@/components/dashboard/FilesCard';
import { HabitsCard } from '@/components/dashboard/HabitsCard';
import { NotesCard } from '@/components/dashboard/NotesCard';
import { TodosCard } from '@/components/dashboard/TodosCard';
import { TodayCounters } from '@/components/dashboard/TodayCounters';
import { ApiError, toErrorMessage } from '@/lib/api';
import { fetchToday } from '@/lib/dashboard-api';
import type { DashboardToday } from '@/types';

// ---------------------------------------------------------------------------
// /dashboard — today snapshot.
//
// State machine:
//   * `loading`  flips true while the GET is in flight (also true during
//                manual refresh so the cards render skeletons, not stale data)
//   * `error`    is the latest ApiError message (rendered above the cards)
//   * `snapshot` is the latest successful payload
//   * `refreshKey` is bumped on the refresh button + initial mount
//
// Layout:
//   1. Header (title + last-updated stamp + refresh button)
//   2. TodayCounters (5 number tiles, each links into the corresponding module)
//   3. Two-column grid:
//        left  = TodosCard + HabitsCard (stacked)
//        right = EventsCard
//   4. NotesCard + FilesCard (side-by-side, full width)
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const [snapshot, setSnapshot] = useState<DashboardToday | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchToday();
      setSnapshot(data);
    } catch (err) {
      const message =
        err instanceof ApiError && err.status === 404
          ? '看板暂时无法加载。'
          : toErrorMessage(err);
      setError(message);
      setSnapshot(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshKey((k) => k + 1);
  }

  return (
    <div>
      {/* ------------------------------------------------------- header */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-ink">
            看板
          </h1>
          <p className="mt-1.5 text-[13px] text-ink-muted">
            今天的事，看一眼就知道 — 一次拉取，五大模块并行汇总。
          </p>
        </div>
        <div className="flex items-center gap-3">
          {snapshot ? (
            <span className="hidden text-[12px] text-ink-muted sm:inline">
              最后更新于 {formatHm(new Date(snapshot.generatedAt))}
            </span>
          ) : null}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            aria-label="刷新看板"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-white px-3 text-[13px] text-ink-soft transition-colors hover:bg-line/50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
          >
            <RefreshIcon spinning={refreshing} />
            刷新
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------- error */}
      {error ? (
        <div
          role="alert"
          className="mt-6 rounded-md border border-red-100 bg-red-50 px-3 py-3 text-[13px] leading-5 text-red-600"
        >
          <p>{error}</p>
          <button
            type="button"
            onClick={handleRefresh}
            className="mt-2 rounded text-[13px] font-medium text-red-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
          >
            重试
          </button>
        </div>
      ) : null}

      {/* ------------------------------------------------------- counters */}
      <div className="mt-7">
        {loading && !snapshot ? (
          <CountersSkeleton />
        ) : snapshot ? (
          <TodayCounters counts={snapshot.counts} />
        ) : (
          <CountersSkeleton />
        )}
      </div>

      {/* ------------------------------------------------------- main grid */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-6">
          {loading && !snapshot ? (
            <CardSkeleton />
          ) : snapshot ? (
            <TodosCard todos={snapshot.openTodos} />
          ) : (
            <CardSkeleton />
          )}
          {loading && !snapshot ? (
            <CardSkeleton />
          ) : snapshot ? (
            <HabitsCard habits={snapshot.habitsToday} />
          ) : (
            <CardSkeleton />
          )}
        </div>

        {loading && !snapshot ? (
          <CardSkeleton />
        ) : snapshot ? (
          <EventsCard events={snapshot.eventsToday} />
        ) : (
          <CardSkeleton />
        )}
      </div>

      {/* ------------------------------------------------------- bottom grid */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {loading && !snapshot ? (
          <CardSkeleton />
        ) : snapshot ? (
          <NotesCard notes={snapshot.recentNotes} />
        ) : (
          <CardSkeleton />
        )}
        {loading && !snapshot ? (
          <CardSkeleton />
        ) : snapshot ? (
          <FilesCard files={snapshot.recentFiles} />
        ) : (
          <CardSkeleton />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeletons + helpers
// ---------------------------------------------------------------------------

function CountersSkeleton() {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {[0, 1, 2, 3, 4].map((i) => (
        <li
          key={i}
          className="flex h-[88px] animate-pulse flex-col justify-between rounded-lg border border-line bg-white p-4"
        />
      ))}
    </ul>
  );
}

function CardSkeleton() {
  return (
    <div className="h-[260px] animate-pulse rounded-lg border border-line bg-white p-5">
      <div className="h-4 w-20 rounded bg-line" />
      <div className="mt-5 space-y-3">
        <div className="h-3 w-3/4 rounded bg-line" />
        <div className="h-3 w-2/3 rounded bg-line" />
        <div className="h-3 w-1/2 rounded bg-line" />
      </div>
    </div>
  );
}

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className={['h-3.5 w-3.5', spinning ? 'animate-spin' : ''].join(' ')}
      aria-hidden
    >
      <path
        d="M13.5 8a5.5 5.5 0 0 1-9.7 3.5M2.5 8a5.5 5.5 0 0 1 9.7-3.5M13.5 3v3h-3M2.5 13v-3h3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function formatHm(d: Date): string {
  if (Number.isNaN(d.getTime())) return '—';
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mi}`;
}
