'use client';

import { useActionState } from 'react';

import { changePasswordAction } from '@/app/(account)/actions';

/** Spec 001 § 6 `/account/security` — the endpoint that keeps the unchanged check (Q14). */
export function PasswordForm(): React.ReactElement {
  const [state, formAction, isPending] = useActionState(changePasswordAction, null);
  const failure = state?.ok === false ? state : null;

  const currentError =
    failure?.code === 'INVALID_CREDENTIALS' ? 'That password is incorrect.' : null;
  const newError =
    failure?.code === 'PASSWORD_UNCHANGED'
      ? 'Choose a password different from your current one.'
      : failure?.code === 'VALIDATION_FAILED'
        ? (failure.details?.[0]?.message ?? 'Check the password rules.')
        : null;

  return (
    <form action={formAction} aria-label="Change your password">
      {state?.ok ? <p role="status">Password updated. Other devices were signed out.</p> : null}

      <label htmlFor="currentPassword">Current password</label>
      <input
        id="currentPassword"
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        aria-invalid={currentError ? true : undefined}
        aria-describedby={currentError ? 'current-error' : undefined}
      />
      {currentError ? <p id="current-error">{currentError}</p> : null}

      <label htmlFor="newPassword">New password</label>
      <input
        id="newPassword"
        name="newPassword"
        type="password"
        autoComplete="new-password"
        aria-invalid={newError ? true : undefined}
        aria-describedby={newError ? 'new-error' : undefined}
      />
      {newError ? <p id="new-error">{newError}</p> : null}

      <button type="submit" disabled={isPending}>
        Change password
      </button>
    </form>
  );
}
