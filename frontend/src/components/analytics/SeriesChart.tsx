'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import {
  ANALYTICS_SERIES_META,
  type AnalyticsResponse,
  type AnalyticsSeries,
} from '@/types';
import { disposeChart, initChart, resizeChart } from '@/lib/echarts';

/**
 * Per-day line chart over the five analytics series.
 *
 * The component is purely a viewport + echarts wrapper:
 *   * `enabled` toggles each series on/off at render time - we keep the
 *     data around so a flip doesn't trigger a re-fetch.
 *   * `mode = 'line' | 'bar'` controls the chart shape.
 *   * echarts is dynamically imported; if the package is missing we
 *     render a placeholder so the page never crashes.
 */

type SeriesKey = keyof AnalyticsSeries;
export type EnabledSeries = Record<SeriesKey, boolean>;

interface SeriesChartProps {
  data: AnalyticsResponse;
  enabled: EnabledSeries;
  mode: 'line' | 'bar';
}

const SERIES_ORDER: readonly SeriesKey[] = [
  'todosCompleted',
  'habitsChecked',
  'notesCreated',
  'filesUploaded',
  'schedulesFired',
];

export function SeriesChart({ data, enabled, mode }: SeriesChartProps) {
  const domRef = useRef<HTMLDivElement | null>(null);
  const [instance, setInstance] = useState<unknown>(null);
  const [missing, setMissing] = useState(false);

  // Build the echarts option whenever the data, toggles, or mode change.
  // Using `useMemo` so React StrictMode's double-effect doesn't re-init
  // for the same args.
  const option = useMemo(() => buildOption(data, enabled, mode), [data, enabled, mode]);

  // (Re)create the chart when the option identity changes; dispose the
  // previous instance. setOption() on the same chart would also work
  // here, but a clean dispose+init keeps the resize listener simple.
  useEffect(() => {
    if (!domRef.current) return;
    let cancelled = false;
    let local: unknown = null;

    initChart(domRef.current, option).then((result) => {
      if (cancelled) {
        // The component re-rendered mid-flight; dispose whatever we got.
        disposeChart(result);
        return;
      }
      local = result;
      setInstance(result);
      if (!result) setMissing(true);
    });

    // Window resize -> chart resize. addEventListener's options object
    // is supported in modern browsers (incl. Safari 14+).
    const onResize = () => resizeChart(local);
    window.addEventListener('resize', onResize);

    return () => {
      cancelled = true;
      window.removeEventListener('resize', onResize);
      disposeChart(local);
    };
    // We deliberately depend on `option` (memoized above) rather than the
    // raw props - this collapses echarts churn to "option shape changed".
  }, [option]);

  if (missing) {
    return (
      <div className="flex h-[320px] items-center justify-center rounded-md border border-dashed border-line bg-line/30 px-4 text-center text-[13px] text-ink-muted">
        图表组件未安装，请先在 frontend 目录执行
        <span className="mx-1 rounded bg-white px-1.5 py-0.5 text-[12px] text-ink-soft">
          npm install
        </span>
        以安装 echarts 后刷新。
      </div>
    );
  }

  return (
    <div
      ref={domRef}
      // echarts measures the host element on init - giving it an explicit
      // height keeps SSR + first-paint sane.
      className="h-[320px] w-full"
      role="img"
      aria-label="每日子图活动折线 / 柱状图"
    />
  );
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

function buildOption(
  data: AnalyticsResponse,
  enabled: EnabledSeries,
  mode: 'line' | 'bar',
): unknown {
  const dates = collectDates(data);
  // Lookup by date for O(1) per-cell access.
  const byKeyDate: Record<SeriesKey, Map<string, number>> = {
    todosCompleted: new Map(data.series.todosCompleted.map((p) => [p.date, p.count])),
    habitsChecked:  new Map(data.series.habitsChecked.map((p) => [p.date, p.count])),
    notesCreated:   new Map(data.series.notesCreated.map((p) => [p.date, p.count])),
    filesUploaded:  new Map(data.series.filesUploaded.map((p) => [p.date, p.count])),
    schedulesFired: new Map(data.series.schedulesFired.map((p) => [p.date, p.count])),
  };

  const series = SERIES_ORDER.filter((key) => enabled[key]).map((key) => {
    const counts = dates.map((d) => byKeyDate[key].get(d) ?? 0);
    const meta = ANALYTICS_SERIES_META[key];
    return {
      name: meta.label,
      type: mode,
      data: counts,
      smooth: mode === 'line',
      symbol: mode === 'line' ? 'circle' : 'rect',
      symbolSize: mode === 'line' ? 6 : undefined,
      itemStyle: { color: meta.hex },
      lineStyle: mode === 'line' ? { color: meta.hex, width: 2 } : undefined,
      barWidth: mode === 'bar' ? '60%' : undefined,
      emphasis: { focus: 'series' },
    };
  });

  return {
    grid: { left: 48, right: 16, top: 32, bottom: 28 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { top: 0, left: 0, icon: 'circle', textStyle: { fontSize: 12 } },
    xAxis: {
      type: 'category',
      data: dates.map(shortLabel),
      axisTick: { alignWithLabel: true },
      axisLabel: { fontSize: 11, color: '#7B908D' },
      axisLine: { lineStyle: { color: '#E6EDEC' } },
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      axisLabel: { fontSize: 11, color: '#7B908D' },
      splitLine: { lineStyle: { color: '#E6EDEC' } },
    },
    series,
  };
}

/**
 * Collect the union of all dates present in the payload, sorted
 * ascending. Series can be sparse (a day with zero events has no row),
 * so the chart must see every day to leave a visual gap rather than
 * connecting across them.
 */
function collectDates(data: AnalyticsResponse): string[] {
  const set = new Set<string>();
  const lists = [
    data.series.todosCompleted,
    data.series.habitsChecked,
    data.series.notesCreated,
    data.series.filesUploaded,
    data.series.schedulesFired,
  ];
  for (const list of lists) for (const p of list) set.add(p.date);
  return Array.from(set).sort();
}

/** YYYY-MM-DD -> MM-DD (drop the year once we're past ~30 days). */
function shortLabel(date: string): string {
  return date.length === 10 ? date.slice(5) : date;
}
