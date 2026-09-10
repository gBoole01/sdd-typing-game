'use client';

import { useActionState } from 'react';

import { updateProfileAction } from '@/app/(account)/actions';

/** Spec 001 § 6 `/account` — inline username edit. */
export function UsernameForm({ username }: { username: string }): React.ReactElement {
  const [state, formAction, isPending] = useActionState(updateProfileAction, null);
  const failure = state?.ok === false ? state : null;

  function message(): string {
    if (!failure) return '';

    if (failure.code === 'USERNAME_CHANGE_TOO_SOON') {
      // `details[0].message` is the ISO-8601 instant the cooldown ends.
      const retryAfter = failure.details?.[0]?.message;
      const when = retryAfter
        ? new Date(retryAfter).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })
        : 'later';

      return `You can change your username again on ${when}.`;
    }

    if (failure.code === 'USERNAME_TAKEN') return 'That username is taken.';
    return failure.details?.[0]?.message ?? failure.message;
  }

  return (
    <form action={formAction} aria-label="Change your username">
      {failure ? <p role="alert">{message()}</p> : null}
      {state?.ok ? <p role="status">Username updated.</p> : null}

      <label htmlFor="username">Username</label>
      <input id="username" name="username" defaultValue={username} readOnly={isPending} />

      <button type="submit" disabled={isPending}>
        Save
      </button>
    </form>
  );
}
