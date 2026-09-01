'use client';

import type { AnalyticsRange } from '@/types';

/**
 * Range picker (7d / 30d / 90d). Single-selection chip group; the page
 * owns the state and re-fetches when the value changes.
 */

const OPTIONS: Array<{ value: AnalyticsRange; label: string }> = [
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
  { value: '90d', label: '近 90 天' },
];

interface RangePickerProps {
  value: AnalyticsRange;
  onChange: (next: AnalyticsRange) => void;
  disabled?: boolean;
}

export function RangePicker({ value, onChange, disabled }: RangePickerProps) {
  return (
    <div
      role="radiogroup"
      aria-label="时间窗口"
      className="inline-flex overflow-hidden rounded-md border border-line bg-white"
    >
      {OPTIONS.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={[
              'h-8 px-3 text-[12.5px] transition-colors focus-visible:outline-none',
              'focus-visible:ring-2 focus-visible:ring-teal-500/40',
              active
                ? 'bg-teal-500 font-medium text-white'
                : 'text-ink-soft hover:bg-line/60',
              disabled ? 'cursor-not-allowed opacity-50' : '',
            ].join(' ')}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
