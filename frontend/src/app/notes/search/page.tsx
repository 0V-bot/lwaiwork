'use client';

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { Button } from '@/components/Button';
import { NoteCard } from '@/components/NoteCard';
import { api, toErrorMessage } from '@/lib/api';
import type { NoteSummary, SearchNotePayload } from '@/types';

export default function NotesSearchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const query = searchParams.get('q') ?? '';
  const tagFilter = searchParams.get('tag');

  const [results, setResults] = useState<NoteSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The search box mirrors `q` so the user can iterate without a full
  // page navigation; clearing it wipes the URL on submit.
  const [queryDraft, setQueryDraft] = useState(query);

  const load = useCallback(async () => {
    if (!query.trim()) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const body: SearchNotePayload = { query: query.trim() };
      if (tagFilter) body.tag = tagFilter;
      const list = await api.post<NoteSummary[]>('/notes/search', body);
      setResults(list);
    } catch (err) {
      setError(toErrorMessage(err));
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [query, tagFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = queryDraft.trim();
    const params = new URLSearchParams();
    if (next) params.set('q', next);
    if (tagFilter) params.set('tag', tagFilter);
    const qs = params.toString();
    router.push(qs ? `/notes/search?${qs}` : '/notes');
  }

  function handleClearTag() {
    const params = new URLSearchParams();
    if (query) params.set('q', query);
    const qs = params.toString();
    router.push(qs ? `/notes/search?${qs}` : '/notes');
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
            {query ? (
              <>
                关键词「
                <span className="text-ink-soft">{query}</span>
                」
                {tagFilter ? (
                  <>
                    {' · '}
                    标签
                    <span className="text-ink-soft">「{tagFilter}」</span>
                  </>
                ) : null}
              </>
            ) : (
              '请输入要搜索的关键词'
            )}
          </p>
        </div>
        <Link
          href="/notes"
          className="shrink-0 rounded text-[13px] font-medium text-teal-600 transition-colors hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
        >
          ← 返回笔记
        </Link>
      </div>

      {/* ----------------------------------------------------- search box */}
      <form
        onSubmit={handleSearchSubmit}
        noValidate
        className="mt-7"
        role="search"
      >
        <label htmlFor="notes-search" className="sr-only">
          搜索笔记
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
            id="notes-search"
            type="search"
            value={queryDraft}
            onChange={(event) => setQueryDraft(event.target.value)}
            placeholder="搜索摘要里的关键词…"
            className="block w-full rounded-md border border-line bg-white py-2.5 pl-9 pr-3 text-[15px] text-ink outline-none transition-colors placeholder:text-ink-muted/50 focus:border-teal-500"
          />
        </div>
      </form>

      {/* ------------------------------------------------ tag chip + count */}
      <div className="mt-5 flex items-center gap-3 text-[13px] text-ink-muted">
        {tagFilter ? (
          <span className="inline-flex items-center gap-1.5">
            按标签筛选
            <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-[12px] text-teal-700">
              {tagFilter}
              <button
                type="button"
                onClick={handleClearTag}
                aria-label={`清除标签 ${tagFilter}`}
                className="-mr-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-teal-500 transition-colors hover:bg-teal-100 hover:text-teal-700"
              >
                <svg viewBox="0 0 16 16" className="h-3 w-3" aria-hidden>
                  <path
                    d="M4 4l8 8M12 4l-8 8"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </span>
          </span>
        ) : null}
        {!loading && results ? (
          <span>
            {results.length === 0
              ? '没有命中'
              : `命中 ${results.length} 条`}
          </span>
        ) : null}
      </div>

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
              className="h-24 animate-pulse rounded-lg border border-line bg-white"
            />
          ))}
        </div>
      ) : results && results.length === 0 ? (
        <div className="mt-12 flex flex-col items-center text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-teal-50 text-2xl">
            🔍
          </span>
          <p className="mt-5 text-[15px] leading-6 text-ink">
            没有匹配的笔记
          </p>
          <p className="mt-1 max-w-sm text-[13px] leading-5 text-ink-muted">
            搜索只命中摘要的前 200 字 — 试着缩短关键词，或换一个标签再试。
          </p>
        </div>
      ) : results && results.length > 0 ? (
        <ul className="mt-6 grid grid-cols-1 gap-3">
          {results.map((note) => (
            <li key={note.id}>
              <NoteCard note={note} highlightTag={tagFilter ?? undefined} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
