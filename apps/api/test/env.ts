/**
 * Environment for the e2e suite. Set before any module that reads `process.env`
 * is imported, so it must stay free of project imports.
 *
 * Points at `postgres-test` on 5433 (spec 002 US-4.1), never at development's 5432.
 */
export const TEST_DATABASE_URL =
  'postgresql://typing:typing@localhost:5433/typing_game_test?schema=public&connection_limit=10&pool_timeout=10';

/**
 * Prisma resets whatever it is given as a shadow database, so this must never
 * be the suite's own database.
 */
export const TEST_SHADOW_DATABASE_URL =
  'postgresql://typing:typing@localhost:5433/typing_game_shadow?schema=public';

export const MAINTENANCE_DATABASE_URL =
  'postgresql://typing:typing@localhost:5433/postgres?schema=public';

export function applyTestEnv(): void {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.SHADOW_DATABASE_URL = TEST_SHADOW_DATABASE_URL;
  process.env.PORT = '3001';
  process.env.JWT_ACCESS_SECRET = 'test-secret-at-least-32-characters-long';
  process.env.IP_HASH_PEPPER = 'test-pepper-16-chars-min';
  process.env.CORS_ORIGIN = 'http://localhost:3000';
  process.env.TRUSTED_PROXY_CIDRS = '127.0.0.1/32,::1/128';
  process.env.COOKIE_DOMAIN = 'localhost';
  process.env.APP_PUBLIC_URL = 'http://localhost:3000';
  process.env.MAIL_DRIVER = 'memory';
  process.env.MAIL_FROM = 'Typing Game <no-reply@typing-game.local>';
  process.env.LOG_LEVEL = 'silent';
}
