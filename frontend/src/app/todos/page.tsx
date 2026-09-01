'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { AuthGuard } from '@/components/AuthGuard';
import { TodoItem } from '@/components/TodoItem';
import { useAuth } from '@/contexts/AuthContext';
import { api, toErrorMessage } from '@/lib/api';
import type { Paginated, Todo } from '@/types';

type Filter = 'all' | 'active' | 'done';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'active', label: '待完成' },
  { key: 'done', label: '已完成' },
];

// Backend default is 20 and the hard max is 100 (QueryTodosDto @Max(100)).
// Milestone 1 has no pagination UI yet, so we take one big page.
const PAGE_LIMIT = 100;

export default function TodosPage() {
  return (
    <AuthGuard>
      <TodosScreen />
    </AuthGuard>
  );
}

function TodosScreen() {
  const { user, logout } = useAuth();

  const [todos, setTodos] = useState<Todo[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [title, setTitle] = useState('');

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextFilter: Filter) => {
    setLoading(true);
    setError(null);
    try {
      // `done` is omitted for "all" so the backend applies no filter at all.
      const query =
        nextFilter === 'all' ? { limit: PAGE_LIMIT } : { limit: PAGE_LIMIT, done: nextFilter === 'done' };

      const result = await api.get<Paginated<Todo>>('/todos', { query });
      setTodos(result.data);
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  const doneCount = useMemo(() => todos.filter((todo) => todo.done).length, [todos]);
  const progress = todos.length === 0 ? 0 : Math.round((doneCount / todos.length) * 100);

  async function handleAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = title.trim();
    if (!value || submitting) return;

    setError(null);
    setSubmitting(true);
    try {
      const created = await api.post<Todo>('/todos', { title: value });
      // A brand-new todo is never done, so it must not appear under "已完成".
      setTodos((prev) => (filter === 'done' ? prev : [created, ...prev]));
      setTitle('');
    } catch (err) {
      setError(toErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggle(todo: Todo) {
    const nextDone = !todo.done;

    // Optimistic: flip locally, roll back if the PATCH fails.
    setTodos((prev) =>
      prev.map((item) => (item.id === todo.id ? { ...item, done: nextDone } : item)),
    );
    setError(null);

    try {
      const updated = await api.patch<Todo>(`/todos/${todo.id}`, { done: nextDone });
      if (filter === 'all') {
        setTodos((prev) => prev.map((item) => (item.id === todo.id ? updated : item)));
      } else {
        // Under a filtered view the row no longer belongs here - refetch so
        // the list matches what the server would return.
        await load(filter);
      }
    } catch (err) {
      setTodos((prev) => prev.map((item) => (item.id === todo.id ? todo : item)));
      setError(toErrorMessage(err));
    }
  }

  async function handleDelete(todo: Todo) {
    const snapshot = todos;

    setTodos((prev) => prev.filter((item) => item.id !== todo.id));
    setError(null);

    try {
      await api.del<{ message: string }>(`/todos/${todo.id}`);
    } catch (err) {
      setTodos(snapshot);
      setError(toErrorMessage(err));
    }
  }

  return (
    <div className="min-h-screen bg-white">
      {/* ---------------------------------------------------------- app bar */}
      <header className="border-b border-line">
        <div className="mx-auto flex h-16 w-full max-w-2xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-teal-500">
              <svg viewBox="0 0 32 32" className="h-3.5 w-3.5" aria-hidden>
                <path
                  d="M9 16.8l4.2 4.2L23 11.2"
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="text-[15px] font-semibold tracking-tight text-ink">lwaiwork</span>
          </div>

          <div className="flex items-center gap-4">
            <span className="hidden text-[13px] text-ink-muted sm:inline">{user?.email}</span>
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded text-[13px] text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
            >
              退出
            </button>
          </div>
        </div>
      </header>

      {/* ------------------------------------------------------------ body */}
      <main className="mx-auto w-full max-w-2xl px-6 pb-24 pt-12">
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-ink">
          今天要做的事
        </h1>

        <div className="mt-3 flex items-center gap-3">
          <span className="text-[13px] text-ink-muted">
            {todos.length === 0 ? '暂无事项' : `已完成 ${doneCount} / ${todos.length}`}
          </span>
          <span className="h-1 flex-1 overflow-hidden rounded-full bg-line">
            <span
              className="block h-full rounded-full bg-teal-500 transition-[width] duration-300"
              style={{ width: `${progress}%` }}
            />
          </span>
        </div>

        {/* ------------------------------------------------------- add form */}
        <form onSubmit={handleAdd} className="mt-9 flex items-center gap-3">
          <input
            className="underline-input flex-1"
            placeholder="添加一件事，回车即可"
            value={title}
            maxLength={255}
            onChange={(event) => setTitle(event.target.value)}
            aria-label="新的待办标题"
          />
          <button
            type="submit"
            disabled={submitting || title.trim().length === 0}
            className="shrink-0 rounded text-[14px] font-medium text-teal-600 transition-colors hover:text-teal-700 disabled:cursor-not-allowed disabled:text-ink-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
          >
            {submitting ? '添加中…' : '添加'}
          </button>
        </form>

        {/* ------------------------------------------------------- filters */}
        <nav className="mt-8 flex items-center gap-6 border-b border-line">
          {FILTERS.map((item) => {
            const active = item.key === filter;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setFilter(item.key)}
                aria-current={active ? 'page' : undefined}
                className={[
                  '-mb-px border-b-2 pb-2.5 text-[13px] transition-colors focus-visible:outline-none',
                  active
                    ? 'border-teal-500 font-medium text-ink'
                    : 'border-transparent text-ink-muted hover:text-ink',
                ].join(' ')}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* -------------------------------------------------------- errors */}
        {error ? (
          <p
            role="alert"
            className="mt-6 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-[13px] leading-5 text-red-600"
          >
            {error}
          </p>
        ) : null}

        {/* ---------------------------------------------------------- list */}
        {loading ? (
          <div className="mt-6 space-y-4" aria-busy>
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex items-center gap-3">
                <span className="h-[18px] w-[18px] animate-pulse rounded-full bg-line" />
                <span className="h-3 flex-1 animate-pulse rounded bg-line" />
              </div>
            ))}
          </div>
        ) : todos.length === 0 ? (
          <p className="mt-10 text-[14px] leading-6 text-ink-muted">
            {filter === 'done'
              ? '还没有已完成的事项。'
              : filter === 'active'
                ? '待办都清空了，很好。'
                : '还没有待办 —— 在上面添加第一件吧。'}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {todos.map((todo) => (
              <TodoItem
                key={todo.id}
                todo={todo}
                onToggle={handleToggle}
                onDelete={handleDelete}
              />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
