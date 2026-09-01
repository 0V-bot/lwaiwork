'use client';

import Link from 'next/link';

import type { DashboardOpenTodo } from '@/types';
import { CardShell, EmptyLine } from './CardShell';

/**
 * Open-todos card on the dashboard.
 *
 * Mirrors the row pattern of `TodoItem` (checkbox + title + due label)
 * so the visual rhythm matches the /todos list, just more compact.
 * The whole card body is not a link - each row navigates to its own
 * /todos/:id on click.
 */

interface TodosCardProps {
  todos: DashboardOpenTodo[];
}

export function TodosCard({ todos }: TodosCardProps) {
  return (
    <CardShell title="今日待办" href="/todos" linkLabel="待办">
      {todos.length === 0 ? (
        <EmptyLine text="没有到期的待办" />
      ) : (
        <ul className="divide-y divide-line">
          {todos.map((todo) => (
            <li key={todo.id} className="py-2.5 first:pt-0 last:pb-0">
              <Link
                href={`/todos/${todo.id}`}
                className="flex items-start gap-3 rounded text-left text-[14px] text-ink transition-colors hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
              >
                <span
                  aria-hidden
                  className="mt-1.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border border-line bg-white"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{todo.title}</span>
                  <DueLabel dueAt={todo.dueAt} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </CardShell>
  );
}

function DueLabel({ dueAt }: { dueAt: string | null }) {
  if (!dueAt) return null;
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return null;

  const now = new Date();
  const overdue = due.getTime() < now.getTime();
  const label = formatHm(due);
  const tone = overdue ? 'text-red-600' : 'text-ink-muted';
  return (
    <span className={['mt-0.5 block text-[12px]', tone].join(' ')}>
      {overdue ? `已逾期 · ${label}` : `截止 ${label}`}
    </span>
  );
}

function formatHm(d: Date): string {
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mi}`;
}
