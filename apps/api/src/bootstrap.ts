import { INestApplication, VersioningType } from '@nestjs/common';
import { ZodValidationPipe } from 'nestjs-zod';

import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

/**
 * Everything that shapes the HTTP surface, in one place, so the e2e suite
 * exercises the same stack `main.ts` serves. A global setting applied only in
 * `main.ts` is a setting no test covers.
 */
export function bootstrapApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  // zod replaces class-validator project-wide (ARCHITECTURE.md § 9, decision 2),
  // so `whitelist` / `forbidNonWhitelisted` are expressed by the schemas in
  // packages/contracts being strict: an unknown field is a 400, not a silent drop.
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());

  return app;
}
