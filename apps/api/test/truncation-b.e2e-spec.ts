import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Spec 002 § 9 "truncation isolation" (US-4.3), half b of a pair.
 *
 * Both halves write rows and both assert the table is empty on entry. Whichever
 * file Jest runs second therefore proves the harness truncated between files —
 * without either half depending on the execution order.
 */
describe('truncation isolation — beta', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('starts with no rows left by any other test file', async () => {
    await expect(prisma.user.count()).resolves.toBe(0);
  });

  it('writes rows that must not survive into the next file', async () => {
    await prisma.user.createMany({
      data: [1, 2, 3].map((n) => ({
        email: 'beta-' + n + '@typing-game.local',
        username: 'beta' + n,
        usernameNormalized: 'beta' + n,
        passwordHash: 'not-a-real-hash',
        acceptedTermsAt: new Date(),
      })),
    });

    await expect(prisma.user.count()).resolves.toBe(3);
  });
});
