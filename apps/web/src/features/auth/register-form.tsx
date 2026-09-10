'use client';

import Link from 'next/link';
import { useActionState, useEffect, useRef, useState } from 'react';

import { registerAction } from '@/app/(auth)/actions';
import {
  checkUsernameAvailability,
  type UsernameAvailabilityResult,
} from '@/lib/username-availability';

/** Spec 001 § 6 `/register`. */

const DEBOUNCE_MS = 400;
const MIN_USERNAME_LENGTH = 3;

/** § 6 — a live rule checklist, and deliberately no strength meter: it would
 *  imply precision the rules do not have. */
function passwordRules(password: string, email: string, username: string) {
  return {
    length: password.length >= 10 && password.length <= 128,
    distinct: password.length > 0 && password !== email && password !== username,
  };
}

function usernameMessage(result: UsernameAvailabilityResult): string {
  if (result.available) return 'That username is available.';

  switch (result.reason) {
    case 'TAKEN':
      return 'That username is taken.';
    case 'RESERVED':
      return 'That username is reserved and not available.';
    case 'MIXED_SCRIPT':
      // § 4 — naming both scripts is actionable; "invalid" is not.
      return `That looks like ${(result.scripts ?? []).join(' and ')} mixed in one username.`;
    default:
      return 'Use 3–20 letters, digits or underscores.';
  }
}

export function RegisterForm({
  guestResultCount = 0,
}: {
  guestResultCount?: number;
}): React.ReactElement {
  const [state, formAction, isPending] = useActionState(registerAction, null);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [availability, setAvailability] = useState<UsernameAvailabilityResult | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rules = passwordRules(password, email, username);
  const clientValid = email.length > 0 && username.length > 0 && rules.length && rules.distinct;

  useEffect(() => {
    if (username.length < MIN_USERNAME_LENGTH) {
      setAvailability(null);
      return;
    }

    // Debounced, because this endpoint is rate-limited by design and the check
    // is advisory: the authoritative answer is the 409 on submit.
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void checkUsernameAvailability(username).then(setAvailability).catch(() => setAvailability(null));
    }, DEBOUNCE_MS);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [username]);

  const failure = state?.ok === false ? state : null;
  const emailError =
    failure?.code === 'EMAIL_ALREADY_REGISTERED' ? 'That email is already registered.' : null;
  const usernameError = failure?.code === 'USERNAME_TAKEN' ? 'That username is taken.' : null;

  return (
    <form action={formAction} aria-label="Create an account">
      {guestResultCount > 0 ? (
        <p data-testid="guest-banner">
          You have {guestResultCount} unsaved results — creating an account keeps them.
        </p>
      ) : null}

      <label htmlFor="email">Email</label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        aria-invalid={emailError ? true : undefined}
        aria-describedby={emailError ? 'email-error' : undefined}
      />
      {emailError ? (
        <p id="email-error">
          {emailError}{' '}
          <Link href={`/login?email=${encodeURIComponent(email)}`}>Log in instead</Link>
        </p>
      ) : null}

      <label htmlFor="username">Username</label>
      <input
        id="username"
        name="username"
        autoComplete="username"
        value={username}
        onChange={(event) => setUsername(event.target.value)}
        aria-invalid={usernameError ? true : undefined}
        aria-describedby={usernameError ? 'username-error' : undefined}
      />
      {usernameError ? <p id="username-error">{usernameError}</p> : null}
      {availability ? (
        <p data-testid="username-feedback">{usernameMessage(availability)}</p>
      ) : null}

      <label htmlFor="password">Password</label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <ul>
        <li data-testid="rule-length" data-satisfied={String(rules.length)}>
          Between 10 and 128 characters
        </li>
        <li data-testid="rule-distinct" data-satisfied={String(rules.distinct)}>
          Not your email address or username
        </li>
      </ul>

      <input
        id="acceptedTerms"
        name="acceptedTerms"
        type="checkbox"
        checked={accepted}
        onChange={(event) => setAccepted(event.target.checked)}
      />
      <label htmlFor="acceptedTerms">
        I accept the{' '}
        <Link href="/terms" target="_blank" rel="noreferrer">
          Terms
        </Link>{' '}
        and{' '}
        <Link href="/privacy" target="_blank" rel="noreferrer">
          Privacy notice
        </Link>
      </label>

      <button type="submit" disabled={isPending || !accepted || !clientValid}>
        Create account
      </button>
    </form>
  );
}
