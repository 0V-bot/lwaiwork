'use client';

import type { ChangeEvent } from 'react';

import { SCHEDULE_TIMEZONE_PRESETS } from '@/types';

interface TimezoneSelectProps {
  value: string;
  onChange: (next: string) => void;
  /** Optional input id for label `htmlFor` wiring. */
  id?: string;
  /** Hint copy shown under the field. */
  hint?: string;
  /** Inline error; flips the underline to red. */
  error?: string | null;
}

/**
 * IANA timezone picker.
 *
 * UX: the `<select>` lists the four common presets the brief specified plus a
 * "自定义…" entry. When the current value matches a preset we render that
 * option as selected; otherwise we fall into "自定义…" and show a sibling
 * text input so the user can type any IANA id (e.g. "Europe/Berlin").
 *
 * We deliberately do NOT validate against the OS tz database client-side -
 * the backend's `IANA_TZ_PATTERN` regex is the source of truth. Server errors
 * surface as a 400 on submit, which is fine for an M2 form.
 */
export function TimezoneSelect({
  value,
  onChange,
  id = 'schedule-timezone',
  hint = '使用 IANA id，例如 Asia/Shanghai / Europe/Berlin',
  error,
}: TimezoneSelectProps) {
  const matchesPreset =
    (SCHEDULE_TIMEZONE_PRESETS as readonly string[]).includes(value);

  function handleSelect(event: ChangeEvent<HTMLSelectElement>) {
    const next = event.target.value;
    if (next === '__custom__') {
      // Switch to free-text mode. Leave the value alone (it stays whatever
      // the text input last held); the text input renders below.
      onChange('');
      return;
    }
    onChange(next);
  }

  return (
    <div>
      <label
        htmlFor={id}
        className="block text-[13px] font-medium tracking-tight text-ink-soft"
      >
        时区
      </label>
      <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <select
          id={id}
          value={matchesPreset ? value : '__custom__'}
          onChange={handleSelect}
          aria-invalid={error ? true : undefined}
          className={[
            'h-10 shrink-0 rounded-md border bg-white px-3 text-[14px] text-ink outline-none transition-colors',
            'focus:border-teal-500',
            error ? 'border-red-400 focus:border-red-500' : 'border-line',
          ].join(' ')}
        >
          {SCHEDULE_TIMEZONE_PRESETS.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
          <option value="__custom__">自定义…</option>
        </select>

        {!matchesPreset ? (
          <input
            type="text"
            value={value}
            onChange={(event) => onChange(event.target.value.trim())}
            placeholder="例如 Europe/Berlin"
            spellCheck={false}
            autoComplete="off"
            aria-invalid={error ? true : undefined}
            className={[
              'flex-1 border-0 border-b bg-transparent px-0 py-2.5 text-[15px] text-ink outline-none transition-colors',
              'placeholder:text-ink-muted/50',
              error
                ? 'border-red-400 focus:border-red-500'
                : 'border-line focus:border-teal-500',
            ].join(' ')}
          />
        ) : null}
      </div>
      {error ? (
        <p className="mt-1.5 text-[12px] leading-4 text-red-600">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-[12px] leading-4 text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
}
