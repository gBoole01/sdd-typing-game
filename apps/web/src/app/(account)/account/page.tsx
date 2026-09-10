import Link from 'next/link';
import { Suspense } from 'react';

import { UsernameForm } from '@/features/account/username-form';
import { getProfile } from '@/lib/profile';

/**
 * Spec 001 § 6 `/account`. Stats come from `GET /users/me/stats` (spec 003) in a
 * `<Suspense>` boundary, so the profile paints without waiting on an aggregate.
 * Until 003 exists the boundary renders the empty state — an absent endpoint is
 * an empty stats panel, not a broken page.
 */
function StatsPanel(): React.ReactElement {
  return (
    <section className="rounded-md bg-surface-card p-6">
      <h2 className="text-lg font-semibold">Your typing</h2>
      <p className="mt-2 text-content-secondary">
        No tests yet. <Link href="/">Take your first test</Link>.
      </p>
    </section>
  );
}

export default async function AccountPage(): Promise<React.ReactElement> {
  const profile = await getProfile();

  return (
    <div className="grid gap-8">
      <section className="rounded-md bg-surface-card p-6">
        <h1 className="text-xl font-bold tracking-display">Profile</h1>

        {profile ? (
          <>
            <UsernameForm username={profile.username} />
            <p className="mt-4 text-sm text-content-secondary">
              {profile.email} — changing your email isn&apos;t available yet.
            </p>
            <p className="text-sm text-content-muted">
              Member since{' '}
              {new Date(profile.createdAt).toLocaleDateString('en-GB', {
                month: 'long',
                year: 'numeric',
              })}
            </p>
          </>
        ) : null}
      </section>

      <Suspense fallback={null}>
        <StatsPanel />
      </Suspense>
    </div>
  );
}
