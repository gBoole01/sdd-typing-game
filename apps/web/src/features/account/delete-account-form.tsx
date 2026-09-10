'use client';

import { useActionState, useState } from 'react';

import { deleteAccountAction } from '@/app/(account)/actions';

/** Spec 001 § 6 `/account/danger`, and US-8.5. */

const CONSEQUENCE = {
  anonymise:
    'Your account is deleted. Your past results are kept without your name attached, so leaderboards stay accurate.',
  destroy:
    'Your account and every result you have recorded are deleted permanently. This cannot be undone.',
} as const;

const CONFIRMATION = 'DELETE';

export function DeleteAccountForm(): React.ReactElement {
  const [state, formAction, isPending] = useActionState(deleteAccountAction, null);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [deleteResults, setDeleteResults] = useState(false);

  const failure = state?.ok === false ? state : null;
  const passwordError =
    failure?.code === 'INVALID_CREDENTIALS' ? 'That password is incorrect.' : null;

  // Exact match, not trimmed: a confirmation that accepts near-misses is not one.
  const ready = confirmation === CONFIRMATION && password.length > 0;

  return (
    <form action={formAction} aria-label="Delete your account">
      {/* Both behaviours are stated before submission — the default is not a
          silent choice (US-8.5). */}
      <p data-testid="deletion-consequence">
        {deleteResults ? CONSEQUENCE.destroy : CONSEQUENCE.anonymise}
      </p>

      <label htmlFor="password">Current password</label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        aria-invalid={passwordError ? true : undefined}
        aria-describedby={passwordError ? 'password-error' : undefined}
      />
      {passwordError ? <p id="password-error">{passwordError}</p> : null}

      <input
        id="deleteResults"
        name="deleteResults"
        type="checkbox"
        // The API schema is strict and "on" is not a boolean.
        value="true"
        checked={deleteResults}
        onChange={(event) => setDeleteResults(event.target.checked)}
      />
      <label htmlFor="deleteResults">Also delete my results and leaderboard entries</label>

      <label htmlFor="confirm">Type {CONFIRMATION} to confirm</label>
      <input
        id="confirm"
        name="confirm"
        value={confirmation}
        onChange={(event) => setConfirmation(event.target.value)}
      />

      <button type="submit" disabled={!ready || isPending}>
        Delete my account
      </button>
    </form>
  );
}
