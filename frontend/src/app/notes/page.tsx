'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { Button } from '@/components/Button';
import { NoteCard } from '@/components/NoteCard';
import { api, toErrorMessage } from '@/lib/api';
import type { NoteSummary, Paginated } from '@/types';

// ---------------------------------------------------------------------------
// Secondary tabs at the top of the inbox. State is encoded entirely in the
// URL so the back button restores the exact view the user was in.
//   /notes                       - 全部（未归档）
//   /notes?includeArchived=true  - 已归档
//   /notes?tag=foo               - 单 tag 过滤
// ---------------------------------------------------------------------------

type View = 'active' | 'archived';

function readView(params: URLSearchParams): View {
  return params.get('includeArchived') === 'true' ? 'archived' : 'active';
}

/** Backend defaults to limit 20; we ask for the full inbox (max 100 per DTO). */
const PAGE_LIMIT = 100;

export default function NotesListPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const view = readView(searchParams);
  const tagFilter = searchParams.get('tag');

  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search input is local; submission writes ?q=... and routes to /notes/search.
  const [queryDraft, setQueryDraft] = useState(searchParams.get('q') ?? '');
  const [searchSubmitting, setSearchSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const query: Record<string, string | number | boolean> = { limit: PAGE_LIMIT };
      if (view === 'archived') query.includeArchived = true;
      if (tagFilter) query.tag = tagFilter;

      const result = await api.get<Paginated<NoteSummary>>('/notes', { query });
      setNotes(result.data);
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [tagFilter, view]);

  useEffect(() => {
    void load();
  }, [load]);

  // ----------------------------------------------- URL helpers
  function buildHref(next: { view?: View; tag?: string | null }): string {
    const out = new URLSearchParams();
    if (next.view === 'archived') out.set('includeArchived', 'true');
    if (next.view === 'active' && tagFilter == null && next.tag !== null) {
      // no-op: explicit-active with no tag
    }
    const tagValue = next.tag === undefined ? tagFilter : next.tag;
    if (tagValue) out.set('tag', tagValue);
    const qs = out.toString();
    return qs ? `/notes?${qs}` : '/notes';
  }

  function handleViewChange(next: View) {
    if (next === view) return;
    router.push(buildHref({ view: next, tag: tagFilter }));
  }

  function handleClearTag() {
    router.push(buildHref({ view, tag: null }));
  }

  function handleSearchSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = queryDraft.trim();
    if (!q || searchSubmitting) return;
    setSearchSubmitting(true);
    const params = new URLSearchParams({ q });
    if (tagFilter) params.set('tag', tagFilter);
    router.push(`/notes/search?${params.toString()}`);
  }

  return (
    <div>
      {/* ------------------------------------------------------- header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-ink">
            笔记
          </h1>
          <p className="mt-1.5 text-[13px] text-ink-muted">
            记录、检索与回顾 — 正文加密保存，只在列表展示摘要。
          </p>
        </div>
        <Link
          href="/notes/new"
          className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-teal-500 px-5 text-[15px] font-medium tracking-tight text-white transition-colors hover:bg-teal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
            <path
              d="M8 3v10M3 8h10"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          新建
        </Link>
      </div>

      {/* ------------------------------------------------------- search */}
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

      {/* ------------------------------------------------ secondary nav */}
      <nav
        aria-label="笔记视图"
        className="mt-7 flex items-center gap-6 border-b border-line"
      >
        <button
          type="button"
          onClick={() => handleViewChange('active')}
          aria-current={view === 'active' ? 'page' : undefined}
          className={[
            '-mb-px border-b-2 pb-2.5 text-[13px] transition-colors',
            view === 'active'
              ? 'border-teal-500 font-medium text-ink'
              : 'border-transparent text-ink-muted hover:text-ink',
          ].join(' ')}
        >
          全部
        </button>
        <button
          type="button"
          onClick={() => handleViewChange('archived')}
          aria-current={view === 'archived' ? 'page' : undefined}
          className={[
            '-mb-px border-b-2 pb-2.5 text-[13px] transition-colors',
            view === 'archived'
              ? 'border-teal-500 font-medium text-ink'
              : 'border-transparent text-ink-muted hover:text-ink',
          ].join(' ')}
        >
          已归档
        </button>
        {tagFilter ? (
          <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-soft">
            <span aria-hidden className="text-ink-muted">
              ·
            </span>
            标签
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
      </nav>

      {/* ------------------------------------------------------- error */}
      {error ? (
        <p
          role="alert"
          className="mt-6 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-[13px] leading-5 text-red-600"
        >
          {error}
        </p>
      ) : null}

      {/* ------------------------------------------------------- grid */}
      {loading ? (
        <div className="mt-6 space-y-3" aria-busy>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-lg border border-line bg-white"
            />
          ))}
        </div>
      ) : notes.length === 0 ? (
        <EmptyState
          view={view}
          tag={tagFilter}
          hasQuery={queryDraft.trim().length > 0}
        />
      ) : (
        <ul className="mt-6 grid grid-cols-1 gap-3">
          {notes.map((note) => (
            <li key={note.id}>
              <NoteCard note={note} highlightTag={tagFilter ?? undefined} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface EmptyStateProps {
  view: View;
  tag: string | null;
  hasQuery: boolean;
}

function EmptyState({ view, tag, hasQuery }: EmptyStateProps) {
  let title: string;
  let body: string;
  if (hasQuery) {
    title = '还没找到匹配的笔记';
    body = '搜索只命中摘要前 200 字，试着换个关键词。';
  } else if (tag) {
    title = `没有标签为「${tag}」的笔记`;
    body = '把标签用在新笔记上吧 — 它会出现在这里。';
  } else if (view === 'archived') {
    title = '还没有归档的笔记';
    body = '归档是把笔记从主列表移除，便于主列表保持精简。';
  } else {
    title = '还没有笔记';
    body = '从一条短小的记录开始 — 例如一条会议要点或一段灵感。';
  }

  return (
    <div className="mt-12 flex flex-col items-center text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-teal-50 text-2xl">
        🗒️
      </span>
      <p className="mt-5 text-[15px] leading-6 text-ink">{title}</p>
      <p className="mt-1 max-w-sm text-[13px] leading-5 text-ink-muted">
        {body}
      </p>
      {view === 'active' && !tag && !hasQuery ? (
        <Link
          href="/notes/new"
          className="mt-7 inline-flex h-11 items-center justify-center rounded-md bg-teal-500 px-6 text-[15px] font-medium text-white transition-colors hover:bg-teal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
        >
          创建第一条笔记
        </Link>
      ) : null}
    </div>
  );
}
