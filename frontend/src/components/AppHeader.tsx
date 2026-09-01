'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useAuth } from '@/contexts/AuthContext';

/**
 * Top bar shared by every /habits/* page.
 *
 * - Lays out the brand on the left, the section nav in the middle, and
 *   account controls on the right.
 * - The active section is highlighted by underlining with the teal `border`.
 * - Kept slim (h-14) and borderless except for a single bottom hairline so
 *   the page reads as "white paper with a faint crease".
 */
const SECTIONS = [
  { href: '/dashboard', label: '看板' },
  { href: '/analytics', label: '数据' },
  { href: '/todos', label: '待办' },
  { href: '/habits', label: '习惯' },
  { href: '/schedules', label: '日程' },
  { href: '/notes', label: '笔记' },
  { href: '/files', label: '文件' },
] as const;

export function AppHeader() {
  const { user, logout } = useAuth();
  const pathname = usePathname();

  return (
    <header className="border-b border-line">
      <div className="mx-auto flex h-14 w-full max-w-2xl items-center justify-between px-6">
        <Link href="/habits" className="flex items-center gap-2.5">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-teal-500">
            <svg viewBox="0 0 32 32" className="h-3.5 w-3.5" aria-hidden>
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
          <span className="text-[15px] font-semibold tracking-tight text-ink">
            lwaiwork
          </span>
        </Link>

        <nav className="flex items-center gap-6">
          {SECTIONS.map((item) => {
            // Treat "/habits" as active for both /habits and /habits/* children
            // so deep links (e.g. /habits/<uuid>/stats) still highlight "习惯".
            const active =
              item.href === '/habits'
                ? pathname === '/habits' || pathname.startsWith('/habits/')
                : pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={[
                  '-mb-px border-b-2 pb-2.5 text-[13px] transition-colors',
                  active
                    ? 'border-teal-500 font-medium text-ink'
                    : 'border-transparent text-ink-muted hover:text-ink',
                ].join(' ')}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-4">
          <span className="hidden text-[13px] text-ink-muted sm:inline">
            {user?.email}
          </span>
          <button
            type="button"
            onClick={() => void logout()}
            className="rounded text-[13px] text-ink-muted transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/40"
          >
            退出
          </button>
        </div>
      </div>
    </header>
  );
}
