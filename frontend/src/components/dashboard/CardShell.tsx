'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';

/**
 * Reusable chrome for a dashboard card.
 *
 * The dashboard layout has many small cards, so the chrome needs to be
 * one place rather than re-implemented in each card. Title row carries
 * a "more →" link into the corresponding module.
 */

interface CardShellProps {
  title: string;
  href: string;
  linkLabel?: string;
  children: ReactNode;
}

export function CardShell({ title, href, linkLabel, children }: CardShellProps) {
  return (
    <section className="flex h-full flex-col rounded-lg border border-line bg-white p-5">
      <header className="mb-4 flex items-center justify-between">
        <h2 className="text-[14px] font-medium tracking-tight text-ink">
          {title}
        </h2>
        <Link
          href={href}
          className="text-[12.5px] text-ink-muted transition-colors hover:text-teal-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
        >
          {linkLabel ?? '更多'} →
        </Link>
      </header>
      <div className="flex-1">{children}</div>
    </section>
  );
}

/**
 * One-line empty placeholder. Rendered when the list section is empty
 * (zero todos, zero events, etc.) so the card still reads as a real card
 * rather than collapsing to nothing.
 */
export function EmptyLine({ text }: { text: string }) {
  return (
    <p className="text-[13px] leading-6 text-ink-muted">{text}</p>
  );
}
