import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AFTER_RESPONSE, AfterResponse } from './after-response/after-response.service';
import { TRUSTED_PROXY_CIDRS } from './client-ip/client-ip.tokens';
import type { Env } from '../config/env.schema';
import { CookieService } from './cookies/cookie.service';
import { RateLimiterService } from './rate-limit/rate-limiter.service';
import { ResettableThrottlerStorage } from './throttler/resettable-throttler.storage';

/**
 * Cross-cutting singletons. The rate-limit storage is deliberately one instance
 * per process: spec 002 § 10 Q5 rules out Redis, so every limit in spec 001 § 8
 * is per API instance — a recorded limitation, not an oversight.
 */
@Global()
@Module({
  providers: [
    {
      provide: TRUSTED_PROXY_CIDRS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): readonly string[] =>
        config.get('TRUSTED_PROXY_CIDRS', { infer: true }),
    },
    AfterResponse,
    { provide: AFTER_RESPONSE, useExisting: AfterResponse },
    ResettableThrottlerStorage,
    RateLimiterService,
    CookieService,
  ],
  exports: [
    TRUSTED_PROXY_CIDRS,
    AfterResponse,
    AFTER_RESPONSE,
    ResettableThrottlerStorage,
    RateLimiterService,
    CookieService,
  ],
})
export class CommonModule {}
