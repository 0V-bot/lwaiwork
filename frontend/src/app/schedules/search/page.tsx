'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { EventCard } from '@/components/EventCard';
import { api, toErrorMessage } from '@/lib/api';
import type { ScheduleInstance } from '@/types';

/**
 * /schedules/search — title-only local search over an ultra-wide window.
 *
 * Wire strategy (per the brief):
 *   GET /schedules?from=1970-01-01&to=2099-12-31&includeArchived=true
 *   then locally .filter(r => r.title.includes(q)).
 *
 * The backend has no title-search endpoint, so this is a deliberate local
 * shortlist. Pragmatic for an M2 personal calendar where the user owns a
 * few hundred series max; the work survives until a real FTS lands.
 */

// Inclusive-of-the-future window that still parses as a valid ISO-8601
// datetime on both edges (server uses class-transformer's @Type(() => Date)).
const FAR_PAST = '1970-01-01T00:00:00.000Z';
const FAR_FUTURE = '2099-12-31T23:59:59.999Z';

// ---------------------------------------------------------------------------

export default function SchedulesSearchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const q = searchParams.get('q') ?? '';
  const [queryDraft, setQueryDraft] = useState(q);
  const [allRows, setAllRows] = useState<ScheduleInstance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Wide window with archived included - the local filter handles the
      // query, and we don't want a soft-archived event to silently
      // disappear from search simply because we hid it from the inbox.
      const list = await api.get<ScheduleInstance[]>('/schedules', {
        query: { from: FAR_PAST, to: FAR_FUTURE, includeArchived: true },
      });
      setAllRows(list);
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const results = useMemo(() => {
    if (!q.trim()) return [];
    const needle = q.trim().toLowerCase();
    return allRows.filter((row) =>
      (row.title || '').toLowerCase().includes(needle),
    );
  }, [allRows, q]);

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = queryDraft.trim();
    if (!next) return;
    router.push(`/schedules/search?q=${encodeURIComponent(next)}`);
  }

  return (
    <div>
      {/* ------------------------------------------------------- header */}
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-[26px] font-semibold leading-tight tracking-tight text-ink">
            搜索结果
          </h1>
          <p className="mt-1.5 truncate text-[13px] text-ink-muted">
            {q ? (
              <>
                关键词「<span className="text-ink-soft">{q}</span>」 ·{' '}
                {loading ? '加载中…' : `命中 ${results.length} 条`}
              </>
            ) : (
              '请输入要搜索的关键词'
            )}
          </p>
        </div>
        <Link
          href="/schedules"
          className="shrink-0 rounded text-[13px] font-medium text-teal-600 transition-colors hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
        >
          ← 返回日程
        </Link>
      </div>

      {/* ----------------------------------------------------- search box */}
      <form
        onSubmit={handleSearchSubmit}
        noValidate
        className="mt-7"
        role="search"
      >
        <label htmlFor="schedules-search" className="sr-only">
          搜索日程
        </label>
        <div className="relative">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-muted"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4">
              <circle
                cx="7"
                cy="7"
                r="4.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              />
              <path
                d="M11 11l3 3"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <input
            id="schedules-search"
            type="search"
            value={queryDraft}
            onChange={(event) => setQueryDraft(event.target.value)}
            placeholder="搜索标题…"
            className="block w-full rounded-md border border-line bg-white py-2.5 pl-9 pr-3 text-[15px] text-ink outline-none transition-colors placeholder:text-ink-muted/50 focus:border-teal-500"
          />
        </div>
      </form>

      {/* ------------------------------------------------------- error */}
      {error ? (
        <p
          role="alert"
          className="mt-6 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-[13px] leading-5 text-red-600"
        >
          {error}
        </p>
      ) : null}

      {/* ------------------------------------------------------- list */}
      {loading ? (
        <div className="mt-6 space-y-3" aria-busy>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-lg border border-line bg-white"
            />
          ))}
        </div>
      ) : !q.trim() ? (
        <div className="mt-12 flex flex-col items-center text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-teal-50 text-2xl">
            🔍
          </span>
          <p className="mt-5 text-[15px] leading-6 text-ink">输入关键词开始搜索</p>
          <p className="mt-1 max-w-sm text-[13px] leading-5 text-ink-muted">
            搜索会同时命中已归档和未归档的日程，按标题匹配。
          </p>
        </div>
      ) : results.length === 0 ? (
        <div className="mt-12 flex flex-col items-center text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-teal-50 text-2xl">
            🗓️
          </span>
          <p className="mt-5 text-[15px] leading-6 text-ink">
            没有匹配的日程
          </p>
          <p className="mt-1 max-w-sm text-[13px] leading-5 text-ink-muted">
            试试更短的关键词，或换个字眼再试。
          </p>
        </div>
      ) : (
        <ul className="mt-6 space-y-2.5">
          {results.map((row) => (
            <li key={`${row.scheduleId}:${row.instanceStartAt}`}>
              <EventCard event={row} showDate />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
