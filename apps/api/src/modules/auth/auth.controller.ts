import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req, Res } from '@nestjs/common';
import type {
  ForgotPasswordResponse,
  GuestSessionResponse,
  RefreshResponse,
  RegisterResponse,
  ResetTokenValidation,
  SessionResponse,
  AuthSessionResponse,
} from '@typing-game/contracts';
import type { Request, Response } from 'express';

import { AuthContext } from '../../common/auth/auth-context';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { COOKIE, CookieService } from '../../common/cookies/cookie.service';
import { CurrentAuth } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AppException } from '../../common/errors/app.exception';
import {
  HOUR,
  QUARTER_HOUR,
  RateLimit,
  perEmail,
  perIp,
} from '../../common/rate-limit/rate-limit';
import { PrismaService } from '../../prisma/prisma.service';
import { toAuthUser, toSettings } from '../users/users.serializer';
import { AuthService, type IssuedSession, type RequestContext } from './auth.service';
import { ForgotPasswordDto, LoginDto, RegisterDto, ResetPasswordDto, ValidateResetTokenDto } from './auth.dto';
import { CredentialsService } from './credentials.service';
import { PasswordResetService } from './password-reset.service';

/** Controllers route; services decide (CLAUDE.md § API). */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly credentials: CredentialsService,
    private readonly sessions: AuthService,
    private readonly resets: PasswordResetService,
    private readonly cookies: CookieService,
    private readonly guard: JwtAuthGuard,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Post('register')
  @RateLimit(perIp(5, HOUR))
  async register(
    @Body() body: RegisterDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RegisterResponse> {
    const issued = await this.credentials.register(body, {
      ...AuthController.contextOf(request),
      guestId: AuthController.guestIdOf(request),
    });

    this.writeSession(response, issued);
    // The guest cookie is spent; the account cookies replace it.
    this.cookies.clearGuest(response);

    return {
      user: toAuthUser(issued.user as never),
      accessToken: issued.accessToken,
      expiresIn: issued.expiresIn,
      claimedResults: issued.claimedResults,
    };
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @RateLimit(perIp(10, QUARTER_HOUR), perEmail(5, QUARTER_HOUR))
  async login(
    @Body() body: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionResponse> {
    const issued = await this.credentials.login(body, AuthController.contextOf(request));
    this.writeSession(response, issued);

    return {
      user: toAuthUser(issued.user as never),
      accessToken: issued.accessToken,
      expiresIn: issued.expiresIn,
    };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<RefreshResponse> {
    // There is no body variant: a body-carried refresh token exists only for the
    // Bearer transport, which is out of scope (§ 2, Q11).
    const presented = request.cookies?.[COOKIE.refresh];

    if (typeof presented !== 'string' || presented.length === 0) {
      throw new AppException(
        'REFRESH_TOKEN_MISSING',
        'No refresh token was presented.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const issued = await this.sessions.refresh(presented, AuthController.contextOf(request));
    this.writeSession(response, issued);

    return { accessToken: issued.accessToken, expiresIn: issued.expiresIn };
  }

  /**
   * `@Public()` rather than `access`: US-5.1 requires 204 even with no session,
   * so a client holding a stale token can always reach a clean state. § 5's Auth
   * column reads `access`; the behavioural statement is what binds.
   */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    if (await this.guard.resolveOptional(request)) {
      const auth = request.auth as AuthContext;
      await this.prisma.$transaction((tx) =>
        this.sessions.revokeSession(tx, auth.session.id, 'LOGOUT'),
      );
    }

    this.cookies.clearSession(response);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logoutAll(
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    // The caller's own session included (US-5.2).
    await this.prisma.$transaction((tx) =>
      this.sessions.revokeAllSessions(tx, auth.user.id, 'LOGOUT_ALL'),
    );

    this.cookies.clearSession(response);
  }

  /** Budget p95 ≤ 25 ms: it runs on every protected render, so it may never grow an aggregate. */
  @Get('session')
  session(@CurrentAuth() auth: AuthContext): SessionResponse {
    return {
      user: { id: auth.user.id, username: auth.user.username },
      settings: toSettings(auth.settings),
    };
  }

  @Public()
  @Post('guest')
  @RateLimit(perIp(20, HOUR))
  async guest(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<GuestSessionResponse> {
    const guest = await this.credentials.issueGuest(AuthController.guestIdOf(request));

    this.cookies.setGuest(response, guest);
    response.status(guest.created ? HttpStatus.CREATED : HttpStatus.OK);

    return { guestId: guest.guestId, expiresAt: guest.expiresAt.toISOString() };
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  @RateLimit(perEmail(3, HOUR), perIp(10, HOUR))
  async forgotPassword(
    @Body() body: ForgotPasswordDto,
    @Req() request: Request,
  ): Promise<ForgotPasswordResponse> {
    await this.resets.request(body.email, {
      ip: request.clientIp ?? null,
      requestId: (request as Request & { id?: string }).id,
    });

    // Identical for any syntactically valid address, whether or not it exists.
    // "on its way", not "sent": the API has not observed a successful send.
    return { message: 'If an account exists for that address, a reset link is on its way.' };
  }

  @Public()
  @Get('reset-password/validate')
  @RateLimit(perIp(20, HOUR))
  validateResetToken(@Query() query: ValidateResetTokenDto): Promise<ResetTokenValidation> {
    // Always 200, never 404 — the shape is the answer.
    return this.resets.validate(query.token);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @RateLimit(perIp(10, HOUR))
  async resetPassword(
    @Body() body: ResetPasswordDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthSessionResponse> {
    const issued = await this.resets.reset(
      body.token,
      body.password,
      AuthController.contextOf(request),
    );

    this.writeSession(response, issued);

    return {
      user: toAuthUser(issued.user as never),
      accessToken: issued.accessToken,
      expiresIn: issued.expiresIn,
    };
  }

  private writeSession(response: Response, issued: IssuedSession): void {
    this.cookies.setSession(response, {
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      expiresAt: issued.session.expiresAt,
      accessTtlSeconds: issued.expiresIn,
    });
  }

  private static contextOf(request: Request): RequestContext {
    return {
      ip: request.clientIp ?? null,
      // § 7 — a missing User-Agent yields null, and the devices page says
      // "Unknown device".
      userAgent: request.headers['user-agent'] ?? null,
    };
  }

  /** § 5 — the header wins when both are present. */
  private static guestIdOf(request: Request): string | null {
    const header = request.headers['x-guest-id'];
    if (typeof header === 'string' && header.length > 0) return header;

    const cookie = request.cookies?.[COOKIE.guest];
    return typeof cookie === 'string' && cookie.length > 0 ? cookie : null;
  }
}
