import Link from 'next/link';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';

import { WEB_COOKIE } from '@/lib/cookies';
import { getSession } from '@/lib/session';

/**
 * Spec 003 owns this page. Spec 001 § 6 owns exactly two things on it:
 *
 *  - the "keep your results" banner shown to a guest, and
 *  - the fact that the RSC passes `settings` from `getSession()` into the typing
 *    surface as props (US-7.4), so an authenticated user paints with their own
 *    caret style and sound preference on the first frame.
 *
 * A guest paints from `localStorage`, or from defaults on a first visit — there
 * is no server-side preference to flash to, so there is no flash to prevent.
 */
export default async function HomePage(): Promise<ReactNode> {
  const session = await getSession();
  const isGuest = !session && Boolean((await cookies()).get(WEB_COOKIE.guest)?.value);

  return (
    <main className="glow-hero min-h-screen">
      <div className="mx-auto max-w-[var(--container-narrow)] px-[var(--gutter)] py-[var(--section-padding-y)]">
        <p className="text-xs font-semibold uppercase tracking-label text-content-accent">
          Typing Game
        </p>

        <h1 className="mt-4 text-4xl font-bold leading-tight tracking-display text-balance">
          Measure how fast you <span className="marker">really</span> type
        </h1>

        {/* The typing surface arrives with spec 003 and will receive these as
            props; they are resolved here so the first frame is already correct. */}
        <p className="mt-5 max-w-[var(--measure)] text-md leading-normal text-content-secondary">
          {session
            ? `Welcome back, ${session.user.username}. Your ${session.settings.defaultDuration}-second test is ready.`
            : 'Take a test without signing up — your results are kept in this browser.'}
        </p>

        {isGuest ? (
          <div
            data-testid="guest-cta"
            className="mt-10 rounded-md border border-line-accent bg-surface-card p-6"
          >
            <p className="font-semibold">Keep your results</p>
            <p className="mt-1 text-sm text-content-secondary">
              Create an account and the results from this browser move across with you.
            </p>
            <Link
              href="/register"
              className="mt-4 inline-flex h-11 items-center rounded-pill bg-accent px-6 text-sm font-semibold text-content-on-accent"
            >
              Create an account
            </Link>
          </div>
        ) : null}
      </div>
    </main>
  );
}
