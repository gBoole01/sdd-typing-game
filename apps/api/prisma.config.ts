import { config as loadEnv } from 'dotenv';
import { join } from 'node:path';
import { defineConfig } from 'prisma/config';

/**
 * The env contract lives in one root `.env` (spec 002 § 5), but the Prisma CLI
 * runs with `apps/api` as its working directory — so the root file is loaded
 * explicitly rather than relying on CLI cwd discovery.
 */
loadEnv({ path: join(__dirname, '..', '..', '.env'), quiet: true });

export default defineConfig({
  schema: join('prisma', 'schema.prisma'),
  migrations: {
    seed: 'ts-node prisma/seed.ts',
  },
});
