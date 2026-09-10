import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SessionsList } from './sessions-list';

/**
 * Spec 001 § 9 "Frontend — sessions-list.test.tsx", against § 6
 * `/account/security` and US-5.3.
 *
 * The heading is *Devices*, not *Sessions*: the rows are one per device now,
 * and the word should say so.
 */

const revokeSessionAction = vi.hoisted(() => vi.fn());
const logoutAllAction = vi.hoisted(() => vi.fn());

vi.mock('@/app/(account)/actions', () => ({ revokeSessionAction, logoutAllAction }));

const CURRENT = {
  id: 'session-current',
  current: true,
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  createdAt: '2026-09-10T14:32:05.123Z',
  lastUsedAt: '2026-09-10T15:02:41.000Z',
  expiresAt: '2026-10-10T14:32:05.123Z',
};

const OTHER = {
  id: 'session-other',
  current: false,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
  createdAt: '2026-09-09T10:00:00.000Z',
  lastUsedAt: '2026-09-09T11:00:00.000Z',
  expiresAt: '2026-10-09T10:00:00.000Z',
};

beforeEach(() => {
  revokeSessionAction.mockReset().mockResolvedValue({ ok: true });
  logoutAllAction.mockReset().mockResolvedValue({ ok: true });
});

const rows = (): HTMLElement[] => screen.getAllByRole('listitem');

describe('SessionsList', () => {
  it('calls the list Devices', () => {
    render(<SessionsList sessions={[CURRENT]} passwordChangedAt={null} />);
    expect(screen.getByRole('heading', { name: /devices/i })).toBeInTheDocument();
  });

  it('renders one row per device, however often the token rotated', () => {
    // Five rotations upstream still produce a single Session row, because `sid`
    // names the device (Q6). The component renders exactly what it is given.
    render(<SessionsList sessions={[CURRENT]} passwordChangedAt={null} />);

    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toHaveTextContent(/this device/i);
  });

  it('labels the current device and offers it no revoke button', () => {
    render(<SessionsList sessions={[CURRENT, OTHER]} passwordChangedAt={null} />);

    const [current, other] = rows();
    expect(within(current).getByText(/this device/i)).toBeInTheDocument();
    // Revoking the current row is not offered — the header's Log out does that.
    expect(within(current).queryByRole('button', { name: /revoke/i })).not.toBeInTheDocument();
    expect(within(other).getByRole('button', { name: /revoke/i })).toBeInTheDocument();
  });

  it('describes a device with no user agent as unknown', () => {
    render(
      <SessionsList sessions={[{ ...OTHER, userAgent: null }]} passwordChangedAt={null} />,
    );

    // § 7 — a missing User-Agent is a null column, not a crash.
    expect(rows()[0]).toHaveTextContent(/unknown device/i);
  });

  it('shows passwordChangedAt above the list for context', () => {
    render(
      <SessionsList sessions={[CURRENT]} passwordChangedAt="2026-09-01T09:00:00.000Z" />,
    );

    expect(screen.getByTestId('password-changed-at')).toHaveTextContent(/1 September 2026|2026/);
  });

  it('removes a revoked row', async () => {
    const user = userEvent.setup();
    render(<SessionsList sessions={[CURRENT, OTHER]} passwordChangedAt={null} />);

    await user.click(within(rows()[1]).getByRole('button', { name: /revoke/i }));

    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(revokeSessionAction).toHaveBeenCalledWith(OTHER.id);
  });

  it('treats SESSION_NOT_FOUND as success, with no error toast', async () => {
    const user = userEvent.setup();
    revokeSessionAction.mockResolvedValue({
      ok: false,
      code: 'SESSION_NOT_FOUND',
      message: 'gone',
    });

    render(<SessionsList sessions={[CURRENT, OTHER]} passwordChangedAt={null} />);
    await user.click(within(rows()[1]).getByRole('button', { name: /revoke/i }));

    // § 6 — the row was already gone; the user's intent was satisfied either
    // way, so the list refreshes silently.
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('surfaces a genuine failure', async () => {
    const user = userEvent.setup();
    revokeSessionAction.mockResolvedValue({
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'boom',
    });

    render(<SessionsList sessions={[CURRENT, OTHER]} passwordChangedAt={null} />);
    await user.click(within(rows()[1]).getByRole('button', { name: /revoke/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(rows()).toHaveLength(2);
  });

  it('puts sign-out-everywhere behind a confirmation', async () => {
    const user = userEvent.setup();
    render(<SessionsList sessions={[CURRENT, OTHER]} passwordChangedAt={null} />);

    await user.click(screen.getByRole('button', { name: /sign out everywhere/i }));
    expect(logoutAllAction).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /sign out everywhere|confirm/i }));

    await waitFor(() => expect(logoutAllAction).toHaveBeenCalledTimes(1));
  });
});
