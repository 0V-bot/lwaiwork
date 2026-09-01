'use client';

import Link from 'next/link';

import type { DashboardScheduleInstance } from '@/types';
import { CardShell, EmptyLine } from './CardShell';

/**
 * Today's schedule events card on the dashboard.
 *
 * Compact variant of EventCard: time-block on the left, title + meta
 * on the right. Each row links to /schedules/:id?at=<instanceStartAt>
 * so the detail page knows which occurrence was clicked (mirrors the
 * URL contract from /schedules/search).
 */

interface EventsCardProps {
  events: DashboardScheduleInstance[];
}

export function EventsCard({ events }: EventsCardProps) {
  return (
    <CardShell title="今日日程" href="/schedules" linkLabel="日程">
      {events.length === 0 ? (
        <EmptyLine text="今天没有安排" />
      ) : (
        <ul className="divide-y divide-line">
          {events.map((event) => (
            <li key={`${event.scheduleId}-${event.instanceStartAt}`} className="py-2.5 first:pt-0 last:pb-0">
              <Link
                href={`/schedules/${event.scheduleId}?at=${encodeURIComponent(event.instanceStartAt)}`}
                className="group flex items-start gap-3 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
              >
                <TimeBlock event={event} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] text-ink group-hover:text-teal-700">
                    {event.title}
                  </span>
                  <MetaRow event={event} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </CardShell>
  );
}

function TimeBlock({ event }: { event: DashboardScheduleInstance }) {
  if (event.allDay) {
    return (
      <span className="mt-0.5 inline-flex h-7 w-[78px] shrink-0 items-center text-[12px] uppercase tracking-wide text-ink-muted">
        全天
      </span>
    );
  }
  const start = new Date(event.instanceStartAt);
  const end = event.endAt ? new Date(event.endAt) : null;
  return (
    <span className="mt-0.5 w-[78px] shrink-0 text-[12.5px] leading-5 tracking-tight text-ink-soft">
      {formatHm(start)}
      {end ? `–${formatHm(end)}` : ''}
    </span>
  );
}

function MetaRow({ event }: { event: DashboardScheduleInstance }) {
  const parts: string[] = [];
  if (event.location) parts.push(event.location);
  if (event.isOverride) parts.push('已修改');
  if (parts.length === 0) return null;
  return (
    <span className="mt-0.5 block truncate text-[12px] text-ink-muted">
      {parts.join(' · ')}
    </span>
  );
}

function formatHm(d: Date): string {
  if (Number.isNaN(d.getTime())) return '—';
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mi}`;
}
