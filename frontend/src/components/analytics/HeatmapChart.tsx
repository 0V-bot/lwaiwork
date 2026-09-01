'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import type { AnalyticsResponse } from '@/types';
import { disposeChart, initChart, resizeChart } from '@/lib/echarts';

/**
 * Heatmap chart - one cell per (day-of-week x day-of-window) showing
 * the count of habit check-ins.
 *
 * Layout: xAxis is a continuous index from `window start` to `today`.
 * yAxis is `[Mon, Tue, Wed, Thu, Fri, Sat, Sun]` rendered bottom-up
 * (calendar convention). Each cell's color encodes the day's total
 * via a `visualMap`.
 *
 * Falls back to a placeholder when echarts isn't installed (mid
 * `npm install` on Windows), same convention as SeriesChart.
 */

interface HeatmapChartProps {
  data: AnalyticsResponse;
}

export function HeatmapChart({ data }: HeatmapChartProps) {
  const domRef = useRef<HTMLDivElement | null>(null);
  const [instance, setInstance] = useState<unknown>(null);
  const [missing, setMissing] = useState(false);

  const option = useMemo(() => buildOption(data), [data]);

  useEffect(() => {
    if (!domRef.current) return;
    let cancelled = false;
    let local: unknown = null;

    initChart(domRef.current, option).then((result) => {
      if (cancelled) {
        disposeChart(result);
        return;
      }
      local = result;
      setInstance(result);
      if (!result) setMissing(true);
    });

    const onResize = () => resizeChart(local);
    window.addEventListener('resize', onResize);

    return () => {
      cancelled = true;
      window.removeEventListener('resize', onResize);
      disposeChart(local);
    };
  }, [option]);

  if (missing) {
    return (
      <div className="flex h-[260px] items-center justify-center rounded-md border border-dashed border-line bg-line/30 px-4 text-center text-[13px] text-ink-muted">
        热力图组件未安装。请先在 frontend 目录执行 npm install。
      </div>
    );
  }

  return (
    <div
      ref={domRef}
      className="h-[260px] w-full"
      role="img"
      aria-label="习惯打卡日历热力图"
    />
  );
}

// ---------------------------------------------------------------------------

const DAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'] as const;

function buildOption(data: AnalyticsResponse): unknown {
  // Index every check-in: key = YYYY-MM-DD -> value = count.
  const lookup = new Map<string, number>();
  for (const p of data.series.habitsChecked) lookup.set(p.date, p.count);

  // Build a continuous day index from the window start through today.
  // The payload may have ended early (server endDate is exclusive), so
  // we span [startDate, todayLocal] (inclusive). The server already pads
  // missing days for the other series; habits don't get the padding
  // treatment, so the chart can render sparse cells correctly.
  const days = enumerateDates(data.startDate, data.endDate);
  // We treat endDate as exclusive (server contract), so trim the last.
  const indexEnd = Math.max(0, days.length - 1);

  const points: Array<[number, number, number]> = [];
  let maxCount = 0;
  for (let x = 0; x < indexEnd; x++) {
    const date = days[x];
    const count = lookup.get(date) ?? 0;
    if (count > maxCount) maxCount = count;
    // `getDay()` returns 0=Sun..6=Sat; we want Mon=0..Sun=6.
    const dow = ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7);
    points.push([x, dow, count]);
  }
  // `unused` is referenced purely to mark the data shape; with strict
  // tsc we need it bound to silence "declared but never read".
  const unused = DAY_LABELS;
  void unused;

  return {
    grid: { left: 36, right: 16, top: 16, bottom: 24 },
    tooltip: {
      formatter: (p: { data: [number, number, number] }) => {
        const [x, y, value] = p.data;
        const date = days[x];
        return `${DAY_LABELS[y]}（${date}）：${value} 次打卡`;
      },
    },
    xAxis: {
      type: 'category',
      data: days.slice(0, indexEnd).map((d) => d.slice(5)),
      show: false,
      splitArea: { show: false },
    },
    yAxis: {
      type: 'category',
      // echarts draws the bottom-most category first; flip to put
      // 周一 at the bottom of the calendar grid.
      data: [...DAY_LABELS].reverse(),
      axisLabel: { fontSize: 11, color: '#7B908D' },
      splitArea: { show: false },
    },
    visualMap: {
      min: 0,
      max: Math.max(1, maxCount),
      orient: 'horizontal',
      left: 'center',
      bottom: 0,
      itemHeight: 80,
      itemWidth: 10,
      textStyle: { fontSize: 11, color: '#47615E' },
      inRange: { color: ['#F0FAF7', '#AEE4D9', '#2FAF9E', '#1D736A'] },
      calculable: false,
    },
    series: [
      {
        type: 'heatmap',
        data: points,
        progressive: 0,
        label: { show: false },
        emphasis: { itemStyle: { borderColor: '#12312E', borderWidth: 1 } },
      },
    ],
  };
}

/** Yield every YYYY-MM-DD between `from` (inclusive) and `to` (exclusive). */
function enumerateDates(from: string, to: string): string[] {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number];
  const start = Date.UTC(fy, fm - 1, fd);
  const end = Date.UTC(ty, tm - 1, td);
  const out: string[] = [];
  for (let t = start; t < end; t += 24 * 3600 * 1000) {
    const d = new Date(t);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    out.push(`${y}-${m}-${day}`);
  }
  return out;
}
