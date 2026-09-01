'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { FileUploader } from '@/components/FileUploader';
import type { FileDetail } from '@/types';

/**
 * /files/upload — full-screen dropzone variant of the uploader.
 *
 * The page is essentially a big landing pad for "drag-and-drop a pile of
 * files in one go". After everything settles we surface a primary
 * "去列表查看" CTA so the user has a single tap back to /files.
 *
 * On the list page the uploader is rendered inline (variant="inline");
 * here we use variant="hero" which expands the dropzone to ~260px tall.
 */
export default function FilesUploadPage() {
  const router = useRouter();
  const [completed, setCompleted] = useState<FileDetail[]>([]);

  const handleComplete = useCallback((files: FileDetail[]) => {
    setCompleted((prev) => [...prev, ...files]);
  }, []);

  return (
    <div>
      {/* ------------------------------------------------------- header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-ink">
            上传文件
          </h1>
          <p className="mt-1.5 text-[13px] text-ink-muted">
            拖拽多个文件到下面区域 — 会按顺序逐个上传，失败的文件会显示在队列里。
          </p>
        </div>
        <Link
          href="/files"
          className="rounded text-[13px] font-medium text-teal-600 transition-colors hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
        >
          ← 返回文件列表
        </Link>
      </div>

      {/* ------------------------------------------------------- dropzone */}
      <div className="mt-9">
        <FileUploader onComplete={handleComplete} variant="hero" />
      </div>

      {/* ----------------------------------------------------- success CTA */}
      {completed.length > 0 ? (
        <div className="mt-12 rounded-lg border border-teal-200 bg-teal-50/40 p-5">
          <p className="text-[14px] font-medium tracking-tight text-ink">
            已上传 {completed.length} 个文件
          </p>
          <p className="mt-1 text-[13px] text-ink-muted">
            去列表查看，或继续往上面拖更多文件。
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => router.push('/files')}
              className="inline-flex h-11 items-center justify-center rounded-md bg-teal-500 px-6 text-[15px] font-medium text-white transition-colors hover:bg-teal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
            >
              去列表查看
            </button>
            <button
              type="button"
              onClick={() => setCompleted([])}
              className="rounded text-[13px] text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
            >
              继续上传
            </button>
          </div>
          {completed.length > 0 ? (
            <ul className="mt-4 space-y-1 text-[13px]">
              {completed.map((file) => (
                <li key={file.id} className="truncate text-ink-muted">
                  · {file.filename}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
