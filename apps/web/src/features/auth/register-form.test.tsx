import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RegisterForm } from './register-form';

/** Spec 001 § 9 "Frontend — register-form.test.tsx", against § 6 `/register`. */

const registerAction = vi.hoisted(() => vi.fn());
const checkUsername = vi.hoisted(() => vi.fn());

vi.mock('@/app/(auth)/actions', () => ({ registerAction }));
vi.mock('@/lib/username-availability', () => ({ checkUsernameAvailability: checkUsername }));

beforeEach(() => {
  registerAction.mockReset().mockResolvedValue(null);
  checkUsername.mockReset().mockResolvedValue({ available: true, reason: null });
});

async function fill(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText(/email/i), 'nicolas@example.com');
  await user.type(screen.getByLabelText(/username/i), 'nico');
  await user.type(screen.getByLabelText(/password/i), 'correct horse battery');
}

describe('RegisterForm', () => {
  it('updates the password rule checklist live', async () => {
    const user = userEvent.setup();
    render(<RegisterForm />);

    const lengthRule = screen.getByTestId('rule-length');
    expect(lengthRule).toHaveAttribute('data-satisfied', 'false');

    await user.type(screen.getByLabelText(/password/i), 'correct horse battery');
    await waitFor(() => expect(lengthRule).toHaveAttribute('data-satisfied', 'true'));
  });

  it('marks the password rule unsatisfied when it equals the email', async () => {
    const user = userEvent.setup();
    render(<RegisterForm />);

    await user.type(screen.getByLabelText(/email/i), 'nicolas@example.com');
    await user.type(screen.getByLabelText(/password/i), 'nicolas@example.com');

    await waitFor(() =>
      expect(screen.getByTestId('rule-distinct')).toHaveAttribute('data-satisfied', 'false'),
    );
  });

  it('has no strength meter, which would imply precision the rules do not have', () => {
    render(<RegisterForm />);
    expect(screen.queryByTestId('password-strength')).not.toBeInTheDocument();
  });

  it('gates submission on acceptedTerms and links to both documents in new tabs', async () => {
    const user = userEvent.setup();
    render(<RegisterForm />);
    await fill(user);

    const submit = screen.getByRole('button', { name: /create account|sign up/i });
    expect(submit).toBeDisabled();

    const terms = screen.getByRole('link', { name: /terms/i });
    const privacy = screen.getByRole('link', { name: /privacy/i });
    expect(terms).toHaveAttribute('href', '/terms');
    expect(terms).toHaveAttribute('target', '_blank');
    expect(privacy).toHaveAttribute('href', '/privacy');

    await user.click(screen.getByLabelText(/accept|agree/i));
    await waitFor(() => expect(submit).toBeEnabled());
  });

  it.each([
    ['EMAIL_ALREADY_REGISTERED', /email/i],
    ['USERNAME_TAKEN', /username/i],
  ])('places %s on its own field', async (code, field) => {
    const user = userEvent.setup();
    registerAction.mockResolvedValue({ ok: false, code, message: 'taken' });

    render(<RegisterForm />);
    await fill(user);
    await user.click(screen.getByLabelText(/accept|agree/i));
    await user.click(screen.getByRole('button', { name: /create account|sign up/i }));

    await waitFor(() =>
      expect(screen.getByLabelText(field)).toHaveAccessibleDescription(/taken|already/i),
    );
  });

  it('offers a prefilled login link when the email is already registered', async () => {
    const user = userEvent.setup();
    registerAction.mockResolvedValue({
      ok: false,
      code: 'EMAIL_ALREADY_REGISTERED',
      message: 'taken',
    });

    render(<RegisterForm />);
    await fill(user);
    await user.click(screen.getByLabelText(/accept|agree/i));
    await user.click(screen.getByRole('button', { name: /create account|sign up/i }));

    expect(await screen.findByRole('link', { name: /log in/i })).toHaveAttribute(
      'href',
      '/login?email=nicolas%40example.com',
    );
  });

  it('names both scripts when a username mixes them', async () => {
    const user = userEvent.setup();
    checkUsername.mockResolvedValue({
      available: false,
      reason: 'MIXED_SCRIPT',
      scripts: ['Latin', 'Cyrillic'],
    });

    render(<RegisterForm />);
    await user.type(screen.getByLabelText(/username/i), 'nіco');

    // § 4 — "looks like Latin and Cyrillic mixed" is actionable; "invalid" is not.
    const feedback = await screen.findByTestId('username-feedback');
    expect(feedback).toHaveTextContent(/Latin/);
    expect(feedback).toHaveTextContent(/Cyrillic/);
  });

  it.each([
    ['TAKEN', /taken/i],
    ['RESERVED', /reserved|not available/i],
    ['INVALID_FORMAT', /letters|digits|underscore/i],
  ])('reports %s inline', async (reason, expected) => {
    const user = userEvent.setup();
    checkUsername.mockResolvedValue({ available: false, reason });

    render(<RegisterForm />);
    await user.type(screen.getByLabelText(/username/i), 'admin');

    expect(await screen.findByTestId('username-feedback')).toHaveTextContent(expected);
  });

  it('debounces the availability check', async () => {
    const user = userEvent.setup();
    render(<RegisterForm />);

    await user.type(screen.getByLabelText(/username/i), 'nicolas');
    await waitFor(() => expect(checkUsername).toHaveBeenCalled());

    // Advisory only; the authoritative check is the 409 on submit. One call for
    // seven keystrokes is the point of the 400 ms debounce.
    expect(checkUsername).toHaveBeenCalledTimes(1);
  });

  it('renders the guest banner only when there are unsaved results', () => {
    const { rerender } = render(<RegisterForm guestResultCount={0} />);
    expect(screen.queryByTestId('guest-banner')).not.toBeInTheDocument();

    rerender(<RegisterForm guestResultCount={3} />);
    // US-2.5 made visible.
    expect(screen.getByTestId('guest-banner')).toHaveTextContent(/3 unsaved results/i);
  });
});
