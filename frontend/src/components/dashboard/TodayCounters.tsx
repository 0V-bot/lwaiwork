'use client';

import Link from 'next/link';

import type { DashboardCounts } from '@/types';

/**
 * Top-of-page number tiles for the dashboard.
 *
 * Five tiles, each a clickable shortcut to the corresponding module:
 *   * 待办   -> /todos
 *   * 习惯   -> /habits (shows "done / tracked" today)
 *   * 日程   -> /schedules
 *   * 笔记   -> /notes
 *   * 文件   -> /files
 *
 * The tiles use the same border + white-slab palette as NoteCard /
 * EventCard so the page reads as a single visual unit.
 */

interface TodayCountersProps {
  counts: DashboardCounts;
}

export function TodayCounters({ counts }: TodayCountersProps) {
  const tiles: TileProps[] = [
    {
      href: '/todos',
      label: '待办',
      primary: String(counts.todosOpen),
      primaryLabel: counts.todosOpen === 1 ? '项未完成' : '项未完成',
      accent: 'text-teal-700',
    },
    {
      href: '/habits',
      label: '习惯',
      primary: `${counts.habitsCompletedToday}/${counts.habitsTrackedToday}`,
      primaryLabel: '今日已完成',
      accent: 'text-teal-700',
    },
    {
      href: '/schedules',
      label: '日程',
      primary: String(counts.schedulesToday),
      primaryLabel: counts.schedulesToday === 1 ? '件今天' : '件今天',
      accent: 'text-teal-700',
    },
    {
      href: '/notes',
      label: '笔记',
      primary: String(counts.notesRecent),
      primaryLabel: '近 7 天',
      accent: 'text-ink-soft',
    },
    {
      href: '/files',
      label: '文件',
      primary: String(counts.filesRecent),
      primaryLabel: '近 7 天',
      accent: 'text-ink-soft',
    },
  ];

  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {tiles.map((tile) => (
        <li key={tile.href}>
          <Tile {...tile} />
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------

interface TileProps {
  href: string;
  label: string;
  primary: string;
  primaryLabel: string;
  accent: string;
}

function Tile({ href, label, primary, primaryLabel, accent }: TileProps) {
  return (
    <Link
      href={href}
      className="group flex h-full flex-col justify-between rounded-lg border border-line bg-white p-4 transition-colors hover:border-teal-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
    >
      <span className="text-[12.5px] text-ink-muted">{label}</span>
      <span className="mt-2 flex items-baseline gap-1.5">
        <span className={['text-[26px] font-semibold leading-none tracking-tight', accent].join(' ')}>
          {primary}
        </span>
        <span className="text-[11.5px] text-ink-muted">{primaryLabel}</span>
      </span>
    </Link>
  );
}
