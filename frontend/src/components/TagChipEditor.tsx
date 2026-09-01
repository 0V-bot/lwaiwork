'use client';

import { useCallback, useState, type KeyboardEvent } from 'react';

interface TagChipEditorProps {
  tags: string[];
  onChange: (next: string[]) => void;
  /** Hard cap on entry count. Defaults to 32 (matches backend). */
  max?: number;
  /** Hard cap on each tag's character length. Defaults to 32 (matches backend). */
  maxLength?: number;
  placeholder?: string;
  /** Optional helper text shown when there's no validation error. */
  hint?: string;
}

/**
 * Controlled chip editor for tag inputs.
 *
 * Behaviour:
 *   - Typing + Enter commits a chip (also: comma, Chinese full-width comma).
 *   - Backspace in an empty input removes the last chip.
 *   - The ✕ on each chip removes that single entry.
 *   - Whitespace is trimmed; duplicates (case-sensitive) are dropped silently
 *     so the user can't smuggle two entries that differ only by casing.
 *   - Empty strings are never committed, so a stray double-Enter can't
 *     create a phantom chip.
 *
 * No client-side check for "byte length" - the backend enforces a 32-char
 * cap per tag with a clean 400 message, which we surface verbatim through
 * `toErrorMessage` on the call site. We do keep the live `maxLength` mirror
 * so the browser refuses to type the 33rd character.
 */
export function TagChipEditor({
  tags,
  onChange,
  max = 32,
  maxLength = 32,
  placeholder = '按回车添加标签',
  hint,
}: TagChipEditorProps) {
  const [draft, setDraft] = useState('');
  const [overLimit, setOverLimit] = useState(false);

  const atCap = tags.length >= max;

  const commit = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return;
      if (atCap) return;
      if (tags.includes(trimmed)) {
        setDraft('');
        return;
      }
      onChange([...tags, trimmed]);
      setDraft('');
    },
    [atCap, onChange, tags],
  );

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Enter / comma / 中文逗号 all commit.
    if (
      event.key === 'Enter' ||
      event.key === ',' ||
      // Full-width comma U+FF0C
      event.key === '\uFF0C'
    ) {
      event.preventDefault();
      if (overLimit) return;
      commit(draft);
      return;
    }
    // Backspace on an empty input pops the last chip.
    if (event.key === 'Backspace' && draft === '' && tags.length > 0) {
      event.preventDefault();
      onChange(tags.slice(0, -1));
    }
  }

  function handleChange(value: string) {
    // Mirror the per-chip cap so the user can't type past the limit.
    if (value.length > maxLength) {
      setOverLimit(true);
      return;
    }
    setOverLimit(false);
    setDraft(value);
  }

  function removeAt(index: number) {
    onChange(tags.filter((_, i) => i !== index));
  }

  return (
    <div>
      <p className="block text-[13px] font-medium tracking-tight text-ink-soft">
        标签
      </p>

      <div
        className={[
          'mt-1.5 flex min-h-[42px] flex-wrap items-center gap-1.5 rounded-md border bg-white px-2 py-1.5',
          overLimit
            ? 'border-red-400 focus-within:border-red-500'
            : 'border-line focus-within:border-teal-500',
        ].join(' ')}
      >
        {tags.map((tag, index) => (
          <span
            key={`${tag}-${index}`}
            className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2.5 py-0.5 text-[12px] text-teal-700"
          >
            {tag}
            <button
              type="button"
              onClick={() => removeAt(index)}
              aria-label={`删除标签 ${tag}`}
              className="-mr-1 inline-flex h-4 w-4 items-center justify-center rounded-full text-teal-500 transition-colors hover:bg-teal-100 hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
            >
              <svg viewBox="0 0 16 16" className="h-3 w-3" aria-hidden>
                <path
                  d="M4 4l8 8M12 4l-8 8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </span>
        ))}

        <input
          type="text"
          value={draft}
          onChange={(event) => handleChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={atCap ? `最多 ${max} 个标签` : placeholder}
          disabled={atCap && draft === ''}
          aria-label="添加标签"
          className="min-w-[120px] flex-1 border-0 bg-transparent px-1 py-1 text-[14px] text-ink outline-none placeholder:text-ink-muted/50 disabled:cursor-not-allowed"
        />
      </div>

      <p
        className={[
          'mt-1.5 text-[12px] leading-4',
          overLimit ? 'text-red-600' : 'text-ink-muted',
        ].join(' ')}
      >
        {overLimit
          ? `单个标签最多 ${maxLength} 个字符`
          : `${tags.length}/${max} · 回车添加，点击 ✕ 删除`}
        {hint ? ` · ${hint}` : ''}
      </p>
    </div>
  );
}
