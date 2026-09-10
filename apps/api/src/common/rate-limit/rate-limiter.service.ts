import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import { CLOCK, type Clock } from '../clock/clock';
import { AppException } from '../errors/app.exception';
import { ResettableThrottlerStorage } from '../throttler/resettable-throttler.storage';

/**
 * Counting is done against the injected `Clock` (§ 8 *Time*), so a suite that
 * advances time advances the rate-limit window with it.
 */
@Injectable()
export class RateLimiterService {
  constructor(
    private readonly storage: ResettableThrottlerStorage,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  consume(key: string, limit: number, ttlSeconds: number): void {
    const record = this.storage.hit(key, limit, ttlSeconds * 1_000, this.clock.now().getTime());

    if (record.isBlocked) {
      throw new AppException(
        'RATE_LIMIT_EXCEEDED',
        'Too many requests. Try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
        [{ path: '', message: `Retry in ${Math.ceil(record.timeToExpire / 1_000)} seconds.` }],
      );
    }
  }
}
