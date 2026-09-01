'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { BarChart } from '@/components/analytics/BarChart';
import { HeatmapChart } from '@/components/analytics/HeatmapChart';
import { LineChart } from '@/components/analytics/LineChart';
import { ModuleToggles } from '@/components/analytics/ModuleToggles';
import { RangePicker } from '@/components/analytics/RangePicker';
import type { EnabledSeries } from '@/components/analytics/SeriesChart';
import { SummaryTiles } from '@/components/analytics/SummaryTiles';
import { ApiError, toErrorMessage } from '@/lib/api';
import { fetchAnalytics, fetchSummary } from '@/lib/analytics-api';
import type {
  AnalyticsRange,
  AnalyticsResponse,
  AnalyticsSummary,
} from '@/types';

// ---------------------------------------------------------------------------
// /analytics page.
//
// State machine:
//   * `range` is the user's window selection (7d / 30d / 90d).
//   * `chartKind` toggles line vs bar on the main chart.
//   * `enabled` is the per-series visibility switch (off by default for
//     schedulesFired because it's the busiest line).
//   * `analytics` is the analytics payload; `summary` the all-time tiles.
//   * `loading` / `analyticsError` mirror the dashboard pattern so the
//     skeleton, error and stale states all reuse the same UI grammar.
//
// Defaults:
//   * Always fetch all five modules regardless of `enabled` - the user
//     can hide a series client-side without bouncing the server.
//   * Heatmap is always shown when the payload is present; it ignores
//     `enabled` because the heatmap is its own visualisation.
// ---------------------------------------------------------------------------

const ALL_ENABLED: EnabledSeries = {
  todosCompleted: true,
  habitsChecked: true,
  notesCreated: true,
  filesUploaded: true,
  schedulesFired: true,
};

const THREE_OF_FIVE: EnabledSeries = {
  todosCompleted: true,
  habitsChecked: true,
  notesCreated: true,
  filesUploaded: true,
  schedulesFired: false,
};

export default function AnalyticsPage() {
  const [range, setRange] = useState<AnalyticsRange>('7d');
  const [chartKind, setChartKind] = useState<'line' | 'bar'>('line');
  const [enabled, setEnabled] = useState<EnabledSeries>(ALL_ENABLED);
  const [analytics, setAnalytics] = useState<AnalyticsResponse | null>(null);
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setAnalyticsError(null);
    setSummaryError(null);

    // Fire both requests in parallel; if either fails we keep the
    // other section's payload and degrade the broken one.
    const [a, s] = await Promise.allSettled([
      fetchAnalytics(range),
      fetchSummary(),
    ]);

    if (a.status === 'fulfilled') {
      setAnalytics(a.value);
    } else {
      setAnalytics(null);
      setAnalyticsError(toErrorMessage(a.reason));
    }

    if (s.status === 'fulfilled') {
      setSummary(s.value);
    } else {
      setSummary(null);
      setSummaryError(toErrorMessage(s.reason));
    }

    setLoading(false);
    setRefreshing(false);
  }, [range]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  function handleRefresh() {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshKey((k) => k + 1);
  }

  // When the user drops down to 3-of-5 enabled, "schedulesFired" off
  // is fine but if they then re-enable it, we keep the chip state -
  // nothing special to do here.
  const enabledKeys = useMemo(
    () =>
      (Object.keys(enabled) as Array<keyof EnabledSeries>).filter(
        (k) => enabled[k],
      ),
    [enabled],
  );

  return (
    <div>
      {/* ------------------------------------------------------- header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-ink">
            数据
          </h1>
          <p className="mt-1.5 text-[13px] text-ink-muted">
            一段时间内的工作台活跃度 — 五模块并行聚合。
          </p>
        </div>
        <div className="flex items-center gap-3">
          {analytics ? (
            <span className="hidden text-[12px] text-ink-muted sm:inline">
              最后更新于 {formatHm(new Date(analytics.generatedAt))} · 缓存至{' '}
              {formatHm(new Date(analytics.cachedUntil))}
            </span>
          ) : null}
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            aria-label="刷新数据看板"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-white px-3 text-[13px] text-ink-soft transition-colors hover:bg-line/50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
          >
            <RefreshIcon spinning={refreshing} />
            刷新
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------- controls */}
      <div className="mt-7 flex flex-wrap items-center gap-3">
        <RangePicker
          value={range}
          onChange={setRange}
          disabled={loading && !analytics}
        />
        <ChartKindSwitch value={chartKind} onChange={setChartKind} />
        <div className="ml-auto" />
        <SeriesCountChip active={enabledKeys.length} total={5} />
      </div>

      <div className="mt-3">
        <ModuleToggles enabled={enabled} onChange={setEnabled} />
      </div>

      {/* ------------------------------------------------------- analytics errors */}
      {analyticsError ? (
        <ErrorBox message={analyticsError} onRetry={handleRefresh} />
      ) : null}

      {/* ------------------------------------------------------- main chart */}
      <section className="mt-6">
        <Card
          title="活动趋势"
          subtitle={`${rangeLabel(range)}（${analytics?.startDate ?? '—'} → ${analytics?.endDate ?? '—'}）`}
        >
          {loading && !analytics ? (
            <ChartSkeleton />
          ) : analytics ? (
            chartKind === 'line' ? (
              <LineChart data={analytics} enabled={enabled} />
            ) : (
              <BarChart data={analytics} enabled={enabled} />
            )
          ) : (
            <ChartSkeleton />
          )}
        </Card>
      </section>

      {/* ------------------------------------------------------- heatmap */}
      <section className="mt-6">
        <Card title="习惯打卡日历" subtitle="按星期分布（每日总数）">
          {loading && !analytics ? (
            <HeatmapSkeleton />
          ) : analytics ? (
            <HeatmapChart data={analytics} />
          ) : (
            <HeatmapSkeleton />
          )}
        </Card>
      </section>

      {/* ------------------------------------------------------- summary */}
      <section className="mt-8">
        {summaryError ? (
          <ErrorBox message={summaryError} onRetry={handleRefresh} />
        ) : summary ? (
          <SummaryTiles summary={summary} />
        ) : loading ? (
          <SummarySkeleton />
        ) : (
          <SummarySkeleton />
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------------------

interface CardProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}

function Card({ title, subtitle, children }: CardProps) {
  return (
    <section className="rounded-lg border border-line bg-white p-5">
      <header className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-[14px] font-medium tracking-tight text-ink">
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-0.5 text-[12px] text-ink-muted">{subtitle}</p>
          ) : null}
        </div>
      </header>
      {children}
    </section>
  );
}

