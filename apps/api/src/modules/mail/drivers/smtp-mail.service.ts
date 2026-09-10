import { Injectable } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';

import { MAIL_SEND_TIMEOUT_MS, renderPasswordReset, type MailService } from '../mail.port';

/** The `smtp` driver: Mailpit in local development (SMTP :1025, UI :8025). */
@Injectable()
export class SmtpMailService implements MailService {
  private readonly transporter: Transporter;

  constructor(
    smtpUrl: string,
    private readonly from: string,
  ) {
    // Built explicitly rather than handed the URL: `createTransport`'s second
    // argument is message defaults, not connection options, so the timeouts
    // would silently not apply.
    const url = new URL(smtpUrl);
    const secure = url.protocol === 'smtps:';

    this.transporter = createTransport({
      host: url.hostname,
      port: Number(url.port) || (secure ? 465 : 587),
      secure,
      ...(url.username
        ? {
            auth: {
              user: decodeURIComponent(url.username),
              pass: decodeURIComponent(url.password),
            },
          }
        : {}),
      connectionTimeout: MAIL_SEND_TIMEOUT_MS,
      greetingTimeout: MAIL_SEND_TIMEOUT_MS,
      socketTimeout: MAIL_SEND_TIMEOUT_MS,
    });
  }

  async sendPasswordReset(
    to: string,
    resetUrl: string,
    expiresInMinutes: number,
  ): Promise<void> {
    const { subject, text } = renderPasswordReset(resetUrl, expiresInMinutes);
    await this.transporter.sendMail({ from: this.from, to, subject, text });
  }
}
