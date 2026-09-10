import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense, type ReactNode } from 'react';

import { logoutAction } from '@/app/(account)/actions';
import { getSession } from '@/lib/session';
import './globals.css';

export const metadata: Metadata = {
  title: 'Typing Game',
  description: 'Measure your typing speed.',
};

/**
 * Spec 001 § 6 *Layouts* — the header carries the auth state. It is wrapped in
 * `<Suspense>` so the rest of the shell is not held behind a cookie read.
 */
async function AuthState(): Promise<ReactNode> {
  const session = await getSession();

  if (!session) {
    return (
      <nav aria-label="Account">
        <Link href="/login">Log in</Link>
        <Link href="/register">Sign up</Link>
      </nav>
    );
  }

  return (
    <nav aria-label="Account" className="flex items-center gap-4">
      <Link href="/account">{session.user.username}</Link>
      <form action={logoutAction}>
        <button type="submit">Log out</button>
      </form>
    </nav>
  );
}

export default function RootLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <html lang="en">
      <body>
        <header className="mx-auto flex max-w-[var(--container-max)] items-center justify-between px-[var(--gutter)] py-5">
          <Link href="/" className="text-sm font-semibold uppercase tracking-label">
            Typing Game
          </Link>
          <Suspense fallback={null}>
            <AuthState />
          </Suspense>
        </header>
        {children}
      </body>
    </html>
  );
}
