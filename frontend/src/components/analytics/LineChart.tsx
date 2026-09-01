'use client';

import { SeriesChart, type EnabledSeries } from './SeriesChart';
import type { AnalyticsResponse } from '@/types';

/**
 * Line-mode wrapper. Kept as its own component so the page can flip
 * between this and `BarChart` without prop-drilling the mode flag.
 */

interface LineChartProps {
  data: AnalyticsResponse;
  enabled: EnabledSeries;
}

export function LineChart({ data, enabled }: LineChartProps) {
  return <SeriesChart data={data} enabled={enabled} mode="line" />;
}
