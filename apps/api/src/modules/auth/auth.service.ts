import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import type { Prisma, RevocationReason, Session } from '@prisma/client';

import { CLOCK, type Clock } from '../../common/clock/clock';
import { AppException } from '../../common/errors/app.exception';
import { HOUR } from '../../common/rate-limit/rate-limit';
import { RateLimiterService } from '../../common/rate-limit/rate-limiter.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TokenService } from './token.service';

export const AUTH_OPTIONS = Symbol('AUTH_OPTIONS');

/**
 * Everything rotation does not read is optional, so the § 9 rotation matrix can
 * construct this service without inventing values it never touches. The DI
 * provider always supplies all of them.
 */
export interface AuthOptions {
  refreshGraceSeconds: number;
  refreshTokenTtlDays?: number;
  sessionMaxActive?: number;
}

export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
}

export interface IssuedSession {
  session: Session;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

const DEFAULT_REFRESH_TTL_DAYS = 30;
const DEFAULT_SESSION_MAX_ACTIVE = 20;
const DAY_MS = 24 * 60 * 60 * 1_000;
/** § 8 — refresh is 60/h per session. */
const REFRESH_LIMIT_PER_HOUR = 60;

/**
 * Session lifecycle: a `Session` is a **device**, and a `RefreshToken` is one
 * rotation inside it (spec 001 § 4, Q6). Keeping them apart is what makes `sid`
 * stable, revocation immediate and total, and the device list one row per device.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly tokens: TokenService,
    @Inject(AUTH_OPTIONS) private readonly options: AuthOptions,
    @Optional() private readonly limiter?: RateLimiterService,
  ) {}

  private get refreshTtlDays(): number {
    return this.options.refreshTokenTtlDays ?? DEFAULT_REFRESH_TTL_DAYS;
  }

  private get sessionMaxActive(): number {
    return this.options.sessionMaxActive ?? DEFAULT_SESSION_MAX_ACTIVE;
  }

  /**
   * Opens a device session. `expiresAt` is fixed here and copied unchanged into
   * every successor token, so 30 days means 30 days rather than a sliding window
   * with no ceiling (US-4.6, Q16).
   */
  async createSession(
    tx: Prisma.TransactionClient,
    userId: string,
    context: RequestContext,
  ): Promise<IssuedSession> {
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + this.refreshTtlDays * DAY_MS);

    await this.evictLeastRecentlyUsed(tx, userId, now);

    const session = await tx.session.create({
      data: {
        userId,
        createdAt: now,
        expiresAt,
        lastUsedAt: now,
        userAgent: context.userAgent,
        ipHash: this.tokens.hashIp(context.ip),
      },
    });

    const refreshToken = await this.issueRefreshToken(tx, session, expiresAt);

    return {
      session,
      refreshToken,
      accessToken: this.tokens.signAccessToken({ sub: userId, sid: session.id }),
      expiresIn: this.tokens.accessTtlSeconds,
    };
  }

  /**
   * The § 5 decision procedure, in order. Step 2 runs before steps 3–5, so a
   * refresh after `logout-all` is reported as an expired session and never as
   * theft.
   */
  async refresh(rawToken: string, context: RequestContext): Promise<IssuedSession> {
    const tokenHash = this.tokens.hashRefreshToken(rawToken);

    // 1. Hash the presented token; look up the RefreshToken and its Session.
    const presented = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { session: true },
    });

    if (!presented || !presented.session) {
      throw new AppException(
        'REFRESH_TOKEN_INVALID',
        'The refresh token is not valid.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const session = presented.session;
    const now = this.clock.now();

    // 2. Revoked or expired, before consumption is even considered — so a
    // refresh after `logout-all` is never reported as theft.
    if (session.revokedAt !== null || session.expiresAt.getTime() <= now.getTime()) {
      throw AuthService.sessionExpired();
    }

    this.limiter?.consume(`auth.refresh:session:${session.id}`, REFRESH_LIMIT_PER_HOUR, HOUR);

    if (presented.consumedAt !== null) {
      const elapsedSeconds = (now.getTime() - presented.consumedAt.getTime()) / 1_000;

      // 4. Consumed beyond the grace window: the detection signal for a stolen
      // token. Written *outside* any transaction the throw would roll back —
      // a reuse detection that undoes itself detects nothing.
      if (elapsedSeconds > this.options.refreshGraceSeconds) {
        await this.prisma.session.update({
          where: { id: session.id },
          data: { revokedAt: now, revokedReason: 'REUSE_DETECTED' },
        });

        throw new AppException(
          'REFRESH_TOKEN_REUSED',
          'The refresh token has already been used.',
          HttpStatus.UNAUTHORIZED,
        );
      }

      // 3. Inside the window: fall through and issue another successor, leaving
      // `consumedAt` at its original value so the window runs from the token's
      // first use and cannot be extended by polling (US-4.3, US-4.5).
    }

    return this.prisma.$transaction(async (tx) => {
      // 5. First use.
      if (presented.consumedAt === null) {
        await tx.refreshToken.update({
          where: { id: presented.id },
          data: { consumedAt: now },
        });
      }

      const updated = await tx.session.update({
        where: { id: session.id },
        data: { lastUsedAt: now },
      });

      const refreshToken = await this.issueRefreshToken(tx, session, session.expiresAt);

      return {
        session: updated ?? session,
        refreshToken,
        accessToken: this.tokens.signAccessToken({ sub: session.userId, sid: session.id }),
        expiresIn: this.tokens.accessTtlSeconds,
      };
    });
  }

  async revokeSession(
    tx: Prisma.TransactionClient,
    sessionId: string,
    reason: RevocationReason,
  ): Promise<void> {
    await tx.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: this.clock.now(), revokedReason: reason },
    });
  }

  /** `exceptSessionId` is what makes "all *other* sessions" unambiguous (US-7.5). */
  async revokeAllSessions(
    tx: Prisma.TransactionClient,
    userId: string,
    reason: RevocationReason,
    exceptSessionId?: string,
  ): Promise<void> {
    await tx.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: this.clock.now(), revokedReason: reason },
    });
  }

  private async issueRefreshToken(
    tx: Prisma.TransactionClient,
    session: Pick<Session, 'id'>,
    expiresAt: Date,
  ): Promise<string> {
    const raw = this.tokens.generateRefreshToken();

    await tx.refreshToken.create({
      data: {
        sessionId: session.id,
        tokenHash: this.tokens.hashRefreshToken(raw),
        // Inherited verbatim; rotation never extends the absolute lifetime.
        expiresAt,
      },
    });

    return raw;
  }

  /**
   * US-3.5 — opening a session beyond the cap evicts the least recently used, so
   * the device list stays bounded and `GET /users/me/sessions` stays one page.
   */
  private async evictLeastRecentlyUsed(
    tx: Prisma.TransactionClient,
    userId: string,
    now: Date,
  ): Promise<void> {
    const active = await tx.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: now } },
      orderBy: { lastUsedAt: 'asc' },
      select: { id: true },
    });

    const surplus = active.length - this.sessionMaxActive + 1;
    if (surplus <= 0) return;

    await tx.session.updateMany({
      where: { id: { in: active.slice(0, surplus).map((session) => session.id) } },
      data: { revokedAt: now, revokedReason: 'SESSION_LIMIT' },
    });
  }

  private static sessionExpired(): AppException {
    return new AppException(
      'SESSION_EXPIRED',
      'The session has expired.',
      HttpStatus.UNAUTHORIZED,
    );
  }
}
