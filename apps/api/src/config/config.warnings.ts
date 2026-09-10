import { LoggerService } from '@nestjs/common';

import type { Env } from './env.schema';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Legal but usually wrong, so a warning rather than a boot failure: inside
 * Docker networking a production database really can be reachable on localhost
 * (US-2.4).
 */
export function warnOnSuspiciousConfig(env: Env, logger: LoggerService): void {
  if (env.NODE_ENV !== 'production') return;

  const host = new URL(env.DATABASE_URL).hostname;
  if (LOCAL_HOSTS.has(host)) {
    logger.warn?.(
      `DATABASE_URL points at "${host}" in production. This is legal in Docker networking but is usually a misconfiguration.`,
    );
  }
}
