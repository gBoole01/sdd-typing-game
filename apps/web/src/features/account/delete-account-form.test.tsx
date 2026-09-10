import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DeleteAccountForm } from './delete-account-form';

/** Spec 001 § 9 "Frontend — delete-account-form.test.tsx", against § 6 `/account/danger`. */

const deleteAccountAction = vi.hoisted(() => vi.fn());
vi.mock('@/app/(account)/actions', () => ({ deleteAccountAction }));

beforeEach(() => {
  deleteAccountAction.mockReset().mockResolvedValue(null);
});

const confirmField = () => screen.getByLabelText(/type delete|confirm/i);
const passwordField = () => screen.getByLabelText(/password/i);
const resultsCheckbox = () => screen.getByLabelText(/also delete my results/i);
const submit = () => screen.getByRole('button', { name: /delete my account|delete account/i });

describe('DeleteAccountForm', () => {
  it('states both outcomes before submission, and defaults to anonymising', () => {
    render(<DeleteAccountForm />);

    // US-8.5 — the default is not a silent choice.
    expect(resultsCheckbox()).not.toBeChecked();
    expect(screen.getByTestId('deletion-consequence')).toHaveTextContent(
      /kept without your name attached/i,
    );
    expect(screen.getByTestId('deletion-consequence')).toHaveTextContent(/leaderboards stay accurate/i);
  });

  it('changes the copy when results are included', async () => {
    const user = userEvent.setup();
    render(<DeleteAccountForm />);

    await user.click(resultsCheckbox());

    expect(screen.getByTestId('deletion-consequence')).toHaveTextContent(
      /every result you have recorded are deleted permanently|cannot be undone/i,
    );
  });

  it('keeps submit disabled until the confirmation matches exactly', async () => {
    const user = userEvent.setup();
    render(<DeleteAccountForm />);

    expect(submit()).toBeDisabled();

    await user.type(passwordField(), 'correct horse battery');
    expect(submit()).toBeDisabled();

    await user.type(confirmField(), 'delete');
    expect(submit()).toBeDisabled();

    await user.clear(confirmField());
    await user.type(confirmField(), 'DELETE ');
    expect(submit()).toBeDisabled();

    await user.clear(confirmField());
    await user.type(confirmField(), 'DELETE');
    await waitFor(() => expect(submit()).toBeEnabled());
  });

  it('stays disabled without a password', async () => {
    const user = userEvent.setup();
    render(<DeleteAccountForm />);

    await user.type(confirmField(), 'DELETE');
    expect(submit()).toBeDisabled();
  });

  it('sends deleteResults as a boolean', async () => {
    const user = userEvent.setup();
    render(<DeleteAccountForm />);

    await user.type(passwordField(), 'correct horse battery');
    await user.type(confirmField(), 'DELETE');
    await user.click(resultsCheckbox());
    await user.click(submit());

    await waitFor(() => expect(deleteAccountAction).toHaveBeenCalled());

    // The API schema is strict, and "on" is not a boolean.
    const formData = deleteAccountAction.mock.calls[0][1] as FormData;
    expect(formData.get('deleteResults')).toBe('true');
  });

  it('places a wrong password on the password field', async () => {
    const user = userEvent.setup();
    deleteAccountAction.mockResolvedValue({
      ok: false,
      code: 'INVALID_CREDENTIALS',
      message: 'wrong',
    });

    render(<DeleteAccountForm />);
    await user.type(passwordField(), 'not the password');
    await user.type(confirmField(), 'DELETE');
    await user.click(submit());

    await waitFor(() => expect(passwordField()).toHaveAccessibleDescription(/incorrect|wrong/i));
  });
});
