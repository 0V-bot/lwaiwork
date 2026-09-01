'use client';

import Link from 'next/link';

import type { DashboardFileSummary } from '@/types';
import { CardShell, EmptyLine } from './CardShell';

/**
 * Recent-files card on the dashboard.
 *
 * Compact grid: 3 columns on desktop, 2 on tablet, 1 on mobile. Each
 * cell shows a coloured tile + filename + size. We don't load
 * thumbnails from OSS here - the dashboard must stay cheap and the
 * signed URLs expire after 5 minutes anyway.
 */

interface FilesCardProps {
  files: DashboardFileSummary[];
}

export function FilesCard({ files }: FilesCardProps) {
  return (
    <CardShell title="最近文件" href="/files" linkLabel="文件">
      {files.length === 0 ? (
        <EmptyLine text="最近 7 天还没有新文件" />
      ) : (
        <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {files.map((file) => (
            <li key={file.id}>
              <Link
                href={`/files/${file.id}`}
                className="group flex flex-col gap-1.5 rounded-md border border-line bg-white p-3 transition-colors hover:border-teal-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
              >
                <ThumbTile file={file} />
                <span className="block truncate text-[13px] text-ink group-hover:text-teal-700">
                  {file.filename}
                </span>
                <span className="block text-[11.5px] text-ink-muted">
                  {formatSize(file.size)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </CardShell>
  );
}

function ThumbTile({ file }: { file: DashboardFileSummary }) {
  const bg = pickSwatch(file.contentType);
  return (
    <span
      aria-hidden
      className="flex h-16 w-full items-center justify-center rounded-md text-[10px] uppercase tracking-wide text-white"
      style={{ backgroundColor: bg }}
    >
      {file.isImage ? '图片' : shortType(file.contentType)}
    </span>
  );
}

/** Tiny palette picker for non-image thumbnails so the grid has variety. */
function pickSwatch(contentType: string): string {
  if (contentType.startsWith('image/')) return '#5B8DEF';
  if (contentType === 'application/pdf') return '#E26D8A';
  if (contentType.startsWith('text/')) return '#2FAF9E';
  if (contentType === 'application/zip') return '#F59E0B';
  if (contentType === 'application/json') return '#8B5CF6';
  return '#47615E';
}

function shortType(contentType: string): string {
  const slash = contentType.indexOf('/');
  if (slash < 0) return contentType.slice(0, 6);
  return contentType.slice(slash + 1, slash + 7);
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
