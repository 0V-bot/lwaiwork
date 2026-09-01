'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';

interface AuthShellProps {
  title: string;
  subtitle: string;
  children: ReactNode;
  /** Footer slot - the cross-link between /login and /register. */
  footer: ReactNode;
}

/**
 * Shared chrome for /login and /register.
 * Deliberately not a centred card on a grey canvas: the form sits on the white
 * page itself, top-aligned with a single teal rule echoing the app bar.
 */
export function AuthShell({ title, subtitle, children, footer }: AuthShellProps) {
  return (
    <div className="min-h-screen bg-white">
      <div className="h-[3px] w-full bg-teal-500" />

      <main className="mx-auto w-full max-w-[380px] px-6 pb-16 pt-16 sm:pt-24">
        <Link href="/" className="inline-flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-teal-500">
            <svg viewBox="0 0 32 32" className="h-4 w-4" aria-hidden>
              <path
                d="M9 16.8l4.2 4.2L23 11.2"
                fill="none"
                stroke="#ffffff"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-ink">lwaiwork</span>
        </Link>

        <h1 className="mt-10 text-[26px] font-semibold leading-tight tracking-tight text-ink">
          {title}
        </h1>
        <p className="mt-2 text-[14px] leading-6 text-ink-muted">{subtitle}</p>

        <div className="mt-9">{children}</div>

        <div className="mt-8 border-t border-line pt-6 text-[13px] text-ink-muted">
          {footer}
        </div>
      </main>
    </div>
  );
}
