import type { ReactNode } from 'react';

import { AppHeader } from '@/components/AppHeader';
import { AuthGuard } from '@/components/AuthGuard';

/**
 * Shared shell for everything under /notes.
 *
 * Mirrors /habits/layout.tsx:
 *   - AuthGuard wraps the whole subtree so deep links (e.g. /notes/<uuid>)
 *     don't render before the session check resolves, and so AppHeader (which
 *     reads user info) only mounts for signed-in visitors.
 *   - The `<main>` width matches the rest of the app so the switch between
 *     笔记 / 习惯 / 待办 tabs doesn't reflow horizontally.
 */
export default function NotesLayout({ children }: { children: ReactNode }) {
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
