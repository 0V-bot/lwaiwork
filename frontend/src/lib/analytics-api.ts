import { api } from './api';
import type {
  AnalyticsModule,
  AnalyticsRange,
  AnalyticsResponse,
  AnalyticsSummary,
} from '@/types';

/**
 * Analytics SDK.
 *
 * Mirrors the other module-level SDKs in src/lib (dashboard-api etc):
 * thin, typed wrappers over `api.get`. The dashboard is read-only,
 * so we never POST.
 *
 * The modules argument defaults to undefined -> all five modules on
 * the backend (no `modules` query param is sent). Pass an explicit
 * array to opt in to a subset.
 */

/** Query the analytics endpoint for `range` and the chosen `modules`. */
export function fetchAnalytics(
  range: AnalyticsRange,
  modules?: readonly AnalyticsModule[],
): Promise<AnalyticsResponse> {
  const query: Record<string, string> = { range };
  if (modules && modules.length > 0) {
    // Backend accepts comma-separated values; this matches the
    // documented wire format in the task brief.
    query.modules = modules.join(',');
  }
  return api.get<AnalyticsResponse>('/dashboard/analytics', { query });
}

/** All-time summary. No caching on the back end; cheap to call. */
export function fetchSummary(): Promise<AnalyticsSummary> {
  return api.get<AnalyticsSummary>('/dashboard/analytics/summary');
}
