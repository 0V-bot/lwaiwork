'use client';

import Link from 'next/link';
import type { MouseEvent } from 'react';

import type { NoteSummary } from '@/types';

interface NoteCardProps {
  note: NoteSummary;
  /** Called on click in addition to navigation - useful for the search page
   *  to keep the query params reflected in the URL after drill-down. */
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
  /** When provided, the "active tag" pill in the card linkifies to itself. */
  highlightTag?: string;
}

/**
 * One row in the /notes grid. Renders:
 *   * The note's color as a 4px-wide vertical bar on the left edge so the
 *     card stays a quiet white slab but every note keeps its visual identity.
 *   * Decrypted title (single line, ellipsis).
 *   * The server-trimmed ~200-char preview (multi-line clamp at 3 lines).
 *   * Up to 4 visible tag chips.
 *   * Relative timestamp bottom-right: 今天 / 昨天 / YYYY-MM-DD.
 *
 * The entire card is a Link to /notes/:id so deep-linking and middle-click
 * both work without extra wiring.
 */
export function NoteCard({ note, onClick, highlightTag }: NoteCardProps) {
  const timeLabel = formatNoteTime(note.updatedAt);
  const visibleTags = note.tags.slice(0, 4);
  const hiddenTags = note.tags.length - visibleTags.length;

  return (
    <Link
      href={`/notes/${note.id}`}
      onClick={onClick}
      className="group relative flex gap-3 rounded-lg border border-line bg-white p-4 transition-colors hover:border-teal-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
    >
      {/* ---- color bar ---- */}
      <span
        aria-hidden
        className="absolute inset-y-3 left-0 w-1 rounded-r-full"
        style={{ backgroundColor: note.color }}
      />

      <div className="min-w-0 flex-1 pl-2">
        <div className="flex items-start justify-between gap-3">
          <h3 className="truncate text-[15px] font-medium tracking-tight text-ink">
            {note.title || '（无标题）'}
          </h3>
          <span className="shrink-0 text-[12px] text-ink-muted">
            {timeLabel}
          </span>
        </div>

        {note.preview ? (
          <p className="mt-1.5 line-clamp-3 text-[13px] leading-5 text-ink-muted">
            {note.preview}
          </p>
        ) : (
          <p className="mt-1.5 text-[13px] italic text-ink-muted/70">
            （空白笔记）
          </p>
        )}

        {note.tags.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {visibleTags.map((tag) => {
              const isHighlight = highlightTag === tag;
              return (
                <span
                  key={tag}
                  className={[
                    'inline-flex items-center rounded-full px-2 py-0.5 text-[11px]',
                    isHighlight
                      ? 'bg-teal-500 text-white'
                      : 'bg-line text-ink-soft',
                  ].join(' ')}
                >
                  {tag}
                </span>
              );
            })}
            {hiddenTags > 0 ? (
              <span className="text-[11px] text-ink-muted">
                +{hiddenTags}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </Link>
  );
}

/**
 * "今天 / 昨天 / YYYY-MM-DD" - matches the read-rhythm users get on
 * the habit / todo lists. Comparison is in local time; the input is
 * an ISO string in UTC so we let JS normalise and compare the day.
 */
function formatNoteTime(iso: string): string {
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
