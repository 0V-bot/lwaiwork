'use client';

import { memo } from 'react';

import type { Todo } from '@/types';

interface TodoItemProps {
  todo: Todo;
  /** Fired with the id when the user confirms deletion. */
  onToggle: (todo: Todo) => void;
  onDelete: (todo: Todo) => void;
}

function TodoItemBase({ todo, onToggle, onDelete }: TodoItemProps) {
  return (
    <li className="group flex items-start gap-3 py-3.5">
      <button
        type="button"
        onClick={() => onToggle(todo)}
        role="checkbox"
        aria-checked={todo.done}
        aria-label={todo.done ? `将「${todo.title}」标记为未完成` : `将「${todo.title}」标记为已完成`}
        className={[
          'mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40',
          todo.done
            ? 'border-teal-500 bg-teal-500 text-white'
            : 'border-line bg-white hover:border-teal-400',
        ].join(' ')}
      >
        {todo.done ? (
          <svg viewBox="0 0 32 32" className="h-2.5 w-2.5" aria-hidden>
            <path
              d="M9 16.8l4.2 4.2L23 11.2"
              fill="none"
              stroke="currentColor"
              strokeWidth="5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
      </button>

      <span
        className={[
          'flex-1 text-[15px] leading-6 transition-colors',
          todo.done ? 'text-ink-muted line-through' : 'text-ink',
        ].join(' ')}
      >
        {todo.title}
      </span>

      <button
        type="button"
        onClick={() => onDelete(todo)}
        aria-label={`删除「${todo.title}」`}
        className={[
          'shrink-0 rounded px-1 text-[13px] leading-6 text-ink-muted transition',
          'opacity-0 hover:text-red-600 focus-visible:opacity-100 focus-visible:outline-none',
          'group-hover:opacity-100',
        ].join(' ')}
      >
        删除
      </button>
    </li>
  );
}

/**
 * memo'd because the list can get long and a single optimistic toggle
 * currently re-renders the whole array.
 */
export const TodoItem = memo(TodoItemBase);
