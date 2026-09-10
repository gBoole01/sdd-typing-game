'use client';

import { loginSchema } from '@typing-game/contracts';
import Link from 'next/link';
import { useActionState, useEffect, useRef, useState } from 'react';

import { loginAction } from '@/app/(auth)/actions';
import type { ActionState } from '@/lib/action-state';

/**
 * Spec 001 § 6 `/login`. Client validation is instant feedback and nothing more:
 * the action validates again, and the Nest guard is authoritative.
 */

/** § 6 — one form-level message, so the UI never discloses which half was wrong. */
function messageFor(state: Exclude<ActionState, null | { ok: true }>): string {
  if (state.code === 'INVALID_CREDENTIALS') return 'Email or password is incorrect.';

  if (state.code === 'RATE_LIMIT_EXCEEDED') {
    const seconds = Number(/(\d+)/.exec(state.details?.[0]?.message ?? '')?.[1] ?? 0);
    const minutes = Math.max(1, Math.ceil(seconds / 60));
    return `Too many attempts. Try again in ${minutes} minutes.`;
  }

  if (state.code === 'VALIDATION_FAILED') return 'Please check the highlighted fields.';
  return state.message;
}

export function LoginForm({ next }: { next?: string }): React.ReactElement {
  const [state, formAction, isPending] = useActionState(loginAction, null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const alertRef = useRef<HTMLParagraphElement>(null);

  const formError = state && state.ok === false ? messageFor(state) : null;

  useEffect(() => {
    // a11y — the error is announced and takes focus, not merely rendered.
    if (formError) alertRef.current?.focus();
  }, [formError]);

  function validate(event: React.FormEvent<HTMLFormElement>): void {
    const data = new FormData(event.currentTarget);
    const parsed = loginSchema.safeParse({
      email: data.get('email'),
      password: data.get('password'),
    });

    if (parsed.success) {
      setFieldErrors({});
      return;
    }

    event.preventDefault();
    const errors: { email?: string; password?: string } = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if (field === 'email' || field === 'password') errors[field] ??= issue.message;
    }
    setFieldErrors(errors);
  }

  return (
    <form action={formAction} onSubmit={validate} aria-label="Log in" noValidate>
      {formError ? (
        <p ref={alertRef} role="alert" tabIndex={-1} className="text-error">
          {formError}
        </p>
      ) : null}

      <label htmlFor="email">Email</label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="email"
        readOnly={isPending}
        aria-invalid={fieldErrors.email ? true : undefined}
        aria-describedby={fieldErrors.email ? 'email-error' : undefined}
      />
      {fieldErrors.email ? <p id="email-error">{fieldErrors.email}</p> : null}

      <label htmlFor="password">Password</label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        readOnly={isPending}
        aria-invalid={fieldErrors.password ? true : undefined}
        aria-describedby={fieldErrors.password ? 'password-error' : undefined}
      />
      {fieldErrors.password ? <p id="password-error">{fieldErrors.password}</p> : null}

      <Link href="/forgot-password">Forgot password?</Link>

      {next ? <input type="hidden" name="next" value={next} readOnly /> : null}

      {/* The label stays put while pending — a control whose accessible name
          changes mid-flight is one a screen reader has to re-announce. The
          spinner and `aria-busy` carry the state instead. */}
      <button type="submit" disabled={isPending} aria-busy={isPending || undefined}>
        Log in
        {isPending ? <span aria-hidden="true" data-testid="spinner" /> : null}
      </button>

      <p>
        New here? <Link href="/register">Create an account</Link>
      </p>
    </form>
  );
}