function ChartKindSwitch({
  value,
  onChange,
}: {
  value: 'line' | 'bar';
  onChange: (next: 'line' | 'bar') => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="图表样式"
      className="inline-flex overflow-hidden rounded-md border border-line bg-white"
    >
      {(['line', 'bar'] as const).map((kind) => {
        const active = kind === value;
        return (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(kind)}
            className={[
              'h-8 px-3 text-[12.5px] transition-colors focus-visible:outline-none',
              'focus-visible:ring-2 focus-visible:ring-teal-500/40',
              active
                ? 'bg-ink text-white'
                : 'text-ink-soft hover:bg-line/60',
            ].join(' ')}
          >
            {kind === 'line' ? '折线' : '柱状'}
          </button>
        );
      })}
    </div>
  );
}

function SeriesCountChip({ active, total }: { active: number; total: number }) {
  return (
    <span className="inline-flex h-7 items-center rounded-full bg-line px-3 text-[12px] text-ink-soft">
      {active}/{total} 条
    </span>
  );
}

function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="mt-4 rounded-md border border-red-100 bg-red-50 px-3 py-3 text-[13px] leading-5 text-red-600"
    >
      <p>{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-2 rounded text-[13px] font-medium text-red-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
      >
        重试
      </button>
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="h-[320px] animate-pulse rounded-md bg-line/40" aria-hidden />
  );
}

function HeatmapSkeleton() {
  return (
    <div className="h-[260px] animate-pulse rounded-md bg-line/40" aria-hidden />
  );
}

function SummarySkeleton() {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {Array.from({ length: 5 }).map((_, i) => (
        <li
          key={i}
          className="h-[96px] animate-pulse rounded-lg border border-line bg-white"
        />
      ))}
    </ul>
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

function rangeLabel(range: AnalyticsRange): string {
  switch (range) {
    case '7d':
      return '近 7 天';
    case '30d':
      return '近 30 天';
    case '90d':
      return '近 90 天';
  }
}

// Suppress an unused-symbol warning for the alt default; we keep it
// exported from a single source for future "preset" buttons.
void THREE_OF_FIVE;
