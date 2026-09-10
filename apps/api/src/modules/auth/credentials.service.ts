import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { checkUsername, type RegisterInput } from '@typing-game/contracts';

import { CLOCK, type Clock } from '../../common/clock/clock';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import type { Env } from '../../config/env.schema';
import { AuthService, type IssuedSession, type RequestContext } from './auth.service';
import { PasswordService } from './password.service';

const DAY_MS = 24 * 60 * 60 * 1_000;

export interface RegistrationResult extends IssuedSession {
  user: { id: string; email: string; username: string; createdAt: Date };
  claimedResults: number;
}

@Injectable()
export class CredentialsService {
  private readonly guestTtlDays: number;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly passwords: PasswordService,
    private readonly sessions: AuthService,
    config: ConfigService<Env, true>,
  ) {
    this.guestTtlDays = config.get('GUEST_SESSION_TTL_DAYS', { infer: true });
  }

  /**
   * A reserved username is a 409, not a 400: the name is well-formed, it is
   * simply taken. Matched on the skeleton, so a homoglyph spelling is caught
   * (§ 4, § 7).
   */
  static assertUsernameAvailableShape(username: string): string {
    const result = checkUsername(username);

    if (!result.ok) {
      if (result.reason === 'RESERVED') throw CredentialsService.usernameTaken('RESERVED');
      // The schema rejects the other two before a service ever sees them.
      throw new AppException('VALIDATION_FAILED', 'Username is not valid.', HttpStatus.BAD_REQUEST, [
        { path: 'username', message: result.reason },
      ]);
    }

    return result.normalized;
  }

  static usernameTaken(reason: 'RESERVED' | 'TAKEN'): AppException {
    return new AppException('USERNAME_TAKEN', 'That username is taken.', HttpStatus.CONFLICT, [
      { path: 'username', message: reason },
    ]);
  }

  async register(
    input: RegisterInput,
    context: RequestContext & { guestId: string | null },
  ): Promise<RegistrationResult> {
    const usernameNormalized = CredentialsService.assertUsernameAvailableShape(input.username);
    const passwordHash = await this.passwords.hash(input.password);
    const now = this.clock.now();

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email,
          username: input.username,
          usernameNormalized,
          passwordHash,
          // US-2.7 — the acceptance instant is persisted, not merely validated.
          acceptedTermsAt: now,
          settings: { create: {} },
        },
      });

      const claimedResults = await this.claimGuestResults(tx, context.guestId, user.id, now);
      const issued = await this.sessions.createSession(tx, user.id, context);

      return { ...issued, user, claimedResults };
    });
  }

  /**
   * US-2.5 — the funnel from "tried it once" to "registered" loses no data.
   * Idempotent: a guest session that was already claimed yields 0 and is not an
   * error (§ 7), checked on the `claimedBy` index.
   */
  private async claimGuestResults(
    tx: Prisma.TransactionClient,
    guestId: string | null,
    userId: string,
    now: Date,
  ): Promise<number> {
    if (!guestId) return 0;

    const guest = await tx.guestSession.findFirst({
      where: { id: guestId, claimedBy: null, expiresAt: { gt: now } },
      select: { id: true },
    });
    if (!guest) return 0;

    // Both columns move in one statement, so the owner-exclusivity constraint
    // never sees a row naming two owners.
    const { count } = await tx.testResult.updateMany({
      where: { guestSessionId: guest.id },
      data: { userId, guestSessionId: null },
    });

    await tx.guestSession.update({
      where: { id: guest.id },
      data: { claimedBy: userId, claimedAt: now },
    });

    return count;
  }

  async login(
    credentials: { email: string; password: string },
    context: RequestContext,
  ): Promise<IssuedSession & { user: { id: string; email: string; username: string; createdAt: Date } }> {
    const user = await this.prisma.user.findUnique({ where: { email: credentials.email } });

    if (!user) {
      await this.passwords.verifyDummy(credentials.password);
      throw CredentialsService.invalidCredentials();
    }

    if (!(await this.passwords.verify(user.passwordHash, credentials.password))) {
      throw CredentialsService.invalidCredentials();
    }

    const now = this.clock.now();

    return this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: now } });
      const issued = await this.sessions.createSession(tx, user.id, context);
      return { ...issued, user };
    });
  }

  /**
   * § 5 — an already-valid guest session is returned rather than replaced, so a
   * client retrying on network failure does not accumulate orphan rows.
   */
  async issueGuest(
    presentedId: string | null,
  ): Promise<{ guestId: string; expiresAt: Date; created: boolean }> {
    const now = this.clock.now();

    if (presentedId) {
      const existing = await this.prisma.guestSession.findFirst({
        where: { id: presentedId, claimedBy: null, expiresAt: { gt: now } },
      });

      if (existing) {
        return { guestId: existing.id, expiresAt: existing.expiresAt, created: false };
      }
    }

    const created = await this.prisma.guestSession.create({
      data: { createdAt: now, expiresAt: new Date(now.getTime() + this.guestTtlDays * DAY_MS) },
    });

    return { guestId: created.id, expiresAt: created.expiresAt, created: true };
  }

  /** § 8 *Enumeration* — no endpoint distinguishes "exists" from "wrong credentials". */
  static invalidCredentials(): AppException {
    return new AppException(
      'INVALID_CREDENTIALS',
      'Email or password is incorrect.',
      HttpStatus.UNAUTHORIZED,
    );
  }
}
