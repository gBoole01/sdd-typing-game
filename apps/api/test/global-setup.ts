import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

import { applyTestEnv, MAINTENANCE_DATABASE_URL } from './env';

const DUPLICATE_DATABASE = '42P04';

/**
 * Prisma resets any database handed to it as a shadow, so the drift check gets
 * one of its own rather than the suite's.
 */
async function createShadowDatabase(): Promise<void> {
  const maintenance = new PrismaClient({ datasourceUrl: MAINTENANCE_DATABASE_URL });

  try {
    await maintenance.$executeRawUnsafe('CREATE DATABASE typing_game_shadow');
  } catch (error) {
    if ((error as { meta?: { code?: string } }).meta?.code !== DUPLICATE_DATABASE) throw error;
  } finally {
    await maintenance.$disconnect();
  }
}

/**
 * Runs once per suite run, before any test file: migrate the throwaway database.
 * Individual files truncate rather than re-migrate (spec 002 § 9).
 */
export default async function globalSetup(): Promise<void> {
  applyTestEnv();
  await createShadowDatabase();

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: join(__dirname, '..'),
    env: process.env,
    stdio: 'inherit',
  });
}
