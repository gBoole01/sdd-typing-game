import { Injectable } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';

interface Bucket {
  hits: number;
  expiresAt: number;
}

/**
 * In-process rate-limit state (spec 002 § 10, Q5 — no Redis). Every limit in
 * spec 001 § 8 is therefore **per API instance**, a known limitation that must
 * be revisited before horizontal scaling.
 *
 * `resetAll()` exists for the e2e suites: truncating tables does not clear an
 * in-memory counter, so without it every rate-limit suite is order-dependent
 * (§ 9 "Test-infrastructure obligations").
 */
@Injectable()
export class ResettableThrottlerStorage implements ThrottlerStorage {
  private readonly buckets = new Map<string, Bucket>();

  async increment(
    key: string,
    ttl: number,
    limit: number,
    _blockDuration: number,
    _throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    return this.hit(key, limit, ttl);
  }

  /** `ttlMs` is a window length; the bucket expires rather than sliding. */
  hit(key: string, limit: number, ttlMs: number, now = Date.now()): ThrottlerStorageRecord {
    const existing = this.buckets.get(key);

    if (!existing || existing.expiresAt <= now) {
      const bucket: Bucket = { hits: 1, expiresAt: now + ttlMs };
      this.buckets.set(key, bucket);
      return { totalHits: 1, timeToExpire: ttlMs, isBlocked: false, timeToBlockExpire: 0 };
    }

    existing.hits += 1;
    const timeToExpire = existing.expiresAt - now;
    const isBlocked = existing.hits > limit;

    return {
      totalHits: existing.hits,
      timeToExpire,
      isBlocked,
      timeToBlockExpire: isBlocked ? timeToExpire : 0,
    };
  }

  async resetAll(): Promise<void> {
    this.buckets.clear();
  }
}
