import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ForgotPasswordForm } from './forgot-password-form';

/**
 * Spec 001 § 9 "Frontend — forgot-password-form.test.tsx", against § 6
 * `/forgot-password` and US-6.1.
 */

const forgotPasswordAction = vi.hoisted(() => vi.fn());
vi.mock('@/app/(auth)/actions', () => ({ forgotPasswordAction }));

beforeEach(() => {
  forgotPasswordAction.mockReset();
  forgotPasswordAction.mockResolvedValue({ ok: true });
});

async function submit(email: string): Promise<void> {
  const user = userEvent.setup({
    // user-event rejects an advanceTimers callback when the timer APIs are not
    // mocked, and only some tests here fake them.
    advanceTimers: (ms) => {
      if (vi.isFakeTimers()) vi.advanceTimersByTime(ms);
    },
  });
  await user.type(screen.getByLabelText(/email/i), email);
  await user.click(screen.getByRole('button', { name: /send|reset link/i }));
}

describe('ForgotPasswordForm', () => {
  it('renders a byte-identical confirmation panel for known and unknown addresses', async () => {
    render(<ForgotPasswordForm />);
    await submit('nicolas@example.com');
    const known = (await screen.findByRole('status')).textContent;

    // Rendered from scratch, so the two panels are compared independently.
    cleanup();
    render(<ForgotPasswordForm />);
    await submit('nobody@example.com');
    const unknown = (await screen.findByRole('status')).textContent;

    // US-6.1 — the wording is identical whether or not the account exists, and
    // the UI must never branch on existence.
    expect(known).toBe(unknown);
  });

  it('says the link is on its way, not that it was sent', async () => {
    render(<ForgotPasswordForm />);
    await submit('nicolas@example.com');

    const panel = await screen.findByRole('status');
    // US-6.3 — the mail is dispatched after the response, so the API has not
    // observed a successful send at the time it answers.
    expect(panel).toHaveTextContent(/on its way/i);
    expect(panel).not.toHaveTextContent(/\bsent\b/i);
    expect(panel).toHaveTextContent(/30 minutes/i);
  });

  it('replaces the form with the panel', async () => {
    render(<ForgotPasswordForm />);
    await submit('nicolas@example.com');

    await waitFor(() => expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument());
  });

  it('offers a resend only after 60 seconds', async () => {
    vi.useFakeTimers();
    render(<ForgotPasswordForm />);
    await submit('nicolas@example.com');
    await screen.findByRole('status');

    expect(screen.queryByRole('button', { name: /resend/i })).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.getByRole('button', { name: /resend/i })).toBeInTheDocument();
  });

  it('shows the wait message on a 429 rather than a raw code', async () => {
    forgotPasswordAction.mockResolvedValue({
      ok: false,
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'slow down',
    });

    render(<ForgotPasswordForm />);
    await submit('nicolas@example.com');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /please wait before requesting another link/i,
    );
  });
});
