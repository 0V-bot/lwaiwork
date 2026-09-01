'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { api } from '@/lib/api';
import { clearSession, hasStoredSession, readStoredUser } from '@/lib/auth';
import type { AuthResponse, User } from '@/types';

interface AuthContextValue {
  /** null while `loading` is true, or when nobody is signed in. */
  user: User | null;
  /** True until we have confirmed the session with GET /auth/me. */
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Bootstrap: validate the locally stored token pair against the server.
  // `api.get` transparently refreshes an expired access token; if the refresh
  // is rejected too, the session is cleared and we fall back to logged-out.
  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      if (!hasStoredSession()) {
        if (!cancelled) setLoading(false);
        return;
      }

      // Paint immediately from the cached projection to avoid a flash.
      const cached = readStoredUser();
      if (cached && !cancelled) setUser(cached);

      try {
        const me = await api.get<User>('/auth/me');
        if (!cancelled) setUser(me);
      } catch {
        clearSession();
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const result = await api.post<AuthResponse>(
      '/auth/login',
      { email: email.trim().toLowerCase(), password },
      { auth: false },
    );
    setUser(result.user);
  }, []);

  const register = useCallback(async (name: string, email: string, password: string) => {
    const result = await api.post<AuthResponse>(
      '/auth/register',
      { name: name.trim(), email: email.trim().toLowerCase(), password },
      { auth: false },
    );
    setUser(result.user);
  }, []);

  const logout = useCallback(async () => {
    const refreshToken = typeof window === 'undefined' ? null : localStorage.getItem('lwaiwork.refreshToken');
    try {
      // Best effort: revoke server-side, but never block the local sign-out
      // on a network failure.
      await api.post('/auth/logout', refreshToken ? { refreshToken } : {});
    } catch {
      /* ignore - we clear locally regardless */
    } finally {
      clearSession();
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, login, register, logout }),
    [user, loading, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth 必须在 <AuthProvider> 内部使用');
  }
  return context;
}
