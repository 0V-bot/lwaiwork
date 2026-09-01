import { api } from './api';
import type { DashboardToday } from '@/types';

/**
 * Dashboard SDK.
 *
 * Mirrors the other module-level SDKs in src/lib (api + auth + files-api):
 * a thin, typed wrapper over `api.get`. No POSTs / mutations - the
 * dashboard is read-only and the data refreshes either via the manual
 * refresh button or on route revisit.
 */

export function fetchToday(): Promise<DashboardToday> {
  return api.get<DashboardToday>('/dashboard/today');
}
