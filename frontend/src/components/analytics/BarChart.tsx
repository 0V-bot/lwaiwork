'use client';

import { SeriesChart, type EnabledSeries } from './SeriesChart';
import type { AnalyticsResponse } from '@/types';

/**
 * Bar-mode wrapper. Same data + enabled toggles as LineChart; just a
 * different chart shape so the user can pick the look they prefer.
 */

interface BarChartProps {
  data: AnalyticsResponse;
  enabled: EnabledSeries;
}

export function BarChart({ data, enabled }: BarChartProps) {
  return <SeriesChart data={data} enabled={enabled} mode="bar" />;
}
