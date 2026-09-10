import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { bootstrapApp } from './bootstrap';
import { warnOnSuspiciousConfig } from './config/config.warnings';
import type { Env } from './config/env.schema';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  bootstrapApp(app);

  const logger = new Logger('Bootstrap');
  const config = app.get(ConfigService<Env, true>);

  warnOnSuspiciousConfig(
    {
      NODE_ENV: config.get('NODE_ENV', { infer: true }),
      DATABASE_URL: config.get('DATABASE_URL', { infer: true }),
    } as Env,
    logger,
  );

  app.enableCors({ origin: config.get('CORS_ORIGIN', { infer: true }), credentials: true });

  const port = config.get('PORT', { infer: true });
  await app.listen(port, '0.0.0.0');
  logger.log(`API listening on ${await app.getUrl()}/api/v1`);
}

void bootstrap();
