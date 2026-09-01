'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { useAuth } from '@/contexts/AuthContext';

/**
 * Entry point: there is no marketing surface yet, so the root just bounces to
 * the right place once the session has been validated.
 */
export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? '/habits' : '/login');
  }, [loading, user, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-white">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-teal-500" />
    </div>
  );
}
