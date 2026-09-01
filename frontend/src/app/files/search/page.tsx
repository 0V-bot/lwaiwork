'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { FileCard } from '@/components/FileCard';
import { FileTypeIcon } from '@/components/FileTypeIcon';
import { ApiError, toErrorMessage } from '@/lib/api';
import { listFiles } from '@/lib/files-api';
import type { FileDetail } from '@/types';

// ---------------------------------------------------------------------------
// /files/search — IN-MEMORY filename search.
//
// The backend does NOT expose a `/files/search` endpoint in M2-4; per the
// task brief we approximate it with a client-side substring match against
// the CURRENT page of files returned by GET /files. That keeps the UX
// familiar (typed-in-the-box, instant feedback) without requiring a new
// server contract. The filters below (imagesOnly / contentType) DO push
// down to the server, so they're cheap.
//
// Limitations to surface in the report:
//   * Only the first page (20 rows by default) is searchable.
//   * When the user clears the box or types a query with no matches, the
//     "no results" empty state shows. Bumping `limit` to 100 would widen
//     the searchable set; this is left as a follow-up.
// ---------------------------------------------------------------------------

const PAGE_LIMIT = 100;

/** Curated content-type buckets offered as quick-pick filter chips. Each
 *  label maps to a list of MIME prefixes that the chip "matches". */
const TYPE_FILTERS: { label: string; match: (ct: string) => boolean }[] = [
  { label: '全部', match: () => true },
  {
    label: '图片',
    match: (ct) => ct.startsWith('image/'),
  },
  {
    label: 'PDF',
    match: (ct) => ct === 'application/pdf',
  },
  {
    label: '文本',
    match: (ct) =>
      ct === 'text/plain' || ct === 'text/csv' || ct === 'text/markdown',
  },
  {
    label: 'JSON',
    match: (ct) => ct === 'application/json',
  },
  {
    label: 'ZIP',
    match: (ct) => ct === 'application/zip',
  },
];

function readBoolean(params: URLSearchParams, key: string): boolean {
  const raw = params.get(key);
  return raw === 'true' || raw === '1';
}

