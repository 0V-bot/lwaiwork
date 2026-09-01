import type { ReactNode } from 'react';

import { AppHeader } from '@/components/AppHeader';
import { AuthGuard } from '@/components/AuthGuard';

/**
 * Shared shell for /analytics.
 *
 * Same chrome as /dashboard: AuthGuard wraps the tree, AppHeader
 * renders the top bar with the '数据' tab active via the active-link
 * rules in AppHeader. Container is the wider `max-w-5xl` because the
 * charts need horizontal room; on narrow phones the chart height
 * stays a fixed 320px which is the minimum echarts measures cleanly.
 */
export default function AnalyticsLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <div className="min-h-screen bg-white">
        <AppHeader />
        <main className="mx-auto w-full max-w-5xl px-6 pb-24 pt-10">
          {children}
        </main>
      </div>
    </AuthGuard>
  );
}
