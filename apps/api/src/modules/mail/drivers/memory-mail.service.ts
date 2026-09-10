import { Injectable } from '@nestjs/common';

import type { MailService } from '../mail.port';

export interface RecordedMail {
  to: string;
  resetUrl: string;
  expiresInMinutes: number;
}

/**
 * The `memory` driver of spec 001 § 5. Records calls so the e2e suite can assert
 * the reset URL, and can be told to fail once so US-6.9 ("a mail-provider
 * failure does not change the 202") is testable.
 */
@Injectable()
export class MemoryMailService implements MailService {
  readonly records: RecordedMail[] = [];
  private nextFailure: Error | null = null;

  failNext(error: Error): void {
    this.nextFailure = error;
  }

  reset(): void {
    this.records.length = 0;
    this.nextFailure = null;
  }

  async sendPasswordReset(
    to: string,
    resetUrl: string,
    expiresInMinutes: number,
  ): Promise<void> {
    if (this.nextFailure) {
      const failure = this.nextFailure;
      this.nextFailure = null;
      throw failure;
    }

    this.records.push({ to, resetUrl, expiresInMinutes });
  }
}
