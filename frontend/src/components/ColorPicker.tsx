'use client';

interface ColorPickerProps {
  value: string;
  onChange: (next: string) => void;
  /** Default falls back to the curated 6-swatch palette exported from types. */
  options?: readonly string[];
  /** Optional helper copy shown under the swatches (only when no error). */
  hint?: string;
}

/**
 * Hairline colour picker. Mirrors the swatch UX already used by /habits/manage
 * so the visual rhythm stays consistent across modules: round chips, teal
 * focus ring, the active swatch gets `ring-offset-2 ring-teal-500`.
 *
 * No preset <input type="color"> fallback - the palette is controlled.
 */
export function ColorPicker({
  value,
  onChange,
  options,
  hint,
}: ColorPickerProps) {
  const swatches = options ?? [
    '#2FAF9E',
    '#5B8DEF',
    '#F59E0B',
    '#E26D8A',
    '#8B5CF6',
    '#1D9A75',
  ];

  return (
    <div>
      <p className="block text-[13px] font-medium tracking-tight text-ink-soft">
        颜色
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {swatches.map((hex) => {
          const active = value === hex;
          return (
            <button
              key={hex}
              type="button"
              onClick={() => onChange(hex)}
              aria-label={`颜色 ${hex}`}
              aria-pressed={active}
              className={[
                'h-7 w-7 rounded-full transition-shadow focus-visible:outline-none',
                'focus-visible:ring-2 focus-visible:ring-teal-500/40',
                active ? 'ring-2 ring-offset-2 ring-teal-500' : 'ring-0',
              ].join(' ')}
              style={{ backgroundColor: hex }}
            />
          );
        })}
      </div>
      {hint ? (
        <p className="mt-1.5 text-[12px] leading-4 text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
}
