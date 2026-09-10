'use client';

import type { ResetTokenReason } from '@typing-game/contracts';
import { useActionState, useState } from 'react';

import { resetPasswordAction } from '@/app/(auth)/actions';
import { ResetReasonPanel } from './reset-reason-panel';

/** Spec 001 § 6 `/reset-password`. */

const TOKEN_FAILURES: Record<string, ResetTokenReason> = {
  RESET_TOKEN_EXPIRED: 'EXPIRED',
  RESET_TOKEN_USED: 'USED',
  RESET_TOKEN_SUPERSEDED: 'SUPERSEDED',
  RESET_TOKEN_INVALID: 'INVALID',
};

export function ResetPasswordForm({ token }: { token: string }): React.ReactElement {
  const [state, formAction, isPending] = useActionState(resetPasswordAction, null);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [mismatch, setMismatch] = useState(false);

  // The token can expire between page load and submit, so these render the same
  // reason panels rather than a form error (§ 6).
  const failure = state?.ok === false ? state : null;
  const tokenReason = failure ? TOKEN_FAILURES[failure.code] : undefined;
  if (tokenReason) return <ResetReasonPanel reason={tokenReason} />;

  return (
    <form
      action={formAction}
      aria-label="Set a new password"
      onSubmit={(event) => {
        // Matched client-side only; the API takes one field.
        if (password !== confirmation) {
          event.preventDefault();
          setMismatch(true);
        }
      }}
    >
      {failure ? <p role="alert">{failure.message}</p> : null}

      {/* The token stays in the URL and is never written to localStorage. */}
      <input type="hidden" name="token" value={token} readOnly />

      <label htmlFor="password">New password</label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(event) => {
          setPassword(event.target.value);
          setMismatch(false);
        }}
      />

      <label htmlFor="confirmation">Confirm password</label>
      <input
        id="confirmation"
        type="password"
        autoComplete="new-password"
        value={confirmation}
        onChange={(event) => {
          setConfirmation(event.target.value);
          setMismatch(false);
        }}
      />
      {mismatch ? <p>Those passwords do not match.</p> : null}

      <button type="submit" disabled={isPending}>
        Set new password
      </button>
    </form>
  );
}
