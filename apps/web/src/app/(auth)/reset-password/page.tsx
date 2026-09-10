import type { ResetTokenValidation } from '@typing-game/contracts';
import type { Metadata } from 'next';
import Link from 'next/link';

import { ResetPasswordForm } from '@/features/auth/reset-password-form';
import { ResetReasonPanel } from '@/features/auth/reset-reason-panel';
import { apiFetch } from '@/lib/api-fetch';

/** § 6 — the page must not be indexed: the token is in the URL. */
export const metadata: Metadata = { robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/**
 * Spec 001 § 6 `/reset-password`. The token is validated **before** a form is
 * rendered, so a dead link never asks the user to type a password first.
 * `validate` does not consume the token, so a mail client prefetching the link
 * cannot burn it (§ 5).
 */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const params = await searchParams;
  const token = typeof params.token === 'string' ? params.token : null;

  if (!token) {
    return (
      <div>
        <h1>This link is incomplete</h1>
        <p>It is missing the token that identifies your request.</p>
        <Link href="/forgot-password">Request a new link</Link>
      </div>
    );
  }

  const result = await apiFetch<ResetTokenValidation>(
    `/auth/reset-password/validate?token=${encodeURIComponent(token)}`,
  );

  const validation: ResetTokenValidation = result.ok
    ? result.data
    : { valid: false, reason: 'INVALID' };

  if (!validation.valid) return <ResetReasonPanel reason={validation.reason ?? 'INVALID'} />;

  return (
    <div>
      <h1>Choose a new password</h1>
      <ResetPasswordForm token={token} />
    </div>
  );
}
