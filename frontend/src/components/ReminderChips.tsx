'use client';

import { SCHEDULE_REMINDER_OPTIONS, SCHEDULE_REMINDER_MAX_VAL } from '@/types';

interface ReminderChipsProps {
  value: number[];
  onChange: (next: number[]) => void;
  /** Inline error; flips the active ring to red. */
  error?: string | null;
  /** Hint copy; shown only when there is no error. */
  hint?: string;
}

/**
 * Multi-select chip row for reminder offsets (in minutes BEFORE startAt).
 *
 * The chip set is fixed at the 5 values from the brief (5 / 10 / 15 / 30 /
 * 60). The input is intentionally not a free-form number: the server caps
 * each value at 1 week (we surface that cap in the helper text).
 *
 * Click a chip to toggle. Empty array = "no reminder".
 */
export function ReminderChips({
  value,
  onChange,
  error,
  hint = `提前多少分钟提醒 — 空表示不提醒；单值最大 ${SCHEDULE_REMINDER_MAX_VAL} 分钟。`,
}: ReminderChipsProps) {
  const selected = new Set(value);

  function toggle(min: number) {
    const next = new Set(selected);
    if (next.has(min)) {
      next.delete(min);
    } else {
      next.add(min);
    }
    // Keep chips in the original display order rather than insertion order
    // so the rendered row never jumps around while the user picks.
    const ordered = SCHEDULE_REMINDER_OPTIONS.filter((m) => next.has(m));
    onChange([...ordered]);
  }

  return (
    <div>
      <p className="block text-[13px] font-medium tracking-tight text-ink-soft">
        提醒
      </p>
      <div
        className="mt-2 flex flex-wrap gap-2"
        role="group"
        aria-label="提醒时间"
      >
        {SCHEDULE_REMINDER_OPTIONS.map((min) => {
          const active = selected.has(min);
          const label = min >= 60 ? `1 小时` : `${min} 分钟`;
          return (
            <button
              key={min}
              type="button"
              onClick={() => toggle(min)}
              aria-pressed={active}
              className={[
                'inline-flex h-9 items-center rounded-full border px-3.5 text-[13px] transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40',
                active
                  ? error
                    ? 'border-red-400 bg-red-50 text-red-700'
                    : 'border-teal-500 bg-teal-50 text-teal-700'
                  : 'border-line bg-white text-ink-soft hover:border-teal-300 hover:text-ink',
              ].join(' ')}
            >
              提前 {label}
            </button>
          );
        })}
      </div>
      {error ? (
        <p className="mt-1.5 text-[12px] leading-4 text-red-600">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-[12px] leading-4 text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
}
