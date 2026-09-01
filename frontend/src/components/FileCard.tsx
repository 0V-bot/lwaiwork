'use client';

import { useState } from 'react';

import { FileTypeIcon } from './FileTypeIcon';
import { archiveFile } from '@/lib/files-api';
import { ApiError, toErrorMessage } from '@/lib/api';
import type { FileDetail } from '@/types';

interface FileCardProps {
  file: FileDetail;
  /** Called after a successful delete so the parent can refresh its list. */
  onArchived?: (id: string) => void;
}

/**
 * One tile in the /files grid. Mirrors NoteCard's "quiet white slab" rhythm
 * but with a top-pinned thumbnail and a footer of two text links. Clicking
 * the body navigates to /files/:id; clicking 下载 triggers a direct browser
 * download via the signed OSS URL.
 *
 * Delete uses a confirmation modal (matching the /notes/[id] pattern). On
 * success we optimistically remove the card by calling `onArchived` - the
 * parent decides whether to refetch or splice locally.
 */
export function FileCard({ file, onArchived }: FileCardProps) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function handleDownload(event: React.MouseEvent<HTMLAnchorElement>) {
    // Let the browser handle the download naturally. OSS returns a 5-minute
    // signed URL with `Content-Disposition` when ?response-content-disposition
    // is on the signature, but the signed URL itself is enough - the browser
    // detects the binary content type and downloads it as `<ossKey>` if the
    // user has "ask where to save each file" off.
    //
    // We DO want the file to keep its original filename, not the OSS key, so
    // we add the inline anchor `download` attribute. If the response happens
    // to set Content-Disposition with another filename, the browser honours
    // that instead - either way the user gets the file.
    event.stopPropagation();
    // No-op: letting the <a> navigate is exactly what we want.
  }

  async function handleDelete(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await archiveFile(file.id);
      setConfirming(false);
      onArchived?.(file.id);
    } catch (err) {
      const message =
        err instanceof ApiError && err.status === 404
          ? '文件已被其他人删除，列表即将刷新。'
          : toErrorMessage(err);
      setDeleteError(message);
    } finally {
      setDeleting(false);
    }
  }

  const dimLabel =
    file.width && file.height ? `${file.width} × ${file.height}` : null;

  return (
    <>
      <article className="group relative flex flex-col overflow-hidden rounded-lg border border-line bg-white transition-colors hover:border-teal-300">
        {/* ---- thumbnail / icon block ---- */}
        <a
          href={`/files/${file.id}`}
          aria-label={`查看「${file.filename}」详情`}
          className="relative block aspect-[4/3] overflow-hidden bg-line/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
        >
          {file.isImage && file.downloadUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- OSS signed
            // URLs are short-lived and untrusted for next/image's optimiser.
            <img
              src={file.downloadUrl}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-ink-muted">
              <FileTypeIcon contentType={file.contentType} className="h-10 w-10" />
            </span>
          )}
          {file.archivedAt ? (
            <span className="absolute right-2 top-2 inline-flex items-center rounded-full bg-ink/80 px-2 py-0.5 text-[11px] font-medium text-white">
              已归档
            </span>
          ) : null}
        </a>

        {/* ---- meta block ---- */}
        <div className="flex flex-1 flex-col gap-1 p-3.5">
          <a
            href={`/files/${file.id}`}
            className="block truncate text-[14px] font-medium tracking-tight text-ink hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
          >
            {file.filename || '（无文件名）'}
          </a>
          <div className="flex items-center gap-1.5 text-[12px] text-ink-muted">
            <span className="truncate">{formatSize(file.size)}</span>
            <span aria-hidden>·</span>
            <span className="truncate">
              {file.isImage && dimLabel
                ? dimLabel
                : file.contentType.split('/')[1]?.toUpperCase() ?? '文件'}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-2 text-[11.5px] text-ink-muted">
            <span>{formatRelativeTime(file.updatedAt)}</span>
          </div>

          {/* ---- actions ---- */}
          <div className="mt-3 flex items-center justify-end gap-1 border-t border-line pt-2.5 text-[12.5px]">
            <a
              href={file.downloadUrl}
              download={file.filename}
              onClick={handleDownload}
              className="inline-flex h-7 items-center rounded px-2 font-medium text-teal-600 transition-colors hover:bg-teal-50 hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
            >
              下载
            </a>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setConfirming(true);
                setDeleteError(null);
              }}
              className="inline-flex h-7 items-center rounded px-2 font-medium text-ink-muted transition-colors hover:bg-red-50 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
            >
              删除
            </button>
          </div>
        </div>
      </article>

      {confirming ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="file-archive-title"
          className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 px-4 py-6 sm:items-center"
          onClick={() => !deleting && setConfirming(false)}
        >
          <div
            className="w-full max-w-sm rounded-lg bg-white p-5 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3
              id="file-archive-title"
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
                onClick={handleDelete}
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
    </>
  );
}

// ---------------------------------------------------------------------------
// Local helpers (kept module-local so they tree-shake out if FileCard
// stops being rendered).

/** "1.2 MB" / "456 KB" — matches the rest of the app's density. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) {
    const kb = bytes / 1024;
    return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  }
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** "今天 / 昨天 / YYYY-MM-DD" - same convention as NoteCard. */
function formatRelativeTime(iso: string): string {
  const updated = new Date(iso);
  if (Number.isNaN(updated.getTime())) return '';
  const now = new Date();

  const sameDay =
    updated.getFullYear() === now.getFullYear() &&
    updated.getMonth() === now.getMonth() &&
    updated.getDate() === now.getDate();
  if (sameDay) return '今天';

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const sameYesterday =
    updated.getFullYear() === yesterday.getFullYear() &&
    updated.getMonth() === yesterday.getMonth() &&
    updated.getDate() === yesterday.getDate();
  if (sameYesterday) return '昨天';

  const yyyy = updated.getFullYear();
  const mm = String(updated.getMonth() + 1).padStart(2, '0');
  const dd = String(updated.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}
