import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LoginForm } from './login-form';

/**
 * Spec 001 § 9 "Frontend — login-form.test.tsx", against § 6 `/login`.
 *
 * Client validation is UX and never the enforcement point; the Server Action
 * validates again, and the API guard is authoritative.
 */

const loginAction = vi.hoisted(() => vi.fn());
vi.mock('@/app/(auth)/actions', () => ({ loginAction }));

beforeEach(() => {
  loginAction.mockReset();
  loginAction.mockResolvedValue(null);
});

async function fillAndSubmit(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText(/email/i), 'nicolas@example.com');
  await user.type(screen.getByLabelText(/password/i), 'correct horse battery');
  await user.click(screen.getByRole('button', { name: /log in/i }));
}

describe('LoginForm', () => {
  it('works as a real form, so it survives JavaScript being disabled', () => {
    render(<LoginForm />);

    // § 6 — Server Actions are invoked through a real <form action>.
    const form = screen.getByRole('form', { name: /log in/i });
    expect(form).toHaveAttribute('action');
    expect(screen.getByLabelText(/email/i)).toHaveAttribute('name', 'email');
    expect(screen.getByLabelText(/password/i)).toHaveAttribute('name', 'password');
  });

  it('carries the autocomplete hints a password manager needs', () => {
    render(<LoginForm />);

    expect(screen.getByLabelText(/email/i)).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByLabelText(/password/i)).toHaveAttribute('autocomplete', 'current-password');
  });

  it('links to the forgot-password page', () => {
    render(<LoginForm />);

    expect(screen.getByRole('link', { name: /forgot/i })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  it('rejects a malformed email client-side without calling the action', async () => {
    const user = userEvent.setup();
    render(<LoginForm />);

    await user.type(screen.getByLabelText(/email/i), 'not-an-email');
    await user.type(screen.getByLabelText(/password/i), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    expect(await screen.findByText(/valid email/i)).toBeInTheDocument();
    expect(loginAction).not.toHaveBeenCalled();
  });

  it('disables the submit button and makes inputs read-only while pending', async () => {
    const user = userEvent.setup();
    let release: (value: unknown) => void = () => undefined;
    loginAction.mockImplementation(() => new Promise((resolve) => (release = resolve)));

    render(<LoginForm />);
    await fillAndSubmit(user);

    await waitFor(() => expect(screen.getByRole('button', { name: /log in/i })).toBeDisabled());
    expect(screen.getByLabelText(/email/i)).toHaveAttribute('readonly');

    release(null);
  });

  it('renders one form-level message for INVALID_CREDENTIALS, never a per-field one', async () => {
    const user = userEvent.setup();
    loginAction.mockResolvedValue({
      ok: false,
      code: 'INVALID_CREDENTIALS',
      message: 'Email or password is incorrect.',
    });

    render(<LoginForm />);
    await fillAndSubmit(user);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/email or password is incorrect/i);

    // The UI must not disclose which half was wrong, so the message is on the
    // form and nowhere else.
    expect(screen.getByLabelText(/email/i)).not.toHaveAccessibleDescription(
      /incorrect|invalid|wrong/i,
    );
    expect(screen.getByLabelText(/password/i)).not.toHaveAccessibleDescription(
      /incorrect|invalid|wrong/i,
    );
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  it('moves focus to the alert on failure', async () => {
    const user = userEvent.setup();
    loginAction.mockResolvedValue({
      ok: false,
      code: 'INVALID_CREDENTIALS',
      message: 'Email or password is incorrect.',
    });

    render(<LoginForm />);
    await fillAndSubmit(user);

    // a11y — the error must be announced, not merely rendered.
    await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus());
  });

  it('explains a rate limit in minutes rather than as a raw code', async () => {
    const user = userEvent.setup();
    loginAction.mockResolvedValue({
      ok: false,
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests.',
      details: [{ path: '', message: 'Retry in 540 seconds.' }],
    });

    render(<LoginForm />);
    await fillAndSubmit(user);

    expect(await screen.findByRole('alert')).toHaveTextContent(/too many attempts/i);
    expect(screen.getByRole('alert')).toHaveTextContent(/9 minutes/i);
  });

  it('passes a next param through to the action', async () => {
    const user = userEvent.setup();
    render(<LoginForm next="/account/security" />);

    // The action re-validates it; this only has to carry it.
    expect(screen.getByDisplayValue('/account/security')).toHaveAttribute('name', 'next');

    await fillAndSubmit(user);
    await waitFor(() => expect(loginAction).toHaveBeenCalled());
  });
});
