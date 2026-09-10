import * as argon2 from 'argon2';
import { PrismaClient } from '@prisma/client';

/**
 * Idempotent development seed (spec 002 US-5). Every guard below runs before a
 * client is constructed, so a refusal never depends on the database being
 * reachable (§ 7).
 */

const DEV_USER = {
  email: 'dev@typing-game.local',
  username: 'devuser',
  password: 'devpassword123',
} as const;

function assertNotProduction(): void {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to seed: NODE_ENV is "production".');
    process.exit(1);
  }
}

/**
 * The API builds password-reset links from `APP_PUBLIC_URL` while the browser
 * navigates to `NEXT_PUBLIC_APP_URL`. A mismatch is a reset link that 404s, and
 * it is invisible until someone tries to reset a password (§ 5).
 */
function assertPublicUrlsAgree(): void {
  const api = process.env.APP_PUBLIC_URL;
  const web = process.env.NEXT_PUBLIC_APP_URL;

  if (process.env.NODE_ENV !== 'development' || !api || !web) return;

  if (api !== web) {
    console.error(
      `Refusing to seed: APP_PUBLIC_URL (${api}) and NEXT_PUBLIC_APP_URL (${web}) must be identical.`,
    );
    process.exit(1);
  }
}

async function main(): Promise<void> {
  assertNotProduction();
  assertPublicUrlsAgree();

  const prisma = new PrismaClient();

  try {
    const passwordHash = await argon2.hash(DEV_USER.password, {
      type: argon2.argon2id,
      memoryCost: Number(process.env.ARGON2_MEMORY_KIB ?? 19456),
      timeCost: Number(process.env.ARGON2_TIME_COST ?? 2),
      parallelism: Number(process.env.ARGON2_PARALLELISM ?? 1),
    });

    // Upsert on the natural key, so a second run updates rather than duplicates.
    const user = await prisma.user.upsert({
      where: { email: DEV_USER.email },
      update: {},
      create: {
        email: DEV_USER.email,
        username: DEV_USER.username,
        usernameNormalized: DEV_USER.username,
        passwordHash,
        acceptedTermsAt: new Date(),
      },
    });

    await prisma.userSettings.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id },
    });

    console.log(`Seeded ${DEV_USER.email} (password: ${DEV_USER.password}).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
