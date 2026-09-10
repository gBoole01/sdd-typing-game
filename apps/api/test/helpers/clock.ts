import type { Clock } from '../../src/common/clock/clock';

/**
 * The fake clock every time-dependent suite runs on (spec 001 § 9
 * "Test-infrastructure obligations"). It is sufficient only because § 8 *Time*
 * forbids `now()` in an application SQL predicate: every expiry, grace-window
 * and cooldown decision is made in application code against this instant, so
 * advancing it advances all of them against a real Postgres.
 */
export class FakeClock implements Clock {
  private current: Date;

  constructor(start: Date = new Date('2026-09-10T14:32:05.123Z')) {
    this.current = new Date(start);
  }

  now(): Date {
    return new Date(this.current);
  }

  set(instant: Date): void {
    this.current = new Date(instant);
  }

  advanceMs(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  advanceSeconds(seconds: number): void {
    this.advanceMs(seconds * 1_000);
  }

  advanceMinutes(minutes: number): void {
    this.advanceSeconds(minutes * 60);
  }

  advanceDays(days: number): void {
    this.advanceMinutes(days * 24 * 60);
  }
}
