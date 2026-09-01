'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import { FileCard } from '@/components/FileCard';
import { FileUploader } from '@/components/FileUploader';
import { ApiError, toErrorMessage } from '@/lib/api';
import { listFiles } from '@/lib/files-api';
import type { FileDetail, PageMeta } from '@/types';

// ---------------------------------------------------------------------------
// /files — primary list view.
//
// URL contract:
//   ?includeArchived=true   - show archived rows (off by default)
//   ?imagesOnly=true        - restrict to image/* (off by default)
//   ?page=N&limit=20        - 1-indexed pagination (cap 100, default 20)
//
// State machine:
//   - `loading`     flips true while the GET is in flight
//   - `error`       is the ApiError message (rendered inline above the grid)
//   - `files`       is the latest successful page
//   - `meta`        drives the pagination control; null on first load
//
// When the uploader calls `onComplete` we re-fetch the current page so
// the new file appears in the grid (and we drop the user back on page 1
// if they were deep in a pagination that no longer matches).
// ---------------------------------------------------------------------------

function readBoolean(params: URLSearchParams, key: string): boolean {
  const raw = params.get(key);
  return raw === 'true' || raw === '1';
}

function readNumber(params: URLSearchParams, key: string): number | null {
  const raw = params.get(key);
  if (raw === null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const PAGE_LIMIT = 20;

export default function FilesListPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const includeArchived = readBoolean(searchParams, 'includeArchived');
  const imagesOnly = readBoolean(searchParams, 'imagesOnly');
  const page = readNumber(searchParams, 'page') ?? 1;
  const limit = readNumber(searchParams, 'limit') ?? PAGE_LIMIT;

  const [files, setFiles] = useState<FileDetail[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listFiles({
        page,
        limit,
        includeArchived,
        imagesOnly,
      });
      setFiles(result.data);
      setMeta(result.meta);
    } catch (err) {
      const message =
        err instanceof ApiError && err.status === 404
          ? '没有找到文件。'
          : toErrorMessage(err);
      setError(message);
      setFiles([]);
      setMeta(null);
    } finally {
      setLoading(false);
    }
  }, [page, limit, includeArchived, imagesOnly]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  function buildHref(next: {
    includeArchived?: boolean;
    imagesOnly?: boolean;
    page?: number;
    limit?: number;
  }): string {
    const out = new URLSearchParams();
    const ia = next.includeArchived ?? includeArchived;
    const io = next.imagesOnly ?? imagesOnly;
    const p = next.page ?? page;
    const l = next.limit ?? limit;
    if (ia) out.set('includeArchived', 'true');
    if (io) out.set('imagesOnly', 'true');
    if (p !== 1) out.set('page', String(p));
    if (l !== PAGE_LIMIT) out.set('limit', String(l));
    const qs = out.toString();
    return qs ? `/files?${qs}` : '/files';
  }

  function handleToggleArchived() {
    router.push(buildHref({ includeArchived: !includeArchived, page: 1 }));
  }

  function handleToggleImagesOnly() {
    router.push(buildHref({ imagesOnly: !imagesOnly, page: 1 }));
  }

  function handlePage(target: number) {
    if (!meta) return;
    const clamped = Math.max(1, Math.min(meta.totalPages, target));
    router.push(buildHref({ page: clamped }));
  }

  function handleUploaded() {
    // After a successful upload drop the user back on page 1 - the new file
    // is at the top (server orders by updated_at DESC) and is unlikely to
    // land on whatever deep page they had paged to.
    if (page !== 1) {
      router.push(buildHref({ page: 1 }));
    } else {
      setRefreshKey((k) => k + 1);
    }
  }

  function handleArchived(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    // If the server's archived filter is OFF, also drop the meta count so
    // the pagination math stays honest. (Otherwise the row would vanish
    // locally but `meta.total` would still claim it exists.)
    if (!includeArchived && meta) {
      const nextTotal = Math.max(0, meta.total - 1);
      const totalPages = Math.max(1, Math.ceil(nextTotal / meta.limit));
      setMeta({ ...meta, total: nextTotal, totalPages });
    }
  }

  return (
    <div>
      {/* ------------------------------------------------------- header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-ink">
            文件
          </h1>
          <p className="mt-1.5 text-[13px] text-ink-muted">
            上传、查看与下载 — 单文件最大 100 MiB，链接 5 分钟内有效。
          </p>
        </div>
        <div className="flex items-center gap-3 text-[13px]">
          <Link
            href="/files/search"
            className="rounded text-[13px] font-medium text-teal-600 transition-colors hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
          >
            搜索
          </Link>
          <Link
            href="/files/upload"
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
            上传
          </Link>
        </div>
      </div>

      {/* ------------------------------------------------------- uploader */}
      <div className="mt-7">
        <FileUploader onComplete={handleUploaded} />
      </div>

      {/* ------------------------------------------------- secondary nav */}
      <div className="mt-9 flex flex-wrap items-center gap-6 border-b border-line pb-3 text-[13px]">
        <button
          type="button"
          onClick={handleToggleArchived}
          aria-pressed={includeArchived}
          className={[
            '-mb-3.5 border-b-2 pb-3 transition-colors',
            includeArchived
              ? 'border-teal-500 font-medium text-ink'
              : 'border-transparent text-ink-muted hover:text-ink',
          ].join(' ')}
        >
          {includeArchived ? '含已归档' : '仅未归档'}
        </button>
        <button
          type="button"
          onClick={handleToggleImagesOnly}
          aria-pressed={imagesOnly}
          className={[
            '-mb-3.5 border-b-2 pb-3 transition-colors',
            imagesOnly
              ? 'border-teal-500 font-medium text-ink'
              : 'border-transparent text-ink-muted hover:text-ink',
          ].join(' ')}
        >
          {imagesOnly ? '仅图片' : '全部类型'}
        </button>
        {meta ? (
          <span className="ml-auto text-[12.5px] text-ink-muted">
            共 {meta.total} 个文件
          </span>
        ) : null}
      </div>

      {/* ------------------------------------------------------- error */}
      {error ? (
        <div className="mt-6 rounded-md border border-red-100 bg-red-50 px-3 py-3 text-[13px] leading-5 text-red-600">
          <p role="alert">{error}</p>
          <button
            type="button"
            onClick={() => setRefreshKey((k) => k + 1)}
            className="mt-2 rounded text-[13px] font-medium text-red-700 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
          >
            重试
          </button>
        </div>
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
      ) : files.length === 0 ? (
        <EmptyState
          archived={includeArchived}
          imagesOnly={imagesOnly}
        />
      ) : (
        <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {files.map((file) => (
            <li key={file.id}>
              <FileCard file={file} onArchived={handleArchived} />
            </li>
          ))}
        </ul>
      )}

      {/* ---------------------------------------------------- pagination */}
      {meta && meta.totalPages > 1 ? (
        <div className="mt-10 flex items-center justify-center gap-2 text-[13px]">
          <button
            type="button"
            onClick={() => handlePage(page - 1)}
            disabled={page <= 1}
            className="inline-flex h-9 items-center rounded-md border border-line bg-white px-3 text-ink-soft transition-colors hover:bg-line/50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
          >
            ← 上一页
          </button>
          <span className="text-ink-muted">
            第 {page} / {meta.totalPages} 页
          </span>
          <button
            type="button"
            onClick={() => handlePage(page + 1)}
            disabled={page >= meta.totalPages}
            className="inline-flex h-9 items-center rounded-md border border-line bg-white px-3 text-ink-soft transition-colors hover:bg-line/50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
          >
            下一页 →
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface EmptyStateProps {
  archived: boolean;
  imagesOnly: boolean;
}

function EmptyState({ archived, imagesOnly }: EmptyStateProps) {
  let title: string;
  let body: string;
  if (archived && imagesOnly) {
    title = '没有已归档的图片';
    body = '把页面上方的「含已归档」「仅图片」开关关掉，看看其它文件。';
  } else if (archived) {
    title = '没有已归档的文件';
    body = '归档是把文件从主列表移除；切换「仅未归档」就能看到活跃文件。';
  } else if (imagesOnly) {
    title = '还没有图片文件';
    body = '试着关闭「仅图片」看看，或者上传一张 PNG / JPEG / WebP 试试。';
  } else {
    title = '还没有文件';
    body = '把文件拖拽到上面的区域，或者点击进入大拖拽页 — 支持图片、PDF、文本、Markdown、CSV、JSON、ZIP。';
  }

  return (
    <div className="mt-14 flex flex-col items-center text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-teal-50 text-2xl">
        📎
      </span>
      <p className="mt-5 text-[15px] leading-6 text-ink">{title}</p>
      <p className="mt-1 max-w-md text-[13px] leading-5 text-ink-muted">
        {body}
      </p>
      {!archived && !imagesOnly ? (
        <Link
          href="/files/upload"
          className="mt-7 inline-flex h-11 items-center justify-center rounded-md bg-teal-500 px-6 text-[15px] font-medium text-white transition-colors hover:bg-teal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
        >
          去上传文件
        </Link>
      ) : null}
    </div>
  );
}
