import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PasswordResetToken } from '@prisma/client';
import type { ResetTokenReason } from '@typing-game/contracts';

import { AfterResponse } from '../../common/after-response/after-response.service';
import { CLOCK, type Clock } from '../../common/clock/clock';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import type { Env } from '../../config/env.schema';
import { MAIL_SERVICE, type MailService } from '../mail/mail.port';
import { AuthService, type IssuedSession, type RequestContext } from './auth.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

const MINUTE_MS = 60 * 1_000;

@Injectable()
export class PasswordResetService {
  private readonly ttlMinutes: number;
  private readonly appUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly tokens: TokenService,
    private readonly passwords: PasswordService,
    private readonly sessions: AuthService,
    private readonly afterResponse: AfterResponse,
    @Inject(MAIL_SERVICE) private readonly mail: MailService,
    config: ConfigService<Env, true>,
  ) {
    this.ttlMinutes = config.get('PASSWORD_RESET_TTL_MINUTES', { infer: true });
    this.appUrl = config.get('APP_PUBLIC_URL', { infer: true });
  }

  /**
   * Both branches share the same pre-response shape — one indexed lookup, and on
   * the known branch two writes. The only step measured in hundreds of
   * milliseconds, the SMTP round trip, is on neither branch's critical path
   * (US-6.3, Q13).
   */
  async request(email: string, context: { ip: string | null; requestId?: string }): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) return;

    const now = this.clock.now();
    const raw = this.tokens.generateResetToken();

    await this.prisma.$transaction(async (tx) => {
      // US-6.4 — only the newest link works.
      await tx.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null, invalidatedAt: null },
        data: { invalidatedAt: now },
      });

      await tx.passwordResetToken.create({
        data: {
          userId: user.id,
          tokenHash: this.tokens.hashResetToken(raw),
          createdAt: now,
          expiresAt: new Date(now.getTime() + this.ttlMinutes * MINUTE_MS),
          requestIpHash: this.tokens.hashIp(context.ip),
        },
      });
    });

    // Dispatched after the response. The plaintext token appears only in the
    // mail and is never logged, in any environment (§ 8 *Logging*).
    this.afterResponse.run(
      () =>
        this.mail.sendPasswordReset(
          email,
          `${this.appUrl}/reset-password?token=${raw}`,
          this.ttlMinutes,
        ),
      { requestId: context.requestId },
    );
  }

  /** Never consumes the token: a mail client prefetching the link must not burn it. */
  async validate(raw: string): Promise<{ valid: boolean; reason: ResetTokenReason | null }> {
    const reason = await this.reasonFor(raw);
    return reason === null ? { valid: true, reason: null } : { valid: false, reason };
  }

  async reset(
    raw: string,
    password: string,
    context: RequestContext,
  ): Promise<IssuedSession & { user: { id: string; email: string; username: string; createdAt: Date } }> {
    const record = await this.find(raw);
    const reason = this.classify(record);

    if (reason !== null) {
      // Distinct codes are intentional: the token is the secret, and by the time
      // it is presented, telling its holder why it failed leaks nothing.
      throw new AppException(
        `RESET_TOKEN_${reason}`,
        'That reset link cannot be used.',
        HttpStatus.BAD_REQUEST,
      );
    }

    // There is deliberately no PASSWORD_UNCHANGED here (US-6.10, Q14): it would
    // turn a link in an inbox into an unauthenticated password-testing oracle.
    const passwordHash = await this.passwords.hash(password);
    const now = this.clock.now();
    const token = record as PasswordResetToken;

    return this.prisma.$transaction(async (tx) => {
      await tx.passwordResetToken.update({ where: { id: token.id }, data: { usedAt: now } });

      const user = await tx.user.update({
        where: { id: token.userId },
        data: { passwordHash, passwordChangedAt: now },
      });

      // US-6.5 — every existing session, before the new one is created.
      await this.sessions.revokeAllSessions(tx, user.id, 'PASSWORD_RESET');

      const issued = await this.sessions.createSession(tx, user.id, context);
      return { ...issued, user };
    });
  }

  private find(raw: string): Promise<PasswordResetToken | null> {
    return this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: this.tokens.hashResetToken(raw) },
    });
  }

  private async reasonFor(raw: string): Promise<ResetTokenReason | null> {
    return this.classify(await this.find(raw));
  }

  private classify(token: PasswordResetToken | null): ResetTokenReason | null {
    if (!token) return 'INVALID';
    if (token.usedAt !== null) return 'USED';
    if (token.invalidatedAt !== null) return 'SUPERSEDED';
    if (token.expiresAt.getTime() <= this.clock.now().getTime()) return 'EXPIRED';
    return null;
  }
}
