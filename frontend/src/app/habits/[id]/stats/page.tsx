'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/Button';
import { api, toErrorMessage } from '@/lib/api';
import type { HabitStats, HabitStatsRange, HeatmapPoint, HabitWithToday } from '@/types';

// ---------------------------------------------------------------------------

interface PageProps {
  /**
   * Next.js 14 keeps `params` synchronous for client components — it's
   * awaited internally by the router before the page is mounted. Reshape
   * to a plain object here so the rest of the file doesn't care.
   */
  params: { id: string };
}

const RANGE_OPTIONS: { key: HabitStatsRange; label: string }[] = [
  { key: '30d', label: '30 天' },
  { key: '90d', label: '90 天' },
  { key: '365d', label: '一年' },
];

export default function HabitStatsPage({ params }: PageProps) {
  const { id } = params;
  const router = useRouter();

  const [habit, setHabit] = useState<HabitWithToday | null>(null);
  const [stats, setStats] = useState<HabitStats | null>(null);
  const [range, setRange] = useState<HabitStatsRange>('90d');

  const [loading, setLoading] = useState(true);
  const [statsLoading, setStatsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [confirmArchive, setConfirmArchive] = useState(false);
  const [archiving, setArchiving] = useState(false);

  const loadHabit = useCallback(async () => {
    try {
      const h = await api.get<HabitWithToday>(`/habits/${id}`);
      setHabit(h);
    } catch (err) {
      setError(toErrorMessage(err));
    }
  }, [id]);

  const loadStats = useCallback(
    async (nextRange: HabitStatsRange) => {
      setStatsLoading(true);
      try {
        const s = await api.get<HabitStats>(`/habits/${id}/stats`, {
          query: { range: nextRange },
        });
        setStats(s);
      } catch (err) {
        setError(toErrorMessage(err));
      } finally {
        setStatsLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    let cancelled = false;
    async function init() {
      setLoading(true);
      setError(null);
      try {
        const [h, s] = await Promise.all([
          api.get<HabitWithToday>(`/habits/${id}`),
          api.get<HabitStats>(`/habits/${id}/stats`, { query: { range } }),
        ]);
        if (cancelled) return;
        setHabit(h);
        setStats(s);
      } catch (err) {
        if (!cancelled) setError(toErrorMessage(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void init();
    return () => {
      cancelled = true;
    };
    // `range` is applied to the parallel fetch above; changing it triggers
    // the dedicated effect below so we don't re-fetch the habit twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    void loadStats(range);
  }, [range, loadStats]);

  async function handleArchive() {
    if (!habit) return;
    setArchiving(true);
    try {
      await api.del<{ message: string }>(`/habits/${habit.id}`);
      router.replace('/habits');
    } catch (err) {
      setError(toErrorMessage(err));
      setArchiving(false);
    }
  }

  // -------------------------------------------------------- error / loading
  if (loading) {
    return (
      <div aria-busy className="mt-12 space-y-4">
        <div className="h-8 w-1/2 animate-pulse rounded bg-line" />
        <div className="h-3 w-full animate-pulse rounded bg-line" />
      </div>
    );
  }

  if (!habit) {
    return (
      <div className="mt-12 space-y-4 text-center">
        <p className="text-[15px] text-ink">未找到这个习惯。</p>
        {error ? (
          <p
            role="alert"
            className="mx-auto max-w-md rounded-md border border-red-100 bg-red-50 px-3 py-2 text-[13px] leading-5 text-red-600"
          >
            {error}
          </p>
        ) : null}
        <Link
          href="/habits"
          className="inline-block text-[13px] text-teal-600 hover:text-teal-700"
        >
          ← 返回今日
        </Link>
      </div>
    );
  }

  return (
    <div>
      {/* ------------------------------------------------------- header */}
      <div className="flex items-start justify-between">
        <div>
          <Link
            href="/habits"
            className="text-[13px] text-ink-muted transition-colors hover:text-ink"
          >
            ← 返回今日
          </Link>
          <div className="mt-3 flex items-center gap-3">
            <span
              className="flex h-10 w-10 items-center justify-center rounded-md text-[20px] leading-none"
              style={{ backgroundColor: habit.color + '22' }}
              aria-hidden
            >
              {habit.icon || '✓'}
            </span>
            <h1 className="truncate text-[22px] font-semibold leading-tight tracking-tight text-ink">
              {habit.name}
            </h1>
          </div>
          <p className="mt-2 text-[13px] text-ink-muted">
            {habit.frequencyType === 'every_n_days'
              ? `每 ${habit.frequencyDays} 天 · 目标 ${habit.targetCount} 次/天`
              : habit.frequencyType === 'weekdays'
                ? `工作日 · 目标 ${habit.targetCount} 次/天`
                : `每天 · 目标 ${habit.targetCount} 次/天`}
          </p>
        </div>

        {stats ? (
          <div className="rounded-md border border-line px-3 py-2 text-right">
            <p className="text-[11px] uppercase tracking-wider text-ink-muted">
              连续
            </p>
            <p className="mt-0.5 text-[18px] font-semibold tracking-tight text-teal-600">
              {stats.currentStreak} 天
            </p>
          </div>
        ) : null}
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-6 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-[13px] leading-5 text-red-600"
        >
          {error}
        </p>
      ) : null}

      {/* ----------------------------------------------------- metric tiles */}
      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricTile
          label="当前连续"
          value={stats?.currentStreak ?? 0}
          suffix="天"
          loading={statsLoading && !stats}
        />
        <MetricTile
          label="最长连续"
          value={stats?.longestStreak ?? 0}
          suffix="天"
          loading={statsLoading && !stats}
        />
        <MetricTile
          label={`本周期打卡`}
          value={stats?.totalCheckins ?? 0}
          suffix="次"
          loading={statsLoading && !stats}
        />
        <MetricTile
          label="完成率"
          value={
            stats
              ? Math.round(stats.completionRate * 100)
              : 0
          }
          suffix="%"
          loading={statsLoading && !stats}
        />
      </div>

      {/* ---------------------------------- heatmap heading + range toggle */}
      <div className="mt-10 flex items-end justify-between">
        <div>
          <h2 className="text-[14px] font-medium tracking-tight text-ink">
            打卡热力图
          </h2>
          {stats ? (
            <p className="mt-1 text-[12px] text-ink-muted">
              {stats.rangeStart} → {stats.rangeEnd} ·
              {' '}共 {stats.scheduledDays} 个计划日，已完成 {stats.checkedScheduledDays}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-1 rounded-md border border-line p-0.5">
          {RANGE_OPTIONS.map((opt) => {
            const active = range === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setRange(opt.key)}
                aria-pressed={active}
                className={[
                  'h-7 rounded px-2.5 text-[12px] transition-colors',
                  active
                    ? 'bg-teal-500 text-white'
                    : 'text-ink-muted hover:text-ink',
                ].join(' ')}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ------------------------------------------------------- heatmap */}
      <div className="mt-4 overflow-x-auto rounded-md border border-line p-4">
        {stats ? <Heatmap points={stats.heatmap} accent={habit.color} target={habit.targetCount} /> : (
          <div className="h-24 animate-pulse rounded bg-line" />
        )}
      </div>

      {/* ----------------------------------------------- legend + delete */}
      <div className="mt-6 flex items-center justify-between">
        <div className="flex items-center gap-2 text-[12px] text-ink-muted">
          <span>少</span>
          <Legend stops={[0.1, 0.3, 0.6, 1]} accent={habit.color} />
          <span>多</span>
        </div>
        <button
          type="button"
          onClick={() => setConfirmArchive(true)}
          className="text-[13px] text-ink-muted transition-colors hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
        >
          归档这个习惯
        </button>
      </div>

      {confirmArchive ? (
        <ConfirmSheet
          title="归档这个习惯？"
          body={`「${habit.name}」将从今日页面移除，历史与连续天数会保留。`}
          confirmLabel={archiving ? '归档中…' : '归档并离开'}
          disabled={archiving}
          onCancel={() => !archiving && setConfirmArchive(false)}
          onConfirm={() => void handleArchive()}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface MetricTileProps {
  label: string;
  value: number;
  suffix?: string;
  loading?: boolean;
}

function MetricTile({ label, value, suffix, loading }: MetricTileProps) {
  return (
    <div className="rounded-md border border-line p-4">
      <p className="text-[11px] uppercase tracking-wider text-ink-muted">{label}</p>
      {loading ? (
        <p className="mt-2 h-7 w-16 animate-pulse rounded bg-line" />
      ) : (
        <p className="mt-2 text-[24px] font-semibold leading-none tracking-tight text-ink">
          {value}
          {suffix ? (
            <span className="ml-1 text-[13px] font-medium text-ink-muted">{suffix}</span>
          ) : null}
        </p>
      )}
    </div>
  );
}

interface HeatmapProps {
  points: HeatmapPoint[];
  accent: string;
  target: number;
}

/**
 * Hand-rolled SVG heatmap so we don't pull in d3 or recharts. Layout:
 *   - column = one ISO week
 *   - row    = ISO weekday (Mon..Sun)
 *   - cell   = 11px square, 3px gutter, total width adapts to range length
 * Total height is fixed at 7 * 14 = 98px so the page doesn't jump as the
 * user toggles ranges.
 */
function Heatmap({ points, accent, target }: HeatmapProps) {
  const data = useMemo(() => {
    if (points.length === 0) return null;

    // Group points into ISO weeks using UTC weekday (Mon=1 .. Sun=0 at top).
    // We anchor the first column to the Monday of the first point's week so
    // even a partial first week renders without jagged leading whitespace.
    const firstDate = parseUtcDate(points[0].date);
    const firstMondayOffset = (firstDate.getUTCDay() + 6) % 7; // 0..6 (0=Mon)
    const firstMonday = addUtcDays(points[0].date, -firstMondayOffset);

    // weekIndex 0..N for each point.
    const weeks: HeatmapPoint[][] = [];
    let current: HeatmapPoint[] = [];
    let expectedMonday = firstMonday;
    for (const point of points) {
      // If the point is not the expected Monday, pad with nulls.
      while (point.date !== expectedMonday) {
        current.push({ date: '', count: 0, completed: false });
        expectedMonday = addUtcDays(expectedMonday, 7);
        if (current.length === 7) {
          weeks.push(current);
          current = [];
        }
      }
      current.push(point);
      if (current.length === 7) {
        weeks.push(current);
        current = [];
      }
      expectedMonday = addUtcDays(expectedMonday, 7);
    }
    if (current.length > 0) {
      while (current.length < 7) {
        current.push({ date: '', count: 0, completed: false });
      }
      weeks.push(current);
    }

    return { weeks, count: weeks.length, target };
  }, [points, target]);

  if (!data) {
    return <p className="text-[13px] text-ink-muted">暂无数据。</p>;
  }

  const cell = 11;
  const gap = 3;
  const weekWidth = cell + gap;
  const height = 7 * cell + 6 * gap;
  const width = data.count * weekWidth;

  return (
    <svg
      role="img"
      aria-label="过去 N 天的打卡热力图"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: 'block', minWidth: '100%' }}
    >
      {data.weeks.map((week, weekIdx) =>
        week.map((point, dayIdx) => {
          if (!point.date) return null;
          const x = weekIdx * weekWidth;
          const y = dayIdx * (cell + gap);
          return (
            <rect
              key={`${point.date}-${weekIdx}-${dayIdx}`}
              x={x}
              y={y}
              width={cell}
              height={cell}
              rx={2}
              ry={2}
              fill={heatColor(point.count, data.target, accent)}
            >
              <title>
                {point.date}
                {' · '}
                {point.count > 0 ? `${point.count} 次${point.completed ? '（已达目标）' : ''}` : '未打卡'}
              </title>
            </rect>
          );
        }),
      )}
    </svg>
  );
}

function heatColor(count: number, target: number, accent: string): string {
  const safeAccent = /^#[0-9A-Fa-f]{6}$/.test(accent) ? accent : '#2FAF9E';
  if (count <= 0) return '#EEF3F2';

  // Snap ratio to { 0.25, 0.5, 0.75, 1 } for a clean heat-map look.
  const ratio = Math.max(0.25, Math.min(1, count / Math.max(1, target)));
  const snap = ratio <= 0.4 ? 0.25 : ratio <= 0.7 ? 0.5 : ratio <= 0.95 ? 0.75 : 1;
  return mixWithWhite(safeAccent, 1 - snap);
}

/** Blend `hex` toward white so accent stays legible on a white canvas. */
function mixWithWhite(hex: string, whiteRatio: number): string {
  const value = hex.slice(1);
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  const mix = (channel: number): number => Math.round(channel * (1 - whiteRatio) + 255 * whiteRatio);
  return `#${[mix(r), mix(g), mix(b)]
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')}`;
}

function Legend({ stops, accent }: { stops: number[]; accent: string }) {
  return (
    <div className="flex items-center gap-1.5">
      {stops.map((stop) => (
        <span
          key={stop}
          aria-hidden
          className="h-3 w-3 rounded-sm"
          style={{ backgroundColor: mixWithWhite(accent, 1 - stop) }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Minimal UTC date helpers — mirrors backend/src/habits/habit-date.util.ts
// shapes so the layout math agrees with whatever the server computed.
// ---------------------------------------------------------------------------

function parseUtcDate(date: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`parseUtcDate: expected YYYY-MM-DD, got "${date}"`);
  const [, y, m, d] = match;
  return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
}

function addUtcDays(date: string, n: number): string {
  const d = parseUtcDate(date);
  d.setUTCDate(d.getUTCDate() + n);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ---------------------------------------------------------------------------

interface ConfirmSheetProps {
  title: string;
  body: string;
  confirmLabel: string;
  disabled: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmSheet({
  title,
  body,
  confirmLabel,
  disabled,
  onConfirm,
  onCancel,
}: ConfirmSheetProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="stats-confirm-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 px-4 py-6 sm:items-center"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="stats-confirm-title" className="text-[16px] font-semibold tracking-tight text-ink">
          {title}
        </h3>
        <p className="mt-2 text-[13px] leading-5 text-ink-muted">{body}</p>
        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={disabled}
            className="rounded text-[13px] text-ink-muted transition-colors hover:text-ink disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
          >
            取消
          </button>
          <Button onClick={onConfirm} loading={disabled}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
