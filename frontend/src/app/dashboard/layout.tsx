import type { ReactNode } from 'react';

import { AppHeader } from '@/components/AppHeader';
import { AuthGuard } from '@/components/AuthGuard';

/**
 * Shared shell for everything under /dashboard.
 *
 * Mirrors /files/layout.tsx (max-w-5xl): the dashboard is the home page
 * after sign-in and the left/right two-column card layout needs the
 * extra width to breathe. AuthGuard ensures deep-link visits still
 * land on the session check before any card renders.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
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
