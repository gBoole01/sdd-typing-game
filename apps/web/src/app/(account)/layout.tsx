import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { requireSession } from '@/lib/session';

/** Every account route is dynamic and never cached, and asks not to be indexed (§ 6). */
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { robots: { index: false, follow: false } };

const TABS = [
  ['/account', 'Profile'],
  ['/account/security', 'Security'],
  ['/account/settings', 'Settings'],
  ['/account/danger', 'Delete account'],
] as const;

/**
 * Spec 001 § 6 *Layouts*. `requireSession()` redirects to
 * `/login?next=<path>` when there is no session; the profile itself is read by
 * the pages through a `cache()`-wrapped fetcher, so one render makes one call.
 */
export default async function AccountLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactNode> {
  await requireSession();

  return (
    <main className="mx-auto w-full max-w-[var(--container-max)] px-[var(--gutter)] py-12">
      <nav aria-label="Account sections" className="mb-8 flex flex-wrap gap-2">
        {TABS.map(([href, label]) => (
          <Link
            key={href}
            href={href}
            className="rounded-pill border border-line-subtle px-4 py-2 text-sm"
          >
            {label}
          </Link>
        ))}
      </nav>
      {children}
    </main>
  );
}
