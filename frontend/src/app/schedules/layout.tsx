import type { ReactNode } from 'react';

import { AppHeader } from '@/components/AppHeader';
import { AuthGuard } from '@/components/AuthGuard';

/**
 * Shared shell for everything under /schedules.
 *
 * Mirrors /notes/layout.tsx + /habits/layout.tsx:
 *   - AuthGuard wraps the whole subtree so deep links (e.g. /schedules/<uuid>)
 *     don't render before the session check resolves, and so AppHeader (which
 *     reads user info) only mounts for signed-in visitors.
 *   - The `<main>` width matches the rest of the app so the tab-switch
 *     between 待办 / 习惯 / 日程 / 笔记 doesn't reflow horizontally.
 */
export default function SchedulesLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGuard>
      <div className="min-h-screen bg-white">
        <AppHeader />
        <main className="mx-auto w-full max-w-2xl px-6 pb-24 pt-10">
          {children}
        </main>
      </div>
    </AuthGuard>
  );
}
