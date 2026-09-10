'use client';

import type { DeviceSession } from '@typing-game/contracts';
import { useState } from 'react';

import { logoutAllAction, revokeSessionAction } from '@/app/(account)/actions';

/**
 * Spec 001 § 6 `/account/security`.
 *
 * The heading is *Devices*, not *Sessions*: since Q6 split the device from the
 * token it holds, each row is one device the user recognises, and the word
 * should say so. Row ids are stable for the life of the device, so a revoke
 * button cannot go stale merely because the token rotated.
 */

function describeDevice(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  if (/iPhone|iPad/i.test(userAgent)) return 'iPhone or iPad';
  if (/Android/i.test(userAgent)) return 'Android device';
  if (/Macintosh|Mac OS X/i.test(userAgent)) return 'Mac';
  if (/Windows/i.test(userAgent)) return 'Windows PC';
  if (/Linux/i.test(userAgent)) return 'Linux computer';
  return 'Unknown device';
}

const formatDate = (value: string): string =>
  new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

export function SessionsList({
  sessions,
  passwordChangedAt,
}: {
  sessions: DeviceSession[];
  passwordChangedAt: string | null;
}): React.ReactElement {
  const [revoked, setRevoked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const visible = sessions
    .filter((session) => !revoked.includes(session.id))
    .sort((a, b) => Number(b.current) - Number(a.current));

  async function revoke(id: string): Promise<void> {
    const result = await revokeSessionAction(id);

    // SESSION_NOT_FOUND means the row was already gone; the user's intent was
    // satisfied either way, so the list refreshes silently rather than showing
    // an error (§ 6).
    if (!result || result.ok || result.code === 'SESSION_NOT_FOUND') {
      setRevoked((current) => [...current, id]);
      setError(null);
      return;
    }

    setError("We couldn't sign that device out. Try again.");
  }

  return (
    <section>
      <h2>Devices</h2>

      {passwordChangedAt ? (
        <p data-testid="password-changed-at">
          Password last changed on {formatDate(passwordChangedAt)}.
        </p>
      ) : null}

      {error ? <p role="alert">{error}</p> : null}

      <ul>
        {visible.map((session) => (
          <li key={session.id}>
            <span>{describeDevice(session.userAgent)}</span>
            <span>Last used {formatDate(session.lastUsedAt)}</span>

            {session.current ? (
              // Revoking the current row is not offered — the header's Log out
              // does that.
              <span>This device</span>
            ) : (
              <button type="button" onClick={() => void revoke(session.id)}>
                Revoke
              </button>
            )}
          </li>
        ))}
      </ul>

      <button type="button" onClick={() => setConfirming(true)}>
        Sign out everywhere
      </button>

      {confirming ? (
        <div role="dialog" aria-modal="true" aria-label="Sign out of every device?">
          <p>Every device, including this one, will be signed out.</p>
          <button type="button" onClick={() => setConfirming(false)}>
            Cancel
          </button>
          <button type="button" onClick={() => void logoutAllAction()}>
            Sign out everywhere
          </button>
        </div>
      ) : null}
    </section>
  );
}
