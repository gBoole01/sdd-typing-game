import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { CookieService } from '../../common/cookies/cookie.service';
import type { Env } from '../../config/env.schema';
import { AUTH_OPTIONS, AuthService, type AuthOptions } from './auth.service';
import { AuthController } from './auth.controller';
import { CredentialsService } from './credentials.service';
import { PasswordResetService } from './password-reset.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

@Module({
  controllers: [AuthController],
  providers: [
    TokenService,
    PasswordService,
    AuthService,
    CredentialsService,
    PasswordResetService,
    CookieService,
    JwtAuthGuard,
    {
      provide: AUTH_OPTIONS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): AuthOptions => ({
        refreshGraceSeconds: config.get('REFRESH_GRACE_SECONDS', { infer: true }),
        refreshTokenTtlDays: config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true }),
        sessionMaxActive: config.get('SESSION_MAX_ACTIVE', { infer: true }),
      }),
    },
  ],
  exports: [AuthService, TokenService, PasswordService, CookieService, JwtAuthGuard],
})
export class AuthModule {}
