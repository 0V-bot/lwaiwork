'use client';

import Link from 'next/link';

import type { DashboardHabitEntry } from '@/types';
import { CardShell, EmptyLine } from './CardShell';

/**
 * Today's habits card on the dashboard.
 *
 * Each row is a clickable chip:
 *   * Left rail: a circular "check" button. Filled teal + ✓ when the
 *     habit has been completed today; outlined circle otherwise. The
 *     button is a navigation target - clicking it deep-links into the
 *     /habits module where the actual toggle lives.
 *   * Body: habit name + a "completed at HH:mm" tag when relevant.
 *
 * We deliberately don't POST a check-in from here: the dashboard must
 * stay a read-only leaf. The user is one click away from /habits.
 */

interface HabitsCardProps {
  habits: DashboardHabitEntry[];
}

export function HabitsCard({ habits }: HabitsCardProps) {
  return (
    <CardShell title="今日习惯" href="/habits" linkLabel="习惯">
      {habits.length === 0 ? (
        <EmptyLine text="还没有习惯，去创建一个吧" />
      ) : (
        <ul className="divide-y divide-line">
          {habits.map((habit) => (
            <li key={habit.id} className="py-2.5 first:pt-0 last:pb-0">
              <Link
                href="/habits"
                className="group flex items-center gap-3 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
              >
                <CheckDot completed={habit.todayCompleted} color={habit.color} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] text-ink group-hover:text-teal-700">
                    {habit.name}
                  </span>
                  <SubLabel habit={habit} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </CardShell>
  );
}

function CheckDot({ completed, color }: { completed: boolean; color: string }) {
  if (completed) {
    return (
      <span
        aria-label="已完成"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-transparent text-white"
        style={{ backgroundColor: color }}
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
          <path
            d="M4 8.5l2.5 2.5L12 5.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    );
  }
  return (
    <span
      aria-label="待打卡"
      className="inline-block h-7 w-7 shrink-0 rounded-full border border-line bg-white"
    />
  );
}

function SubLabel({ habit }: { habit: DashboardHabitEntry }) {
  if (!habit.scheduledToday) {
    return (
      <span className="mt-0.5 block text-[12px] text-ink-muted">
        今天不在打卡周期
      </span>
    );
  }
  if (habit.todayCompleted) {
    const completedAt = habit.completedAt ? new Date(habit.completedAt) : null;
    const timeLabel =
      completedAt && !Number.isNaN(completedAt.getTime())
        ? formatHm(completedAt)
        : '';
    return (
      <span className="mt-0.5 block text-[12px] text-teal-700">
        已打卡{timeLabel ? ` · ${timeLabel}` : ''}
      </span>
    );
  }
  return (
    <span className="mt-0.5 block text-[12px] text-ink-muted">待打卡</span>
  );
}

function formatHm(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mi}`;
}
