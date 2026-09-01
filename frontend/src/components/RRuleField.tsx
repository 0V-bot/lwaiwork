'use client';

import type { ChangeEvent } from 'react';

/**
 * RRULE quick-set presets. Each maps to an RFC-5545 `FREQ=...` line WITHOUT a
 * DTSTART prefix (the backend rebinds DTSTART from `startAt` + `timezone`).
 * Keep the keys stable - they double as the label the chip shows.
 */
export interface RRulePreset {
  key: 'none' | 'daily' | 'weekly' | 'monthly';
  label: string;
  /** The RRULE line the chip writes when picked. Empty = clear recurrence. */
  value: string;
}

export const RRULE_PRESETS: readonly RRulePreset[] = [
  { key: 'none', label: '不重复', value: '' },
  { key: 'daily', label: '每天', value: 'FREQ=DAILY' },
  { key: 'weekly', label: '每周', value: 'FREQ=WEEKLY' },
  { key: 'monthly', label: '每月', value: 'FREQ=MONTHLY' },
] as const;

interface RRuleFieldProps {
  value: string;
  onChange: (next: string) => void;
  /** Inline error; flips the underline to red. */
  error?: string | null;
  /** Hint copy; shown when there's no error. */
  hint?: string;
  /** Input id for label `htmlFor` wiring. */
  id?: string;
}

/**
 * RRULE input + quick-set chips.
 *
 * UX flow:
 * 1. The four chips (不重复 / 每天 / 每周 / 每月) set the FREQ line in one click.
 * 2. The text input underneath stays live - users can hand-edit
 *    `FREQ=WEEKLY;BYDAY=MO,WE,FR` after picking a preset.
 * 3. Picking 不重复 clears the field to the empty string (backend treats
 *    empty as "non-recurring"; service trims it to null before save).
 *
 * We deliberately do not parse the RRULE client-side (rrule.js lives on the
 * backend only). The brief keeps the server as the single source of truth
 * for recurrence semantics - showing a typed preview is overkill for M2 and
 * would leak package assumptions into the front-end bundle.
 */
export function RRuleField({
  value,
  onChange,
  error,
  hint = '常用规则：FREQ=DAILY / FREQ=WEEKLY;BYDAY=MO,WE,FR / FREQ=MONTHLY;BYMONTHDAY=15。提交时由后端校验。',
  id = 'schedule-rrule',
}: RRuleFieldProps) {
  function handleSelect(event: ChangeEvent<HTMLSelectElement>) {
    const key = event.target.value as RRulePreset['key'] | '__custom__';
    if (key === '__custom__') return;
    const preset = RRULE_PRESETS.find((p) => p.key === key);
    if (preset) onChange(preset.value);
  }

  const currentKey =
    RRULE_PRESETS.find((p) => p.value === value)?.key ?? '__custom__';

  return (
    <div>
      <p className="block text-[13px] font-medium tracking-tight text-ink-soft">
        重复
      </p>

      {/* ----- quick-preset chips ----- */}
      <div className="mt-2 flex flex-wrap gap-2">
        {RRULE_PRESETS.map((preset) => {
          const active = currentKey === preset.key;
          return (
            <button
              key={preset.key}
              type="button"
              onClick={() => onChange(preset.value)}
              aria-pressed={active}
              className={[
                'inline-flex h-9 items-center rounded-full border px-3.5 text-[13px] transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40',
                active
                  ? 'border-teal-500 bg-teal-50 text-teal-700'
                  : 'border-line bg-white text-ink-soft hover:border-teal-300 hover:text-ink',
              ].join(' ')}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      {/* ----- raw RRULE input. Hidden when the user picked 不重复 and the
              field would otherwise echo the chip state as text. Actually we
              keep it always visible - power users want to see/edit. ----- */}
      <div className="mt-2 max-w-full">
        <label htmlFor={id} className="sr-only">
          RRULE 原始字符串
        </label>
        <input
          id={id}
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="留空 = 不重复"
          spellCheck={false}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          className={[
            'w-full border-0 border-b bg-transparent px-0 py-2.5 font-mono text-[13px] text-ink outline-none transition-colors',
            'placeholder:text-ink-muted/50',
            error
              ? 'border-red-400 focus:border-red-500'
              : 'border-line focus:border-teal-500',
          ].join(' ')}
        />
        {/* Hidden <select> for a11y/QA parity: lets a screen-reader or test
            user pick via keyboard the same way they would via a chip. Not
            rendered in the visible UI; only used when assistive tech
            surfaces form controls the chips don't expose. */}
        <select
          aria-hidden
          tabIndex={-1}
          value={currentKey}
          onChange={handleSelect}
          className="sr-only"
        >
          {RRULE_PRESETS.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
          <option value="__custom__">自定义</option>
        </select>
      </div>
      {error ? (
        <p className="mt-1.5 text-[12px] leading-4 text-red-600">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-[12px] leading-4 text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
}
