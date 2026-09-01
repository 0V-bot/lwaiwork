'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import { api, toErrorMessage } from '@/lib/api';
import type { HabitWithToday } from '@/types';

// ---------------------------------------------------------------------------
// Pure view helpers — kept module-local so they can be unit-tested and
// tree-shaken out of the bundle if the page is ever split.
// ---------------------------------------------------------------------------

const WEEKDAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/**
 * "Mon · 3月15日" — the desktop reading rhythm we want on the page header.
 * `new Date()` runs only on the client (this page is `'use client'`), so no
 * SSR/CSR mismatch as long as we render the same `Date.now()` on hydration.
 * To stay deterministic, we snapshot once per mount via useMemo.
 */
function formatToday(date: Date): { weekday: string; full: string } {
  const weekday = WEEKDAY_NAMES[date.getDay()] ?? '';
  const full = `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
  return { weekday, full };
}

/** Render the user's frequency choice as a short hint under the habit name. */
function frequencyHint(habit: HabitWithToday): string {
  switch (habit.frequencyType) {
    case 'daily':
      return '每天';
    case 'weekdays':
      return '工作日';
    case 'custom':
      return '自定义';
    case 'every_n_days':
      return `每 ${habit.frequencyDays} 天`;
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------

export default function HabitsTodayPage() {
  const [habits, setHabits] = useState<HabitWithToday[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /**
   * Habit IDs that the user just clicked "打卡" on, so we can show a tiny
   * spinner inline without freezing the whole card. Cleared on settle.
   */
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const todayMeta = useMemo(() => {
    // Snapshotted once on mount. Re-renders within the same day stay stable.
    const now = new Date();
    return {
      ...formatToday(now),
      iso: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`,
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.get<HabitWithToday[]>('/habits');
      // Backend orders DESC by created_at; keep that order but pin a stable
      // secondary key so identical-time rows don't shuffle between renders.
      setHabits(list);
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Aggregate counters power the "today" headline.
  const counters = useMemo(() => {
    const total = habits.length;
    const done = habits.filter((h) => h.todayCompleted).length;
    const pendingCount = total - done;
    return { total, done, pending: pendingCount };
  }, [habits]);

  async function handleCheck(habit: HabitWithToday) {
    if (habit.todayCompleted) return;
    setPending((prev) => ({ ...prev, [habit.id]: true }));
    // Optimistic bump - the streak heatmap depends on `todayCount`, not just
    // `todayCompleted`, so flipping only the completed flag would mis-render
    // multi-target habits (target>1) during the request.
    setHabits((prev) =>
      prev.map((item) =>
        item.id === habit.id
          ? {
              ...item,
              todayCount: item.todayCount + 1,
              todayCompleted: item.todayCount + 1 >= item.targetCount,
            }
          : item,
      ),
    );
    setError(null);
    try {
      await api.post(`/habits/${habit.id}/check`, {});
    } catch (err) {
      // Roll back the optimistic increment.
      setHabits((prev) =>
        prev.map((item) =>
          item.id === habit.id
            ? {
                ...item,
                todayCount: Math.max(0, item.todayCount - 1),
                todayCompleted: item.todayCount - 1 >= item.targetCount,
              }
            : item,
        ),
      );
      setError(toErrorMessage(err));
    } finally {
      setPending((prev) => ({ ...prev, [habit.id]: false }));
    }
  }

  async function handleUncheck(habit: HabitWithToday) {
    if (!habit.todayCompleted && habit.todayCount === 0) return;
    const wasCount = habit.todayCount;
    setPending((prev) => ({ ...prev, [habit.id]: true }));
    setHabits((prev) =>
      prev.map((item) =>
        item.id === habit.id
          ? {
              ...item,
              todayCount: Math.max(0, item.todayCount - 1),
              todayCompleted: Math.max(0, item.todayCount - 1) >= item.targetCount,
            }
          : item,
      ),
    );
    setError(null);
    try {
      await api.del(`/habits/${habit.id}/check`);
    } catch (err) {
      setHabits((prev) =>
        prev.map((item) =>
          item.id === habit.id
            ? { ...item, todayCount: wasCount, todayCompleted: wasCount >= item.targetCount }
            : item,
        ),
      );
      setError(toErrorMessage(err));
    } finally {
      setPending((prev) => ({ ...prev, [habit.id]: false }));
    }
  }

  return (
    <div>
      {/* ------------------------------------------------------ headline */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-ink">
            今日习惯
          </h1>
          <p className="mt-1.5 text-[13px] text-ink-muted">
            {todayMeta.weekday} · {todayMeta.full}
          </p>
        </div>
        <Link
          href="/habits/manage"
          className="rounded text-[13px] font-medium text-teal-600 transition-colors hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
        >
          管理
        </Link>
      </div>

      {/* --------------------------------------------------- progress bar */}
      {counters.total > 0 ? (
        <div className="mt-5 flex items-center gap-3">
          <span className="text-[13px] text-ink-muted">
            {counters.done === counters.total
              ? `今日 ${counters.total} 项已全部完成`
              : `已完成 ${counters.done} / ${counters.total}`}
          </span>
          <span className="h-1 flex-1 overflow-hidden rounded-full bg-line">
            <span
              className="block h-full rounded-full bg-teal-500 transition-[width] duration-300"
              style={{
                width: `${counters.total === 0 ? 0 : Math.round((counters.done / counters.total) * 100)}%`,
              }}
            />
          </span>
        </div>
      ) : null}

      {/* --------------------------------------------------- error banner */}
      {error ? (
        <p
          role="alert"
          className="mt-6 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-[13px] leading-5 text-red-600"
        >
          {error}
        </p>
      ) : null}

      {/* ------------------------------------------------- empty / loading */}
      {loading ? (
        <div className="mt-8 space-y-4" aria-busy>
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-center gap-3 py-3.5">
              <span className="h-10 w-10 animate-pulse rounded-md bg-line" />
              <span className="h-3 flex-1 animate-pulse rounded bg-line" />
              <span className="h-8 w-16 animate-pulse rounded bg-line" />
            </div>
          ))}
        </div>
      ) : habits.length === 0 ? (
        <div className="mt-12 flex flex-col items-center text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-teal-50 text-2xl">
            🌱
          </span>
          <p className="mt-5 text-[15px] leading-6 text-ink">
            还没有习惯 — 从一个微小的动作开始。
          </p>
          <p className="mt-1 text-[13px] leading-5 text-ink-muted">
            例如「喝一杯水」「读完 10 页书」「拉伸三分钟」。
          </p>
          <Link
            href="/habits/manage"
            className="mt-7 inline-flex h-11 items-center justify-center rounded-md bg-teal-500 px-6 text-[15px] font-medium text-white transition-colors hover:bg-teal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
          >
            创建第一个习惯
          </Link>
        </div>
      ) : (
        // ----------------------------------------------------------- list
        <ul className="mt-8 divide-y divide-line">
          {habits.map((habit) => (
            <HabitRow
              key={habit.id}
              habit={habit}
              pending={Boolean(pending[habit.id])}
              onCheck={() => void handleCheck(habit)}
              onUncheck={() => void handleUncheck(habit)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface HabitRowProps {
  habit: HabitWithToday;
  pending: boolean;
  onCheck: () => void;
  onUncheck: () => void;
}

function HabitRow({ habit, pending, onCheck, onUncheck }: HabitRowProps) {
  const completed = habit.todayCompleted;
  const multiTarget = habit.targetCount > 1;

  return (
    <li className="flex items-center gap-4 py-4">
      <Link
        href={`/habits/${habit.id}/stats`}
        aria-label={`查看「${habit.name}」的统计`}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[20px] leading-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
        style={{ backgroundColor: tintFor(habit.color) }}
      >
        <span aria-hidden>{habit.icon || '✓'}</span>
      </Link>

      <Link
        href={`/habits/${habit.id}/stats`}
        className="flex-1 truncate focus-visible:outline-none"
      >
        <div className="flex items-baseline gap-2">
          <span
            className={[
              'truncate text-[15px] tracking-tight',
              completed ? 'text-ink-muted line-through' : 'text-ink',
            ].join(' ')}
          >
            {habit.name}
          </span>
          <span className="shrink-0 text-[12px] text-ink-muted">
            {frequencyHint(habit)}
          </span>
        </div>
        <div className="mt-0.5 text-[13px] text-ink-muted">
          {completed
            ? `今日 ${habit.todayCount}/${habit.targetCount} · 已完成`
            : multiTarget
              ? `今日 ${habit.todayCount}/${habit.targetCount}`
              : habit.targetCount === 1
                ? '今日 1 次'
                : `今日 ${habit.todayCount}/${habit.targetCount}`}
        </div>
      </Link>

      {completed ? (
        <button
          type="button"
          onClick={onUncheck}
          disabled={pending}
          aria-label={`撤销「${habit.name}」今日打卡`}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-teal-200 bg-teal-50 text-teal-600 transition-colors hover:bg-teal-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 disabled:opacity-50"
        >
          <svg viewBox="0 0 32 32" className="h-4 w-4" aria-hidden>
            <path
              d="M9 16.8l4.2 4.2L23 11.2"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      ) : (
        <button
          type="button"
          onClick={onCheck}
          disabled={pending}
          aria-label={`为「${habit.name}」打卡`}
          className="h-9 shrink-0 rounded-md bg-teal-500 px-4 text-[13px] font-medium text-white transition-colors hover:bg-teal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 disabled:cursor-not-allowed disabled:bg-teal-300"
        >
          {pending ? '…' : multiTarget ? '打卡' : '打卡'}
        </button>
      )}
    </li>
  );
}

/**
 * Translucent variant of the habit color, for the icon-block background.
 * Falls back to a neutral teal-50 if the color isn't a valid hex token so
 * custom user-set values still render tastefully.
 */
function tintFor(color: string): string {
  const hex = /^#[0-9A-Fa-f]{6}$/.test(color) ? color : '#2FAF9E';
  const value = hex.slice(1);
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  // 12% opacity equivalent over white, expressed as opaque hex.
  const mix = (channel: number): number => Math.round(channel * 0.12 + 255 * 0.88);
  return `#${[mix(r), mix(g), mix(b)]
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')}`;
}
