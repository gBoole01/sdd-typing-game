import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsForm } from './settings-form';

/**
 * Spec 001 § 9 "Frontend — settings-form.test.tsx", against § 6
 * `/account/settings`.
 *
 * Optimistic is appropriate here: these writes are small, idempotent, and a
 * stale toggle is a visible lie.
 */

const updateSettingsAction = vi.hoisted(() => vi.fn());
vi.mock('@/app/(account)/actions', () => ({ updateSettingsAction }));

const SETTINGS = {
  caretStyle: 'SMOOTH' as const,
  soundEnabled: false,
  theme: 'SYSTEM' as const,
  defaultDuration: 30 as const,
  defaultMode: 'TIME' as const,
  language: 'en',
  blindMode: false,
  stopOnError: false,
};

beforeEach(() => {
  updateSettingsAction.mockReset().mockResolvedValue({ ok: true });
});

const sound = () => screen.getByLabelText(/sound/i);

describe('SettingsForm', () => {
  it('renders every preference the spec names', () => {
    render(<SettingsForm settings={SETTINGS} />);

    expect(screen.getByRole('group', { name: /caret/i })).toBeInTheDocument();
    expect(sound()).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /theme/i })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /duration/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/blind mode/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/stop on error/i)).toBeInTheDocument();
  });

  it('offers only the four allowed durations', () => {
    render(<SettingsForm settings={SETTINGS} />);

    const durations = screen.getByRole('group', { name: /duration/i });
    for (const value of ['15', '30', '60', '120']) {
      expect(within(durations).getByRole('radio', { name: value })).toBeInTheDocument();
    }
    expect(within(durations).getAllByRole('radio')).toHaveLength(4);
  });

  it('applies a toggle immediately, before the server answers', async () => {
    const user = userEvent.setup({
    // user-event rejects an advanceTimers callback when the timer APIs are not
    // mocked, and only some tests here fake them.
    advanceTimers: (ms) => {
      if (vi.isFakeTimers()) vi.advanceTimersByTime(ms);
    },
  });
    let release: (value: unknown) => void = () => undefined;
    updateSettingsAction.mockImplementation(() => new Promise((resolve) => (release = resolve)));

    render(<SettingsForm settings={SETTINGS} />);
    await user.click(sound());

    // useOptimistic — the control reflects the intent at once.
    expect(sound()).toBeChecked();

    release({ ok: true });
  });

  it('reverts and explains itself when the write fails', async () => {
    vi.useFakeTimers();
    const user = userEvent.setup({
    // user-event rejects an advanceTimers callback when the timer APIs are not
    // mocked, and only some tests here fake them.
    advanceTimers: (ms) => {
      if (vi.isFakeTimers()) vi.advanceTimersByTime(ms);
    },
  });
    updateSettingsAction.mockResolvedValue({
      ok: false,
      code: 'VALIDATION_FAILED',
      message: 'nope',
    });

    render(<SettingsForm settings={SETTINGS} />);
    await user.click(sound());
    expect(sound()).toBeChecked();

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    await waitFor(() => expect(sound()).not.toBeChecked());
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't save|could not save|failed/i);
  });

  it('coalesces rapid changes into one call', async () => {
    vi.useFakeTimers();
    const user = userEvent.setup({
    // user-event rejects an advanceTimers callback when the timer APIs are not
    // mocked, and only some tests here fake them.
    advanceTimers: (ms) => {
      if (vi.isFakeTimers()) vi.advanceTimersByTime(ms);
    },
  });
    render(<SettingsForm settings={SETTINGS} />);

    await user.click(sound());
    await user.click(sound());
    await user.click(sound());

    expect(updateSettingsAction).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    // Debounced 500 ms: three clicks, one write.
    expect(updateSettingsAction).toHaveBeenCalledTimes(1);
  });

  it('sends the settled value, not each intermediate one', async () => {
    vi.useFakeTimers();
    const user = userEvent.setup({
    // user-event rejects an advanceTimers callback when the timer APIs are not
    // mocked, and only some tests here fake them.
    advanceTimers: (ms) => {
      if (vi.isFakeTimers()) vi.advanceTimersByTime(ms);
    },
  });
    render(<SettingsForm settings={SETTINGS} />);

    await user.click(sound());
    await user.click(sound());

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(updateSettingsAction).toHaveBeenCalledWith(
      expect.objectContaining({ soundEnabled: false }),
    );
  });
});
