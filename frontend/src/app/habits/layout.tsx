import type { ReactNode } from 'react';

import { AppHeader } from '@/components/AppHeader';
import { AuthGuard } from '@/components/AuthGuard';

/**
 * Shared shell for everything under /habits.
 *
 * Wrapping AuthGuard at the layout level avoids re-mounting the spinner on
 * client-side navigation between habits pages and guarantees the AppHeader
 * (and its `useAuth()`) only renders for signed-in users.
 */
export default function HabitsLayout({ children }: { children: ReactNode }) {
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
