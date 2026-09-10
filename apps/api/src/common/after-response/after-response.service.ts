import { Injectable, Logger } from '@nestjs/common';

export const AFTER_RESPONSE = Symbol('AFTER_RESPONSE');

/**
 * Work dispatched *after* a response has been returned (spec 001 US-6.3).
 *
 * Awaiting an SMTP round trip on the known-account branch only would make
 * `/auth/forgot-password` an order-of-magnitude timing oracle for exactly the
 * fact US-6.1 hides. A failure here cannot alter a status code, because no
 * status code is still open — it is caught, logged with the `requestId`, and
 * dropped (US-6.9, Q23: no retry queue in v1).
 */
@Injectable()
export class AfterResponse {
  private readonly logger = new Logger(AfterResponse.name);
  private readonly inFlight = new Set<Promise<void>>();

  run(task: () => Promise<void>, context: { requestId?: string } = {}): void {
    const settled = task().catch((error: unknown) => {
      this.logger.error(
        { requestId: context.requestId, err: error },
        `Deferred task failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });

    this.inFlight.add(settled);
    void settled.finally(() => this.inFlight.delete(settled));
  }

  /** The e2e suites await this so "after the response" is not "after the test". */
  async flush(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.all([...this.inFlight]);
    }
  }
}
