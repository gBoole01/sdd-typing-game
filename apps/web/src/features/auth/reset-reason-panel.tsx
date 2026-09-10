import Link from 'next/link';
import type { ResetTokenReason } from '@typing-game/contracts';

/**
 * Spec 001 US-6.7 — the page says "this link has expired", not "something went
 * wrong". Each reason removes a dead end from the UX, and by the time a token is
 * presented, saying why it failed leaks nothing (§ 5).
 */
const COPY: Record<ResetTokenReason, string> = {
  EXPIRED: 'This link has expired. Reset links are valid for 30 minutes.',
  USED: 'This link has already been used. Each link works once.',
  SUPERSEDED: 'A newer link was requested, so this one no longer works.',
  INVALID: 'This link is not valid.',
};

export function ResetReasonPanel({ reason }: { reason: ResetTokenReason }): React.ReactElement {
  return (
    <div data-testid="reset-reason">
      <p>{COPY[reason]}</p>
      <Link href="/forgot-password">Request a new link</Link>
    </div>
  );
}
