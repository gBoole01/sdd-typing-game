export const MAIL_SERVICE = Symbol('MAIL_SERVICE');

/**
 * Spec 001 § 5 *Mail port*. One method per template, injected by driver, so the
 * provider decision (Q22: Amazon SES in production) stays behind an unchanged
 * interface and local development stays on Mailpit.
 */
export interface MailService {
  sendPasswordReset(to: string, resetUrl: string, expiresInMinutes: number): Promise<void>;
}

/** § 5 — send timeout. A failure is off the response path and cannot alter a status code. */
export const MAIL_SEND_TIMEOUT_MS = 5_000;

export function renderPasswordReset(
  resetUrl: string,
  expiresInMinutes: number,
): { subject: string; text: string } {
  return {
    subject: 'Reset your Typing Game password',
    // "If you didn't request this, ignore it" is documented behaviour (§ 7), not
    // boilerplate: the token is single-use and short-lived, and a forwarded mail
    // is the threat it mitigates.
    text: [
      'Someone asked to reset the password for your Typing Game account.',
      '',
      `Use this link within ${expiresInMinutes} minutes:`,
      resetUrl,
      '',
      "If you didn't request this, ignore this message — nothing has changed.",
    ].join('\n'),
  };
}
