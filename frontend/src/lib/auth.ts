import type { AuthResponse, User } from '@/types';

/**
 * Token persistence.
 *
 * SECURITY NOTE: localStorage is used deliberately (not cookies) because the
 * backend authenticates purely via `Authorization: Bearer <access>` and is
 * deployed on a different origin from this app - there is no httpOnly cookie
 * in the contract to rely on. That means these values are reachable by any
 * script running on the page, so XSS = full account takeover.
 *
 * Mitigations in place:
 *   - React escapes all interpolated text by default; no `dangerouslySetInnerHTML`
 *     is used anywhere in this app.
 *   - Refresh-token rotation is server-side (replay is rejected), so a leaked
 *     refresh token has a short blast radius.
 *   - TODO(next milestone): move to a BFF (Next Route Handler) holding the
 *     tokens in httpOnly, SameSite cookies and proxying the NestJS API.
 */

const ACCESS_KEY = 'lwaiwork.accessToken';
const REFRESH_KEY = 'lwaiwork.refreshToken';
const USER_KEY = 'lwaiwork.user';

/** All storage access is SSR-safe: returns null during server render. */
function read(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Safari private mode / storage disabled.
    return null;
  }
}

function write(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* quota or disabled storage - the session simply will not survive a reload */
  }
}

function remove(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function getAccessToken(): string | null {
  return read(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  return read(REFRESH_KEY);
}

/** Persist a full token pair plus the user projection. */
export function saveSession(auth: AuthResponse): void {
  write(ACCESS_KEY, auth.accessToken);
  write(REFRESH_KEY, auth.refreshToken);
  write(USER_KEY, JSON.stringify(auth.user));
}

/** Cached user projection, used to paint the UI before /auth/me resolves. */
export function readStoredUser(): User | null {
  const raw = read(USER_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<User>;
    if (!parsed || typeof parsed.id !== 'string' || typeof parsed.email !== 'string') {
      return null;
    }
    return parsed as User;
  } catch {
    remove(USER_KEY);
    return null;
  }
}

export function clearSession(): void {
  remove(ACCESS_KEY);
  remove(REFRESH_KEY);
  remove(USER_KEY);
}

/**
 * Cheap synchronous check - tells us a token pair exists locally, NOT that it
 * is still valid. The real validity check is GET /auth/me in AuthContext.
 */
export function hasStoredSession(): boolean {
  return Boolean(getAccessToken() && getRefreshToken());
}
