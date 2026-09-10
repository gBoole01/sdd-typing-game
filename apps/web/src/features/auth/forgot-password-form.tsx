'use client';

import { useActionState, useEffect, useState } from 'react';

import { forgotPasswordAction } from '@/app/(auth)/actions';

/**
 * Spec 001 § 6 `/forgot-password`.
 *
 * The confirmation copy is a constant, not derived from the response, because
 * US-6.1 requires it to be identical whether or not the account exists — the UI
 * must never branch on existence, and a constant cannot.
 */
const CONFIRMATION =
  'If an account exists for that address, a reset link is on its way. The link expires in 30 minutes.';

/** § 6 — "on its way", not "sent": the API has not observed a successful send. */
const RESEND_AFTER_MS = 60_000;

export function ForgotPasswordForm(): React.ReactElement {
  const [state, formAction, isPending] = useActionState(forgotPasswordAction, null);
  const [canResend, setCanResend] = useState(false);
  const [email, setEmail] = useState('');

  const confirmed = state?.ok === true;
  const rateLimited = state?.ok === false && state.code === 'RATE_LIMIT_EXCEEDED';

  useEffect(() => {
    if (!confirmed) return;

    const timer = setTimeout(() => setCanResend(true), RESEND_AFTER_MS);
    return () => clearTimeout(timer);
  }, [confirmed]);

  if (confirmed) {
    return (
      <div>
        <p role="status">{CONFIRMATION}</p>

        {canResend ? (
          <form action={formAction} aria-label="Resend the reset link">
            <input type="hidden" name="email" value={email} readOnly />
            <button type="submit">Resend the link</button>
          </form>
        ) : null}
      </div>
    );
  }

  return (
    <form action={formAction} aria-label="Reset your password">
      {rateLimited ? (
        <p role="alert">Please wait before requesting another link.</p>
      ) : null}

      <label htmlFor="email">Email</label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        readOnly={isPending}
      />

      <button type="submit" disabled={isPending}>
        Send a reset link
      </button>
    </form>
  );
}
