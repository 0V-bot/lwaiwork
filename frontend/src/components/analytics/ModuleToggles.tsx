'use client';

import {
  ANALYTICS_SERIES_META,
  type AnalyticsSeries,
} from '@/types';
import type { EnabledSeries } from './SeriesChart';

/**
 * Five-chip toggles for the per-series on/off flags. Drives the
 * LineChart / BarChart visibility without re-fetching data.
 *
 *   * Click a chip to flip its `enabled` flag.
 *   * At least one chip must remain checked - the page enforces this
 *     by disabling the last active chip rather than letting the user
 *     render a blank chart.
 */

type SeriesKey = keyof AnalyticsSeries;
const SERIES_ORDER: readonly SeriesKey[] = [
  'todosCompleted',
  'habitsChecked',
  'notesCreated',
  'filesUploaded',
  'schedulesFired',
];

interface ModuleTogglesProps {
  enabled: EnabledSeries;
  onChange: (next: EnabledSeries) => void;
}

export function ModuleToggles({ enabled, onChange }: ModuleTogglesProps) {
  function toggle(key: SeriesKey) {
    const activeCount = SERIES_ORDER.filter((k) => enabled[k]).length;
    if (enabled[key] && activeCount <= 1) {
      // Last active chip - refuse to disable so the chart doesn't render
      // blank. The user can still flip it via the "All / None" shortcut.
      return;
    }
    onChange({ ...enabled, [key]: !enabled[key] });
  }

  function setAll(value: boolean) {
    onChange({
      todosCompleted: value,
      habitsChecked: value,
      notesCreated: value,
      filesUploaded: value,
      schedulesFired: value,
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[12px] text-ink-muted">显示指标</span>
      {SERIES_ORDER.map((key) => {
        const meta = ANALYTICS_SERIES_META[key];
        const isOn = enabled[key];
        return (
          <button
            key={key}
            type="button"
            onClick={() => toggle(key)}
            aria-pressed={isOn}
            className={[
              'inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-[12.5px] transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40',
              isOn
                ? 'border-transparent text-white'
                : 'border-line bg-white text-ink-soft hover:border-teal-300',
            ].join(' ')}
            style={isOn ? { backgroundColor: meta.hex } : undefined}
          >
            <span
              aria-hidden
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: isOn ? '#ffffff' : meta.hex }}
            />
            {meta.label}
          </button>
        );
      })}
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => setAll(true)}
          className="rounded text-[12px] text-ink-muted transition-colors hover:text-teal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
        >
          全选
        </button>
        <span className="text-[12px] text-ink-muted">/</span>
        <button
          type="button"
          onClick={() => setAll(false)}
          className="rounded text-[12px] text-ink-muted transition-colors hover:text-teal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
        >
          清空
        </button>
      </div>
    </div>
  );
}
