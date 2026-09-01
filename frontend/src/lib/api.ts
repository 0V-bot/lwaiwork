import type { AuthResponse } from '@/types';
import { clearSession, getAccessToken, getRefreshToken, saveSession } from './auth';

/**
 * Minimal fetch wrapper for the NestJS backend.
 *
 * Behaviour:
 *   1. Prefixes every path with NEXT_PUBLIC_API_BASE_URL (already contains the
 *      backend's global /api prefix).
 *   2. Automatically attaches `Authorization: Bearer <access>` unless
 *      `{ auth: false }` is passed.
 *   3. On HTTP 401 it transparently calls POST /auth/refresh once, swaps in the
 *      new access token and replays the original request.
 *   4. Normalises every failure into an ApiError with a human-readable message,
 *      including class-validator arrays (NestJS returns message: string[]).
 */

// Backend moved from 3000 to 4000: port 3000 is taken by another project on the
// target ECS host. Must stay in sync with backend/.env PORT.
const RAW_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api';
const BASE_URL = RAW_BASE.replace(/\/+$/, '');

export class ApiError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }

  /** True when we never got an HTTP response (offline / DNS / CORS). */
  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

/** Turns any thrown value into something safe to render in the UI. */
export function toErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return '发生未知错误，请稍后重试。';
}

export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  /** JSON-serialisable body; `undefined` sends no body at all. */
  body?: unknown;
  /** Attach the Bearer token. Default true. */
  auth?: boolean;
  /** Query string params; undefined / null / '' values are dropped. */
  query?: Record<string, QueryValue>;
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${BASE_URL}${suffix}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * NestJS + class-validator shape the error body as
 *   { statusCode, message: string | string[], error }
 * so the `message` field may be an array of validation rules.
 */
function extractMessage(body: unknown, status: number): string {
  const fallback = `请求失败（HTTP ${status}）`;

  if (body && typeof body === 'object') {
    const { message } = body as { message?: unknown };
    if (Array.isArray(message)) {
      const parts = message.map((item) => String(item)).filter(Boolean);
      if (parts.length > 0) return parts.join('; ');
    } else if (typeof message === 'string' && message.trim()) {
      return message;
    }
    return fallback;
  }

  if (typeof body === 'string' && body.trim()) return body;
  return fallback;
}

/**
 * Single-flight refresh. Concurrent 401s must not fire N refresh calls, or the
 * rotation would invalidate the token mid-flight and log the user out.
 */
let refreshInFlight: Promise<string | null> | null = null;

export function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;

  const attempt = (async (): Promise<string | null> => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) {
      clearSession();
      return null;
    }

    try {
      const response = await fetch(buildUrl('/auth/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
        credentials: 'omit',
      });

      const body = await readBody(response);
      if (!response.ok) {
        clearSession();
        return null;
      }

      const auth = body as AuthResponse;
      if (!auth?.accessToken) {
        clearSession();
        return null;
      }

      saveSession(auth);
      return auth.accessToken;
    } catch {
      // The refresh endpoint itself is unreachable - keep the session so a
      // transient blip does not log the user out, but give up on this request.
      return null;
    }
  })();

  refreshInFlight = attempt.finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

async function request<T>(
  path: string,
  options: RequestOptions = {},
  isRetry = false,
): Promise<T> {
  const { body, auth = true, query, headers, ...rest } = options;

  const finalHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
  if (headers) {
    new Headers(headers).forEach((value, key) => {
      finalHeaders[key] = value;
    });
  }
  if (auth) {
    const token = getAccessToken();
    if (token) finalHeaders.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, query), {
      ...rest,
      headers: finalHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      // Bearer-token auth: no cookies are needed, so credentials are omitted.
      // This also keeps the CORS surface minimal.
      credentials: 'omit',
    });
  } catch (error) {
    throw new ApiError(
      '无法连接到服务器，请确认后端已启动且允许了本站点跨域。',
      0,
      error,
    );
  }

  // Transparent refresh: only for authenticated requests, only once.
  if (response.status === 401 && auth && !isRetry) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      return request<T>(path, options, true);
    }
  }

  const parsed = await readBody(response);
  if (!response.ok) {
    throw new ApiError(extractMessage(parsed, response.status), response.status, parsed);
  }

  return parsed as T;
}

type MethodOptions = Omit<RequestOptions, 'body' | 'method'>;

export const api = {
  get: <T>(path: string, options?: MethodOptions): Promise<T> =>
    request<T>(path, { ...options, method: 'GET' }),

  post: <T>(path: string, body?: unknown, options?: MethodOptions): Promise<T> =>
    request<T>(path, { ...options, method: 'POST', body }),

  patch: <T>(path: string, body?: unknown, options?: MethodOptions): Promise<T> =>
    request<T>(path, { ...options, method: 'PATCH', body }),

  del: <T>(path: string, body?: unknown, options?: MethodOptions): Promise<T> =>
    request<T>(path, { ...options, method: 'DELETE', body }),
};
