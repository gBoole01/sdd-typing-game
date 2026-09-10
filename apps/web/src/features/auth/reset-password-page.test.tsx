import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api, server } from '@/test/msw';

/** Spec 001 § 9 "Frontend — reset-password-page.test.tsx", against § 6 `/reset-password`. */

const resetPasswordAction = vi.hoisted(() => vi.fn());
vi.mock('@/app/(auth)/actions', () => ({ resetPasswordAction }));
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

const validation = (body: { valid: boolean; reason: string | null }) =>
  server.use(http.get(api('/auth/reset-password/validate'), () => HttpResponse.json(body)));

/** The page is an async Server Component: awaited, then rendered. */
async function renderPage(searchParams: Record<string, string>): Promise<void> {
  const { default: ResetPasswordPage } = await import('@/app/(auth)/reset-password/page');
  const element = await ResetPasswordPage({ searchParams: Promise.resolve(searchParams) });
  render(element);
}

beforeEach(() => {
  resetPasswordAction.mockReset().mockResolvedValue(null);
});

describe('/reset-password', () => {
  it('says the link is incomplete when no token is present, and renders no form', async () => {
    await renderPage({});

    expect(screen.getByRole('heading', { name: /incomplete/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/new password/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /request a new link/i })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  it.each([
    ['EXPIRED', /expired/i],
    ['USED', /already been used/i],
    ['SUPERSEDED', /newer link|more recent/i],
    ['INVALID', /not valid|isn't valid/i],
  ])('renders a reason-specific panel for %s and no form', async (reason, copy) => {
    validation({ valid: false, reason });
    await renderPage({ token: 'tok' });

    // US-6.7 — the page says "this link has expired", not "something went wrong".
    expect(screen.getByTestId('reset-reason')).toHaveTextContent(copy);
    expect(screen.queryByLabelText(/new password/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /request a new link/i })).toBeInTheDocument();
  });

  it('renders the form for a valid token', async () => {
    validation({ valid: true, reason: null });
    await renderPage({ token: 'tok' });

    expect(screen.getByLabelText(/^new password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm/i)).toBeInTheDocument();
  });

  it('keeps the token out of client storage and asks robots not to index', async () => {
    validation({ valid: true, reason: null });
    await renderPage({ token: 'secret-token' });

    const { metadata } = await import('@/app/(auth)/reset-password/page');
    expect(metadata).toMatchObject({ robots: { index: false } });
    expect(window.localStorage.getItem('token')).toBeNull();
    expect(JSON.stringify(window.localStorage)).not.toContain('secret-token');
  });

  it('matches the confirmation client-side, and sends only one password field', async () => {
    const user = userEvent.setup();
    validation({ valid: true, reason: null });
    await renderPage({ token: 'tok' });

    await user.type(screen.getByLabelText(/^new password/i), 'a brand new passphrase');
    await user.type(screen.getByLabelText(/confirm/i), 'a different passphrase');
    await user.click(screen.getByRole('button', { name: /set|update|reset/i }));

    expect(await screen.findByText(/do not match|don't match/i)).toBeInTheDocument();
    expect(resetPasswordAction).not.toHaveBeenCalled();
  });

  it('re-renders the reason panel when the token expires between load and submit', async () => {
    const user = userEvent.setup();
    validation({ valid: true, reason: null });
    resetPasswordAction.mockResolvedValue({
      ok: false,
      code: 'RESET_TOKEN_EXPIRED',
      message: 'expired',
    });

    await renderPage({ token: 'tok' });

    await user.type(screen.getByLabelText(/^new password/i), 'a brand new passphrase');
    await user.type(screen.getByLabelText(/confirm/i), 'a brand new passphrase');
    await user.click(screen.getByRole('button', { name: /set|update|reset/i }));

    // § 6 — the action's RESET_TOKEN_* errors render the same reason panels
    // rather than a form error.
    await waitFor(() => expect(screen.getByTestId('reset-reason')).toHaveTextContent(/expired/i));
    expect(screen.queryByLabelText(/^new password/i)).not.toBeInTheDocument();
  });

  it('has no unchanged-password error state', async () => {
    const user = userEvent.setup();
    validation({ valid: true, reason: null });
    resetPasswordAction.mockResolvedValue(null);

    await renderPage({ token: 'tok' });

    await user.type(screen.getByLabelText(/^new password/i), 'correct horse battery');
    await user.type(screen.getByLabelText(/confirm/i), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: /set|update|reset/i }));

    // US-6.10, Q14 — reusing the old password succeeds silently, which is the
    // correct outcome for someone who has just proved control of the mailbox.
    await waitFor(() => expect(resetPasswordAction).toHaveBeenCalled());
    expect(screen.queryByText(/PASSWORD_UNCHANGED/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/same as your current/i)).not.toBeInTheDocument();
  });
});
