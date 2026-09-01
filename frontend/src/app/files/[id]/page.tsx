'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';

import { FileTypeIcon } from '@/components/FileTypeIcon';
import { ApiError, toErrorMessage } from '@/lib/api';
import { archiveFile, getFile } from '@/lib/files-api';
import type { FileDetail } from '@/types';

// ---------------------------------------------------------------------------
// /files/:id — single file detail.
//
// The backend's GET /files/:id returns a FileDetail (with a 5-minute signed
// download URL), which we use directly for both the big preview AND the
// metadata panel. That avoids a follow-up GET /files/:id/download-url round
// trip — the controller exposes the redirect endpoint as a fallback (e.g.
// for share-link landing pages), but for the in-app detail view we have
// the URL inline.
//
// Three render branches:
//   1. Loading        — initial skeleton.
//   2. Not-found      — 404 from the backend.
//   3. Loaded         — preview + meta + actions.
// ---------------------------------------------------------------------------

export default function FileDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const router = useRouter();

  const [file, setFile] = useState<FileDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    setNotFound(false);
    try {
      const data = await getFile(id);
      setFile(data);
    } catch (err) {
      const message = toErrorMessage(err);
      if (err instanceof ApiError && err.status === 404) {
        setNotFound(true);
      } else {
        setLoadError(message);
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleDelete() {
    if (!file || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await archiveFile(file.id);
      router.replace('/files');
    } catch (err) {
      setDeleteError(toErrorMessage(err));
      setDeleting(false);
      setConfirming(false);
    }
  }

  // --------------------------------------------------- render branches

  if (loading) {
    return (
      <div>
        <div className="h-4 w-24 animate-pulse rounded bg-line" />
        <div className="mt-9 grid grid-cols-1 gap-8 lg:grid-cols-[2fr_1fr]">
          <div className="aspect-[4/3] animate-pulse rounded-lg border border-line bg-white" />
          <div className="space-y-3">
            <div className="h-6 animate-pulse rounded bg-line" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-line" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-line" />
          </div>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div>
        <Link
          href="/files"
          className="rounded text-[13px] font-medium text-teal-600 transition-colors hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
        >
          ← 返回文件列表
        </Link>
        <h1 className="mt-9 text-[26px] font-semibold leading-tight tracking-tight text-ink">
          文件不存在
        </h1>
        <p className="mt-2 text-[13px] text-ink-muted">
          这条文件可能已被归档删除，或链接已失效。
        </p>
        <Link
          href="/files"
          className="mt-6 inline-flex h-11 items-center justify-center rounded-md bg-teal-500 px-6 text-[15px] font-medium text-white transition-colors hover:bg-teal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
        >
          返回文件列表
        </Link>
      </div>
    );
  }

  if (loadError) {
    return (
      <div>
        <Link
          href="/files"
          className="rounded text-[13px] font-medium text-teal-600 transition-colors hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
        >
          ← 返回文件列表
        </Link>
        <h1 className="mt-9 text-[26px] font-semibold leading-tight tracking-tight text-ink">
          加载失败
        </h1>
        <p
          role="alert"
          className="mt-4 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-[13px] leading-5 text-red-600"
        >
          {loadError}
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-4 rounded text-[13px] font-medium text-teal-600 transition-colors hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
        >
          重试
        </button>
      </div>
    );
  }

  if (!file) return null;

  const dimLabel =
    file.width && file.height ? `${file.width} × ${file.height}` : null;

  return (
    <div>
      {/* ------------------------------------------------------- header */}
      <div className="flex items-center justify-between">
        <Link
          href="/files"
          className="rounded text-[13px] font-medium text-teal-600 transition-colors hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
        >
          ← 返回文件列表
        </Link>
        <div className="flex items-center gap-4 text-[13px]">
          <a
            href={file.downloadUrl}
            download={file.filename}
            className="inline-flex h-9 items-center rounded-md bg-teal-500 px-4 font-medium text-white transition-colors hover:bg-teal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
          >
            下载
          </a>
          <button
            type="button"
            onClick={() => {
              setConfirming(true);
              setDeleteError(null);
            }}
            className="text-ink-muted transition-colors hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
          >
            删除
          </button>
        </div>
      </div>

      {/* --------------------------------------------------------- main */}
      <div className="mt-9 grid grid-cols-1 gap-8 lg:grid-cols-[2fr_1fr]">
        {/* ---- preview ---- */}
        <div className="overflow-hidden rounded-lg border border-line bg-white">
          {file.isImage ? (
            // OSS signed URLs are short-lived; deliberately bypass
            // next/image so we don't pay an extra server hop.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={file.downloadUrl}
              alt={file.filename}
              className="block max-h-[640px] w-full object-contain"
            />
          ) : (
            <div className="flex aspect-[4/3] flex-col items-center justify-center gap-3 bg-line/30 text-ink-muted">
              <FileTypeIcon
                contentType={file.contentType}
                className="h-16 w-16"
              />
              <p className="text-[13px]">
                预览不可用，请点击右上角「下载」获取文件
              </p>
            </div>
          )}
        </div>

        {/* ---- meta panel ---- */}
        <div className="rounded-lg border border-line bg-white p-5">
          <h1 className="break-all text-[20px] font-semibold leading-tight tracking-tight text-ink">
            {file.filename || '（无文件名）'}
          </h1>
          <p className="mt-1 text-[12px] text-ink-muted">
            上传于 {formatDate(file.createdAt)} ·{' '}
            {file.archivedAt ? (
              <span className="text-red-600">已归档</span>
            ) : (
              <span className="text-teal-600">活跃</span>
            )}
          </p>

          <dl className="mt-6 space-y-3 text-[13px]">
            <MetaRow label="类型" value={file.contentType} />
            <MetaRow label="大小" value={formatSize(file.size)} />
            {dimLabel ? <MetaRow label="尺寸" value={dimLabel} /> : null}
            <MetaRow label="更新于" value={formatDate(file.updatedAt)} />
            <MetaRow label="OSS Key" value={file.ossKey} mono />
          </dl>
        </div>
      </div>

      {/* ---------------------------------------------- delete-confirm */}
      {confirming ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="file-detail-archive-title"
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 px-4 py-6 sm:items-center"
          onClick={() => !deleting && setConfirming(false)}
        >
          <div
            className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3
              id="file-detail-archive-title"
              className="text-[16px] font-semibold tracking-tight text-ink"
            >
              删除这个文件？
            </h3>
            <p className="mt-2 text-[13px] leading-5 text-ink-muted">
              「{file.filename || '（无文件名）'}」将移到「已归档」列表，并在
              OSS 中清理原始文件。
            </p>
            {deleteError ? (
              <p
                role="alert"
                className="mt-3 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-[13px] leading-5 text-red-600"
              >
                {deleteError}
              </p>
            ) : null}
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => !deleting && setConfirming(false)}
                disabled={deleting}
                className="rounded text-[13px] text-ink-muted transition-colors hover:text-ink disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={deleting}
                aria-busy={deleting || undefined}
                className="inline-flex h-9 items-center justify-center rounded-md bg-red-500 px-4 text-[13px] font-medium text-white transition-colors hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deleting ? '删除中…' : '删除'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface MetaRowProps {
  label: string;
  value: string;
  mono?: boolean;
}

function MetaRow({ label, value, mono }: MetaRowProps) {
  return (
    <div className="flex items-start gap-3">
      <dt className="w-16 shrink-0 text-ink-muted">{label}</dt>
      <dd
        className={[
          'min-w-0 flex-1 break-all text-ink',
          mono ? 'font-mono text-[12px] text-ink-soft' : '',
        ].join(' ')}
      >
        {value}
      </dd>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024;
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  }
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}
