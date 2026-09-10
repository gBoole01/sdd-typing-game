import { Injectable } from '@nestjs/common';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

import { MAIL_SEND_TIMEOUT_MS, renderPasswordReset, type MailService } from '../mail.port';

/**
 * The `ses` driver (Q22). Uses `SendEmailCommand`, not SES's SMTP endpoint: the
 * SDK resolves credentials from the default provider chain, so in production the
 * container's IAM task role signs the call and there is no mail secret in the
 * environment at all. The SMTP endpoint would require long-lived credentials to
 * store and rotate — the credential class most likely to end up in a log.
 */
@Injectable()
export class SesMailService implements MailService {
  private readonly client: SESv2Client;

  constructor(
    region: string,
    private readonly from: string,
    private readonly configurationSet?: string,
  ) {
    this.client = new SESv2Client({
      region,
      requestHandler: { requestTimeout: MAIL_SEND_TIMEOUT_MS },
    });
  }

  async sendPasswordReset(
    to: string,
    resetUrl: string,
    expiresInMinutes: number,
  ): Promise<void> {
    const { subject, text } = renderPasswordReset(resetUrl, expiresInMinutes);

    await this.client.send(
      new SendEmailCommand({
        FromEmailAddress: this.from,
        Destination: { ToAddresses: [to] },
        // Bounce and complaint events are published through this set; SES
        // suspends over roughly 5% bounces or 0.1% complaints (§ 5).
        ...(this.configurationSet ? { ConfigurationSetName: this.configurationSet } : {}),
        Content: {
          Simple: {
            Subject: { Data: subject, Charset: 'UTF-8' },
            Body: { Text: { Data: text, Charset: 'UTF-8' } },
          },
        },
      }),
    );
  }
}
