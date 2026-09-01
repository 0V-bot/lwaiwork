'use client';

import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  variant?: 'primary' | 'ghost';
  children: ReactNode;
}

const BASE =
  'inline-flex h-11 items-center justify-center gap-2 rounded-md px-5 text-[15px] font-medium tracking-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40 disabled:cursor-not-allowed disabled:opacity-50';

const VARIANTS: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'bg-teal-500 text-white hover:bg-teal-600 active:bg-teal-700',
  ghost: 'text-ink-soft hover:text-ink',
};

export function Button({
  loading = false,
  variant = 'primary',
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="submit"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={[BASE, VARIANTS[variant], className ?? ''].join(' ')}
      {...rest}
    >
      {loading ? (
        <span
          aria-hidden
          className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
        />
      ) : null}
      {children}
    </button>
  );
}
