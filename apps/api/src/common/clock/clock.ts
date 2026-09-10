/**
 * Spec 001 § 8 *Time*. Every time-dependent decision — grace window, session and
 * token expiry, the 30-day username cooldown, reset TTLs — reads from here and
 * compares in application code. No `now()` or `CURRENT_TIMESTAMP` appears in an
 * application SQL predicate, and no `new Date()` appears at a call site. Prisma
 * `@default(now())` on creation columns is exempt: a write-time default is never
 * a comparison.
 *
 * This is what makes the fake-clock suites of § 9 possible against a real Postgres.
 */
export const CLOCK = Symbol('CLOCK');

export interface Clock {
  now(): Date;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