export default function FilesSearchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const query = searchParams.get('q') ?? '';
  const imagesOnly = readBoolean(searchParams, 'imagesOnly');
  const typeParam = searchParams.get('type') ?? '全部';

  const [queryDraft, setQueryDraft] = useState(query);

  const [allFiles, setAllFiles] = useState<FileDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listFiles({
        page: 1,
        limit: PAGE_LIMIT,
        includeArchived: false,
        imagesOnly,
      });
      setAllFiles(result.data);
    } catch (err) {
      const message = toErrorMessage(err);
      setError(message);
      setAllFiles([]);
    } finally {
      setLoading(false);
    }
  }, [imagesOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  // Re-pick the type-filter matcher from the URL on every render; missing
  // or invalid values fall back to "all".
  const typeMatcher = useMemo(() => {
    return (
      TYPE_FILTERS.find((f) => f.label === typeParam) ?? TYPE_FILTERS[0]
    );
  }, [typeParam]);

  // The actual filter chain: type-bucket first (it's a deterministic
  // server-side-ish check), then filename substring.
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return allFiles.filter((file) => {
      if (!typeMatcher.match(file.contentType)) return false;
      if (needle.length === 0) return true;
      return file.filename.toLowerCase().includes(needle);
    });
  }, [allFiles, query, typeMatcher]);

  function buildHref(next: {
    q?: string;
    imagesOnly?: boolean;
    type?: string;
  }): string {
    const out = new URLSearchParams();
    const q = next.q ?? query;
    const io = next.imagesOnly ?? imagesOnly;
    const t = next.type ?? typeParam;
    if (q) out.set('q', q);
    if (io) out.set('imagesOnly', 'true');
    if (t && t !== '全部') out.set('type', t);
    const qs = out.toString();
    return qs ? `/files/search?${qs}` : '/files/search';
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    router.push(buildHref({ q: queryDraft.trim() }));
  }

  function handleClear() {
    setQueryDraft('');
    router.push(buildHref({ q: '' }));
  }

  function handleToggleImagesOnly() {
    router.push(buildHref({ imagesOnly: !imagesOnly }));
  }

  function handleTypeChange(label: string) {
    router.push(buildHref({ type: label }));
  }

  function handleArchived(id: string) {
    setAllFiles((prev) => prev.filter((f) => f.id !== id));
  }

  return (
    <div>
      {/* ------------------------------------------------------- header */}
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-[26px] font-semibold leading-tight tracking-tight text-ink">
            搜索文件
          </h1>
          <p className="mt-1.5 text-[13px] text-ink-muted">
            按文件名在最近 {PAGE_LIMIT} 个文件中查找 — 当前是浏览器内过滤，{query ? `关键词「${query}」` : '请输入关键词'}。
          </p>
        </div>
        <Link
          href="/files"
          className="shrink-0 rounded text-[13px] font-medium text-teal-600 transition-colors hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
        >
          ← 返回文件
        </Link>
      </div>

      {/* ---------------------------------------------------- search box */}
      <form onSubmit={handleSubmit} noValidate className="mt-7" role="search">
        <label htmlFor="files-search" className="sr-only">
          搜索文件名
        </label>
        <div className="relative">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-ink-muted"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4">
              <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d="M11 11l3 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </span>
          <input
            id="files-search"
            type="search"
            value={queryDraft}
            onChange={(event) => setQueryDraft(event.target.value)}
            placeholder="按文件名查找…"
            className="block w-full rounded-md border border-line bg-white py-2.5 pl-9 pr-20 text-[15px] text-ink outline-none transition-colors placeholder:text-ink-muted/50 focus:border-teal-500"
          />
          {queryDraft.length > 0 ? (
            <button
              type="button"
              onClick={handleClear}
              aria-label="清除搜索"
              className="absolute inset-y-0 right-2 flex items-center rounded px-2 text-[12px] text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
            >
              清除
            </button>
          ) : null}
        </div>
      </form>

      {/* --------------------------------------------------- type chips */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        {TYPE_FILTERS.map((filter) => {
          const active = filter.label === typeParam;
          return (
            <button
              key={filter.label}
              type="button"
              onClick={() => handleTypeChange(filter.label)}
              aria-pressed={active}
              className={[
                'inline-flex h-8 items-center rounded-full border px-3 text-[12.5px] transition-colors',
                active
                  ? 'border-teal-500 bg-teal-500 text-white'
                  : 'border-line bg-white text-ink-soft hover:border-teal-300 hover:text-teal-700',
              ].join(' ')}
            >
              {filter.label}
            </button>
          );
        })}

        <span className="ml-auto inline-flex items-center gap-2 text-[12.5px] text-ink-muted">
          <button
            type="button"
            onClick={handleToggleImagesOnly}
            aria-pressed={imagesOnly}
            className={[
              'inline-flex h-8 items-center rounded-full border px-3 transition-colors',
              imagesOnly
                ? 'border-teal-500 bg-teal-500 text-white'
                : 'border-line bg-white text-ink-soft hover:border-teal-300 hover:text-teal-700',
            ].join(' ')}
          >
            仅图片
          </button>
        </span>
      </div>

      {/* ------------------------------------------------------- counts */}
      <div className="mt-5 text-[12.5px] text-ink-muted">
        {!loading ? (
          query.trim() ? (
            <>
              关键词「
              <span className="text-ink-soft">{query}</span>
              」·{' '}
              {filtered.length === 0
                ? '没有命中'
                : `命中 ${filtered.length} / ${allFiles.length}`}
            </>
          ) : (
            <>共 {allFiles.length} 个文件（请输入关键词筛选）</>
          )
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

      {/* ------------------------------------------------------- grid */}
      {loading ? (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="aspect-[4/3] animate-pulse rounded-lg border border-line bg-white"
            />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          hasQuery={query.trim().length > 0}
          hasTypeFilter={typeParam !== '全部'}
        />
      ) : (
        <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((file) => (
            <li key={file.id}>
              <FileCard file={file} onArchived={handleArchived} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface EmptyStateProps {
  hasQuery: boolean;
  hasTypeFilter: boolean;
}

function EmptyState({ hasQuery, hasTypeFilter }: EmptyStateProps) {
  let title: string;
  let body: string;
  if (hasQuery && hasTypeFilter) {
    title = '当前筛选下没有命中';
    body = '试着清掉类型筛选，或者换个关键词。';
  } else if (hasQuery) {
    title = '没有匹配的文件名';
    body = '搜索只在最近的文件里进行 — 上传新文件或换个关键词再试。';
  } else if (hasTypeFilter) {
    title = '当前类型下还没有文件';
    body = '试着切换到「全部」类型。';
  } else {
    title = '还没有文件';
    body = '先到文件页上传一个，再回来搜索。';
  }

  return (
    <div className="mt-12 flex flex-col items-center text-center">
      <span
        aria-hidden
        className="flex h-14 w-14 items-center justify-center rounded-full bg-teal-50 text-teal-600"
      >
        <FileTypeIcon contentType="text/plain" className="h-7 w-7" />
      </span>
      <p className="mt-5 text-[15px] leading-6 text-ink">{title}</p>
      <p className="mt-1 max-w-md text-[13px] leading-5 text-ink-muted">
        {body}
      </p>
      <Link
        href="/files"
        className="mt-7 rounded text-[13px] font-medium text-teal-600 transition-colors hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
      >
        回到文件列表
      </Link>
    </div>
  );
}
