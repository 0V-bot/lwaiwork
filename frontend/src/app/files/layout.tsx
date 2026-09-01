import type { ReactNode } from 'react';

import { AppHeader } from '@/components/AppHeader';
import { AuthGuard } from '@/components/AuthGuard';

/**
 * Shared shell for everything under /files.
 *
 * Mirrors /notes/layout.tsx + /habits/layout.tsx + /schedules/layout.tsx:
 *   - AuthGuard wraps the whole subtree so deep links (e.g. /files/<uuid>)
 *     don't render before the session check resolves, and so AppHeader (which
 *     reads user info) only mounts for signed-in visitors.
 *
 * The `<main>` is wider than the other modules (max-w-5xl) because the
 * file grid is responsive (2-4 columns); narrowing the canvas would force
 * a 1-column wall that hides the value of the thumbnail.
 */
export default function FilesLayout({ children }: { children: ReactNode }) {
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
