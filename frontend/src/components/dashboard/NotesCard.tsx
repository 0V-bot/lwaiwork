'use client';

import Link from 'next/link';

import type { DashboardNoteSummary } from '@/types';
import { CardShell, EmptyLine } from './CardShell';

/**
 * Recent-notes card on the dashboard.
 *
 * Compact: title + ~80-char preview (single-line clamp) + tag chips.
 * Whole row navigates to /notes/:id.
 */

interface NotesCardProps {
  notes: DashboardNoteSummary[];
}

const VISIBLE_TAGS = 3;

export function NotesCard({ notes }: NotesCardProps) {
  return (
    <CardShell title="最近笔记" href="/notes" linkLabel="笔记">
      {notes.length === 0 ? (
        <EmptyLine text="最近 7 天还没有新笔记" />
      ) : (
        <ul className="divide-y divide-line">
          {notes.map((note) => (
            <li key={note.id} className="py-2.5 first:pt-0 last:pb-0">
              <Link
                href={`/notes/${note.id}`}
                className="group flex flex-col gap-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
              >
                <span className="flex items-start justify-between gap-3">
                  <span className="truncate text-[14px] text-ink group-hover:text-teal-700">
                    {note.title || '（无标题）'}
                  </span>
                  <TimeLabel iso={note.updatedAt} />
                </span>
                {note.preview ? (
                  <span className="block truncate text-[12.5px] text-ink-muted">
                    {note.preview}
                  </span>
                ) : null}
                {note.tags.length > 0 ? (
                  <span className="mt-0.5 flex flex-wrap gap-1">
                    {note.tags.slice(0, VISIBLE_TAGS).map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center rounded-full bg-line px-1.5 py-0.5 text-[11px] text-ink-soft"
                      >
                        {tag}
                      </span>
                    ))}
                    {note.tags.length > VISIBLE_TAGS ? (
                      <span className="text-[11px] text-ink-muted">
                        +{note.tags.length - VISIBLE_TAGS}
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </CardShell>
  );
}

function TimeLabel({ iso }: { iso: string }) {
  const updated = new Date(iso);
  if (Number.isNaN(updated.getTime())) return null;
  const now = new Date();
  const sameDay =
    updated.getFullYear() === now.getFullYear() &&
    updated.getMonth() === now.getMonth() &&
    updated.getDate() === now.getDate();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const sameYesterday =
    updated.getFullYear() === yesterday.getFullYear() &&
    updated.getMonth() === yesterday.getMonth() &&
    updated.getDate() === yesterday.getDate();
  let label: string;
  if (sameDay) label = '今天';
  else if (sameYesterday) label = '昨天';
  else {
    const yyyy = updated.getFullYear();
    const mm = String(updated.getMonth() + 1).padStart(2, '0');
    const dd = String(updated.getDate()).padStart(2, '0');
    label = `${mm}-${dd}`;
    // Years other than the current one deserve a 4-digit prefix.
    if (updated.getFullYear() !== now.getFullYear()) label = `${yyyy}-${label}`;
  }
  return <span className="shrink-0 text-[11.5px] text-ink-muted">{label}</span>;
}
