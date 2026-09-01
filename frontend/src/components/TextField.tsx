'use client';

import { forwardRef } from 'react';

interface TextFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** Inline validation message; also flips the underline to red. */
  error?: string | null;
  /** Helper copy shown when there is no error. */
  hint?: string;
}

/**
 * Hairline underline input - no boxed card, keeps the page light.
 * Uses the native `type` attribute so password managers behave.
 */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  function TextField({ label, error, hint, id, name, className, ...rest }, ref) {
    const inputId = id ?? name ?? label;

    return (
      <div>
        <label
          htmlFor={inputId}
          className="block text-[13px] font-medium tracking-tight text-ink-soft"
        >
          {label}
        </label>
        <input
          ref={ref}
          id={inputId}
          name={name}
          aria-invalid={error ? true : undefined}
          className={[
            'mt-1.5 w-full border-0 border-b bg-transparent px-0 py-2.5',
            'text-[15px] text-ink outline-none transition-colors',
            'placeholder:text-ink-muted/50',
            error
              ? 'border-red-400 focus:border-red-500'
              : 'border-line focus:border-teal-500',
            className ?? '',
          ].join(' ')}
          {...rest}
        />
        {error ? (
          <p className="mt-1.5 text-[12px] leading-4 text-red-600">{error}</p>
        ) : hint ? (
          <p className="mt-1.5 text-[12px] leading-4 text-ink-muted">{hint}</p>
        ) : null}
      </div>
    );
  },
);
