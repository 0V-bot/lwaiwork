'use client';

import {
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react';

import {
  confirmUpload,
  requestUploadTicket,
  uploadFileToOss,
} from '@/lib/files-api';
import { ApiError, toErrorMessage } from '@/lib/api';
import {
  FILE_ACCEPT,
  FILE_FILENAME_MAX_LEN,
  FILE_MAX_SIZE,
  type FileDetail,
} from '@/types';

/**
 * Generic file uploader — renders the file picker / dropzone, the queue of
 * in-flight files (with per-row status), and bubbles the finalised
 * FileDetail[] to the parent via `onComplete` once all uploads settle.
 *
 * Upload flow per file (serialised, see below):
 *   1. requestUploadTicket  → backend signs a 5-min OSS POST policy
 *   2. uploadFileToOss       → browser PUTs multipart body directly to OSS
 *   3. confirmUpload         → backend persists the row from the OSS ETag
 *
 * "Serial" matters: we deliberately don't fire all of them in parallel.
 * The OSS bucket is one tenant's per-user prefix and POST policies carry
 * a content-length-range condition, but signing the policy for a few
 * files at once is cheap and the failure modes (one file's progress
 * getting lost in a wall of spinners) get harder to debug. Sequential
 * keeps the queue view scannable for a typical "select 3-4 files" use.
 *
 * If the user pastes a 100+ file dump the queue still serialises one at
 * a time; we render a small "X / N" counter so they know it's working.
 */

export type FileUploaderStatus =
  | 'pending'
  | 'uploading'
  | 'confirming'
  | 'done'
  | 'error';

export interface QueueItem {
  /** Stable client-side key — `${name}-${size}-${index}`. */
  key: string;
  file: File;
  status: FileUploaderStatus;
  /** Human-readable progress / error message rendered under the filename. */
  message: string;
  /** Result once status === 'done'. */
  detail?: FileDetail;
}

interface FileUploaderProps {
  /** Called with all successfully uploaded files after the queue settles.
   *  Parent usually treats this as a "refetch the list" signal. */
  onComplete?: (files: FileDetail[]) => void;
  /** Optional CSS hook so the parent can change the look (compact vs hero). */
  variant?: 'inline' | 'hero';
  /** Override the file-input accept string (defaults to the module whitelist). */
  accept?: string;
}

export function FileUploader({
  onComplete,
  variant = 'inline',
  accept = FILE_ACCEPT,
}: FileUploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [running, setRunning] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const updateItem = useCallback(
    (key: string, patch: Partial<QueueItem>) => {
      setQueue((prev) =>
        prev.map((item) => (item.key === key ? { ...item, ...patch } : item)),
      );
    },
    [],
  );

  /**
   * Walk the queue serially. We snapshot the current state at call time and
   * mutate via `updateItem` for each file. Errors on a single file don't
   * halt the rest — the user wants to know what DID succeed and what didn't.
   */
  const runQueue = useCallback(
    async (items: QueueItem[]) => {
      setRunning(true);
      const completed: FileDetail[] = [];

      for (const item of items) {
        const { key, file } = item;
        try {
          updateItem(key, { status: 'uploading', message: '正在准备上传…' });
          const ticket = await requestUploadTicket({
            filename: file.name,
            contentType: file.type || 'application/octet-stream',
            size: file.size,
          });

          updateItem(key, { status: 'uploading', message: '正在传输到 OSS…' });
          const { etag } = await uploadFileToOss(ticket, file);

          updateItem(key, { status: 'confirming', message: '正在登记文件…' });

          let width: number | undefined;
          let height: number | undefined;
          if (file.type.startsWith('image/')) {
            const dims = await probeImageDimensions(file).catch(() => null);
            if (dims) {
              width = dims.width;
              height = dims.height;
            }
          }

          const detail = await confirmUpload({
            ossKey: ticket.ossKey,
            etag,
            size: file.size,
            ...(width !== undefined ? { width } : {}),
            ...(height !== undefined ? { height } : {}),
          });

          completed.push(detail);
          updateItem(key, {
            status: 'done',
            message: '上传完成',
            detail,
          });
        } catch (err) {
          const status =
            err instanceof ApiError && err.status === 415
              ? '不被允许的文件类型'
              : err instanceof ApiError && err.status === 413
                ? '文件超过 100 MiB 上限'
                : err instanceof ApiError && err.status === 400
                  ? '上传参数错误'
                  : toErrorMessage(err);
          updateItem(key, {
            status: 'error',
            message: status,
          });
        }
      }

      setRunning(false);
      if (completed.length > 0) onComplete?.(completed);
    },
    [onComplete, updateItem],
  );

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      const accepted: QueueItem[] = [];
      const rejected: { file: File; reason: string }[] = [];

      Array.from(fileList).forEach((file, index) => {
        if (!validateFile(file)) {
          rejected.push({
            file,
            reason: file.size > FILE_MAX_SIZE ? '超过 100 MiB' : '类型不在白名单',
          });
          return;
        }
        accepted.push({
          key: `${file.name}-${file.size}-${file.lastModified}-${index}-${Date.now()}`,
          file,
          status: 'pending',
          message: '排队中…',
        });
      });

      // Append rejected items to the queue so the user can see what was dropped.
      const rejectedAsQueue: QueueItem[] = rejected.map(({ file, reason }, idx) => ({
        key: `rejected-${file.name}-${file.size}-${idx}-${Date.now()}`,
        file,
        status: 'error',
        message: reason,
      }));

      const next = [...queue, ...accepted, ...rejectedAsQueue];
      setQueue(next);

      // Only the newly-accepted items get processed; rejected ones are static.
      if (accepted.length > 0) {
        void runQueue(accepted);
      }
    },
    [queue, runQueue],
  );

  function onPickChange(event: ChangeEvent<HTMLInputElement>) {
    handleFiles(event.target.files);
    // Reset so picking the same file again still fires `change`.
    event.target.value = '';
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragOver(false);
    handleFiles(event.dataTransfer.files);
  }

  function onDragOver(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    if (!dragOver) setDragOver(true);
  }

  function onDragLeave(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragOver(false);
  }

  function clearFinished() {
    setQueue((prev) => prev.filter((item) => item.status === 'pending' || item.status === 'uploading' || item.status === 'confirming'));
  }

  const hasFinished = queue.some((item) => item.status === 'done' || item.status === 'error');
  const activeCount = queue.filter(
    (item) => item.status === 'uploading' || item.status === 'confirming',
  ).length;
  const totalCount = queue.length;

  return (
    <div>
      <label
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={[
          'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed bg-white transition-colors focus-within:border-teal-500',
          variant === 'hero'
            ? 'min-h-[260px] px-8 py-12'
            : 'min-h-[140px] px-6 py-8',
          dragOver
            ? 'border-teal-500 bg-teal-50/40'
            : 'border-line hover:border-teal-300',
        ].join(' ')}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={accept}
          onChange={onPickChange}
          className="sr-only"
        />
        <span
          aria-hidden
          className="flex h-12 w-12 items-center justify-center rounded-full bg-teal-50 text-teal-600"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 4v12M6 10l6-6 6 6" />
            <path d="M5 19h14" />
          </svg>
        </span>
        <p className="mt-3 text-[14px] font-medium tracking-tight text-ink">
          点击选择文件，或拖拽到这里
        </p>
        <p className="mt-1 text-[12px] text-ink-muted">
          支持图片、PDF、文本、Markdown、CSV、JSON、ZIP — 单个文件最大 100 MiB
        </p>
      </label>

      {queue.length > 0 ? (
        <div className="mt-5">
          <div className="flex items-center justify-between text-[12.5px] text-ink-muted">
            <span>
              {running
                ? `上传中（${activeCount} / ${totalCount} 进行中）`
                : `已选择 ${totalCount} 个文件`}
            </span>
            {hasFinished && !running ? (
              <button
                type="button"
                onClick={clearFinished}
                className="rounded text-[12.5px] text-teal-600 transition-colors hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
              >
                清除已完成
              </button>
            ) : null}
          </div>

          <ul className="mt-3 space-y-2">
            {queue.map((item) => (
              <li
                key={item.key}
                className={[
                  'flex items-center gap-3 rounded-md border bg-white px-3 py-2.5 text-[13px]',
                  item.status === 'error'
                    ? 'border-red-200 bg-red-50/40'
                    : 'border-line',
                ].join(' ')}
              >
                <span
                  aria-hidden
                  className={[
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px]',
                    item.status === 'done'
                      ? 'bg-teal-500 text-white'
                      : item.status === 'error'
                        ? 'bg-red-500 text-white'
                        : item.status === 'uploading' ||
                            item.status === 'confirming'
                          ? 'border border-teal-500 border-t-transparent text-transparent'
                          : 'bg-line text-ink-muted',
                  ].join(' ')}
                >
                  {item.status === 'uploading' || item.status === 'confirming' ? (
                    <span
                      aria-hidden
                      className="block h-3 w-3 animate-spin rounded-full border-2 border-teal-500 border-t-transparent"
                    />
                  ) : item.status === 'done' ? (
                    '✓'
                  ) : item.status === 'error' ? (
                    '!'
                  ) : (
                    '·'
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink">{item.file.name}</p>
                  <p
                    className={[
                      'truncate text-[12px]',
                      item.status === 'error' ? 'text-red-600' : 'text-ink-muted',
                    ].join(' ')}
                  >
                    {item.message}
                  </p>
                </div>
                <span className="shrink-0 text-[12px] text-ink-muted">
                  {formatBytes(item.file.size)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Per-file validation. Mirrors the backend whitelist + size cap so the
 * user gets immediate feedback rather than a 4xx in the middle of a
 * multipart PUT.
 */
function validateFile(file: File): boolean {
  if (file.size <= 0) return false;
  if (file.size > FILE_MAX_SIZE) return false;
  if (file.name.length > FILE_FILENAME_MAX_LEN) return false;
  if (!file.type) return false;
  if (file.type === 'application/octet-stream') return false;
  // Anything matching the same top-level prefixes the backend allows.
  const ct = file.type.toLowerCase();
  if (ct.startsWith('image/')) return true;
  if (ct === 'application/pdf') return true;
  if (ct === 'application/json') return true;
  if (ct === 'application/zip') return true;
  if (ct.startsWith('text/')) {
    const allowedSubtypes = new Set(['plain', 'csv', 'markdown']);
    const sub = ct.slice('text/'.length);
    return allowedSubtypes.has(sub);
  }
  return false;
}

/** Probe an image file's pixel dimensions. Used so the backend can store
 *  width/height for image rows (the gallery card reads those to render
 *  the "1920 × 1080" caption under the thumbnail). */
function probeImageDimensions(
  file: File,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth;
      const height = img.naturalHeight;
      URL.revokeObjectURL(url);
      if (width > 0 && height > 0) {
        resolve({ width, height });
      } else {
        reject(new Error('invalid dimensions'));
      }
    };
    img.onerror = (event) => {
      URL.revokeObjectURL(url);
      reject(event instanceof Error ? event : new Error('image load failed'));
    };
    img.src = url;
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
