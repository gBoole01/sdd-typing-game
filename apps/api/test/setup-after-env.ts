import { applyTestEnv } from './env';
import { PrismaService } from '../src/prisma/prisma.service';

applyTestEnv();

/**
 * Truncation runs between test files, never concurrently with a test, so code
 * under test may open its own transactions (spec 002 § 10, Q4).
 */
beforeAll(async () => {
  const prisma = new PrismaService();
  await prisma.onModuleInit();
  await prisma.truncateAll();
  await prisma.onModuleDestroy();
});
