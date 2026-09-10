import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import jwt from 'jsonwebtoken';
import { createHash, randomBytes } from 'node:crypto';

import { CLOCK, type Clock } from '../../common/clock/clock';
import { AppException } from '../../common/errors/app.exception';
import type { Env } from '../../config/env.schema';

/** § 8 — claims `sub`, `sid`, `iat`, `exp`, `iss`. No email or username in the payload. */
export interface AccessTokenClaims {
  sub: string;
  sid: string;
}

const ISSUER = 'typing-game';
/** § 7 — clock skew on `exp`. */
const CLOCK_TOLERANCE_SECONDS = 30;
const REFRESH_TOKEN_BYTES = 32;

const DURATION = /^(\d+)(ms|s|m|h|d)$/;
const UNIT_SECONDS: Record<string, number> = { ms: 0.001, s: 1, m: 60, h: 3_600, d: 86_400 };

function durationToSeconds(value: string): number {
  const match = DURATION.exec(value);
  if (!match) throw new Error(`Unparseable duration: ${value}`);
  return Math.round(Number(match[1]) * UNIT_SECONDS[match[2]]);
}

@Injectable()
export class TokenService {
  /** Derived from `JWT_ACCESS_TTL`, never a literal — the two must not drift (§ 5). */
  readonly accessTtlSeconds: number;

  private readonly pepper: string;
  private readonly secret: string;

  constructor(
    config: ConfigService<Env, true>,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    this.accessTtlSeconds = durationToSeconds(config.get('JWT_ACCESS_TTL', { infer: true }));
    this.pepper = config.get('IP_HASH_PEPPER', { infer: true });
    this.secret = config.get('JWT_ACCESS_SECRET', { infer: true });
  }

  /**
   * `iat` comes from the injected clock rather than the wall clock, and
   * `expiresIn` is computed from it — which is what lets a suite advance time
   * and observe a genuinely expired token (§ 8 *Time*).
   */
  signAccessToken(claims: AccessTokenClaims): string {
    const issuedAt = Math.floor(this.clock.now().getTime() / 1_000);

    return jwt.sign({ sub: claims.sub, sid: claims.sid, iat: issuedAt }, this.secret, {
      algorithm: 'HS256',
      expiresIn: this.accessTtlSeconds,
      issuer: ISSUER,
    });
  }

  verifyAccessToken(token: string): AccessTokenClaims {
    try {
      const payload = jwt.verify(token, this.secret, {
        algorithms: ['HS256'],
        issuer: ISSUER,
        clockTolerance: CLOCK_TOLERANCE_SECONDS,
        clockTimestamp: Math.floor(this.clock.now().getTime() / 1_000),
      }) as AccessTokenClaims;

      if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
        throw new AppException(
          'ACCESS_TOKEN_INVALID',
          'The access token is malformed.',
          HttpStatus.UNAUTHORIZED,
        );
      }

      return { sub: payload.sub, sid: payload.sid };
    } catch (error) {
      if (error instanceof AppException) throw error;

      // Distinct so the caller refreshes instead of redirecting to login (§ 5).
      const expired = (error as { name?: string }).name === 'TokenExpiredError';
      throw new AppException(
        expired ? 'ACCESS_TOKEN_EXPIRED' : 'ACCESS_TOKEN_INVALID',
        expired ? 'The access token has expired.' : 'The access token is invalid.',
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  /** § 8 — 32 random bytes, base64url. Stored as SHA-256 only. */
  generateRefreshToken(): string {
    return randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
  }

  /** A database dump must not yield usable tokens. */
  hashRefreshToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /** Same construction, named apart so neither hash can be fed to the other lookup. */
  generateResetToken(): string {
    return randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
  }

  hashResetToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /** IPs are hashed with a pepper before storage; never raw (§ 8 *Logging*). */
  hashIp(address: string | null): string | null {
    if (!address) return null;
    return createHash('sha256').update(`${this.pepper}:${address}`).digest('hex');
  }
}
