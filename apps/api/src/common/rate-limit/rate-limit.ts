import { SetMetadata } from '@nestjs/common';

/** Spec 001 § 8 *Rate limits*. Every unqualified figure there is per client IP. */
export type RateLimitScope = 'ip' | 'email';

export interface RateLimitRule {
  scope: RateLimitScope;
  limit: number;
  ttlSeconds: number;
}

export const RATE_LIMIT = 'rate-limit:rules';

export const RateLimit = (...rules: RateLimitRule[]): MethodDecorator =>
  SetMetadata(RATE_LIMIT, rules);

export const perIp = (limit: number, ttlSeconds: number): RateLimitRule => ({
  scope: 'ip',
  limit,
  ttlSeconds,
});

export const perEmail = (limit: number, ttlSeconds: number): RateLimitRule => ({
  scope: 'email',
  limit,
  ttlSeconds,
});

export const MINUTE = 60;
export const QUARTER_HOUR = 15 * MINUTE;
export const HOUR = 60 * MINUTE;
