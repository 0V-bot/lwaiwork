'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/contexts/AuthContext';

/**
 * Client-side route protection.
 *
 * Renders nothing (and redirects to /login) until the AuthContext has finished
 * validating the session. This is UX-only - the backend enforces real
 * authorisation with JwtAuthGuard + per-user scoping on every /todos route.
 */
export function AuthGuard({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [loading, user, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-teal-500" />
      </div>
    );
  }

  if (!user) return null;

  return <>{children}</>;
}
