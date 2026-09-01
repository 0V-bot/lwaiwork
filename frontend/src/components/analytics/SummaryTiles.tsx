'use client';

import Link from 'next/link';

import type { AnalyticsSummary } from '@/types';

/**
 * All-time summary tiles.
 *
 * Five giant numbers, one per module. Strips the data down to a
 * headline + a sub-line of secondary stats (e.g. "完成 17 · 未完成 4")
 * so the section communicates even at a glance.
 */

interface SummaryTilesProps {
  summary: AnalyticsSummary;
}

export function SummaryTiles({ summary }: SummaryTilesProps) {
  const tiles: TileProps[] = [
    {
      href: '/todos',
      label: '待办',
      primary: String(summary.totals.todos.total),
      primaryLabel: '项总计',
      accent: 'text-teal-700',
      sub: `完成 ${summary.totals.todos.completed} · 未完成 ${summary.totals.todos.open}`,
    },
    {
      href: '/habits',
      label: '习惯',
      primary: String(summary.totals.habits.total),
      primaryLabel: '个习惯',
      accent: 'text-teal-700',
      sub: `活跃 ${summary.totals.habits.activeDays} 天 · 最长 ${summary.totals.habits.longestStreak} 天连击`,
    },
    {
      href: '/notes',
      label: '笔记',
      primary: String(summary.totals.notes.total),
      primaryLabel: '条笔记',
      accent: 'text-ink-soft',
      sub: `约 ${formatChars(summary.totals.notes.totalChars)} 字符（首页预览长度汇总）`,
    },
    {
      href: '/files',
      label: '文件',
      primary: String(summary.totals.files.total),
      primaryLabel: '个文件',
      accent: 'text-ink-soft',
      sub: `共 ${formatBytes(summary.totals.files.totalBytes)}`,
    },
    {
      href: '/schedules',
      label: '日程',
      primary: String(summary.totals.schedules.total),
      primaryLabel: '条日程',
      accent: 'text-ink-soft',
      sub: `未来 7 天还有 ${summary.totals.schedules.upcoming7d} 件`,
    },
  ];

  return (
    <section aria-labelledby="analytics-summary-title">
      <header className="mb-3 flex items-end justify-between">
        <div>
          <h2
            id="analytics-summary-title"
            className="text-[15px] font-medium tracking-tight text-ink"
          >
            全部时间
          </h2>
          <p className="mt-1 text-[12.5px] text-ink-muted">
            {summary.activeSince
              ? `最早的一条记录在 ${summary.activeSince}`
              : '还没有任何数据'}
          </p>
        </div>
      </header>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map((tile) => (
          <li key={tile.href}>
            <Tile {...tile} />
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------

interface TileProps {
  href: string;
  label: string;
  primary: string;
  primaryLabel: string;
  accent: string;
  sub: string;
}

function Tile({ href, label, primary, primaryLabel, accent, sub }: TileProps) {
  return (
    <Link
      href={href}
      className="group flex h-full flex-col justify-between rounded-lg border border-line bg-white p-4 transition-colors hover:border-teal-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
    >
      <span className="text-[12.5px] text-ink-muted">{label}</span>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span
          className={[
            'text-[28px] font-semibold leading-none tracking-tight',
            accent,
          ].join(' ')}
        >
          {primary}
        </span>
        <span className="text-[11.5px] text-ink-muted">{primaryLabel}</span>
      </div>
      <span className="mt-2 text-[11.5px] leading-[1.4] text-ink-muted">{sub}</span>
    </Link>
  );
}

// ---------------------------------------------------------------------------

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function formatChars(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n < 1024) return `${n}`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} K`;
  return `${(n / (1024 * 1024)).toFixed(1)} M`;
}
