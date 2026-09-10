import { CanActivate, ExecutionContext, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { PrismaService } from '../../prisma/prisma.service';
import { TokenService } from '../../modules/auth/token.service';
import { CLOCK, type Clock } from '../clock/clock';
import { COOKIE } from '../cookies/cookie.service';
import { IS_PUBLIC } from '../decorators/public.decorator';
import { AppException } from '../errors/app.exception';

/**
 * Global via `APP_GUARD` with a `@Public()` opt-out, so endpoints are protected
 * by default and a forgotten decorator fails closed.
 *
 * Resolves user **and** session in one indexed query on `sid` (§ 8). Because
 * `sid` names a `Session` — a device — and not a rotation row, one revocation
 * invalidates every access token that device holds, immediately rather than at
 * the next 15-minute expiry (US-5.6, Q6).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    await this.attach(request);
    return true;
  }

  /**
   * Also used by `@Public()` endpoints that behave differently for a signed-in
   * caller — `POST /auth/logout` is 204 either way (US-5.1), but it can only
   * revoke a session it managed to resolve.
   */
  async resolveOptional(request: Request): Promise<boolean> {
    try {
      await this.attach(request);
      return true;
    } catch {
      return false;
    }
  }

  private async attach(request: Request): Promise<void> {
    // § 5 — read from `tg_access` and from nowhere else.
    const token = request.cookies?.[COOKIE.access];

    if (typeof token !== 'string' || token.length === 0) {
      throw JwtAuthGuard.unauthenticated();
    }

    const claims = this.tokens.verifyAccessToken(token);

    const session = await this.prisma.session.findFirst({
      where: {
        id: claims.sid,
        userId: claims.sub,
        revokedAt: null,
        expiresAt: { gt: this.clock.now() },
      },
      include: { user: { include: { settings: true } } },
    });

    // A revoked session, an expired one, or a `sub` that no longer exists all
    // answer the same way: the endpoint must not become an account probe.
    if (!session) throw JwtAuthGuard.unauthenticated();

    const { user, ...rest } = session;
    request.auth = { user, session: rest, settings: user.settings };
  }

  private static unauthenticated(): AppException {
    return new AppException(
      'AUTHENTICATION_REQUIRED',
      'Authentication is required.',
      HttpStatus.UNAUTHORIZED,
    );
  }
}
