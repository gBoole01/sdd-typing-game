import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { LoggerModule } from 'nestjs-pino';

import type { Env } from './config/env.schema';
import { validateEnv } from './config/env.schema';
import { HealthModule } from './modules/health/health.module';
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
    PrismaModule,
    HealthModule,
  ],
})
export class AppModule {}
