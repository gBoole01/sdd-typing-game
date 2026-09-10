import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { LoggerModule } from 'nestjs-pino';

import { JwtAuthGuard } from './common/auth/jwt-auth.guard';
import { ClientIpMiddleware } from './common/client-ip/client-ip.middleware';
import { ClockModule } from './common/clock/clock.module';
import { CommonModule } from './common/common.module';
import { RateLimitGuard } from './common/rate-limit/rate-limit.guard';
import type { Env } from './config/env.schema';
import { validateEnv } from './config/env.schema';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';
import { MailModule } from './modules/mail/mail.module';
import { UsersModule } from './modules/users/users.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, cache: true }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', { infer: true }),
          // The envelope's `requestId` and the request's log lines must carry the
          // same value, so one id is minted per request and reused by both.
          genReqId: (req: { headers: Record<string, string | string[] | undefined> }) => {
            const forwarded = req.headers['x-request-id'];
            return typeof forwarded === 'string' && forwarded.length > 0
              ? forwarded
              : randomUUID();
          },
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.body.password',
              'req.body.token',
              'res.headers["set-cookie"]',
            ],
            remove: true,
          },
        },
      }),
    }),
    ClockModule,
    CommonModule,
    PrismaModule,
    MailModule,
    HealthModule,
    AuthModule,
    UsersModule,
  ],
  providers: [
    // Order matters: a rate-limited endpoint answers 429 before it answers 401,
    // so an unauthenticated flood is rejected at the cheaper gate.
    { provide: APP_GUARD, useClass: RateLimitGuard },
    // Global with a `@Public()` opt-out, so endpoints are protected by default
    // and a forgotten decorator fails closed.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ClientIpMiddleware).forRoutes('*');
  }
}
