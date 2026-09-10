import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { PrismaService } from '../src/prisma/prisma.service';

const exec = promisify(execFile);
const apiRoot = join(__dirname, '..');

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCli(args: string[], env: NodeJS.ProcessEnv = {}): Promise<RunResult> {
  try {
    const { stdout, stderr } = await exec('npx', args, {
      cwd: apiRoot,
      env: { ...process.env, ...env },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? '', stderr: failure.stderr ?? '' };
  }
}

const seed = (env: NodeJS.ProcessEnv = {}): Promise<RunResult> =>
  runCli(['prisma', 'db', 'seed'], env);

/**
 * Spec 002 § 9 "Migrations & seed", US-5 and US-3.2.
 * Slow by nature — each case shells out to the Prisma CLI.
 */
describe('seed and migrations (spec 002)', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  describe('idempotency (US-5.1)', () => {
    it('produces identical row counts when run twice', async () => {
      const first = await seed();
      expect(first.code).toBe(0);

      const afterFirst = {
        users: await prisma.user.count(),
        settings: await prisma.userSettings.count(),
      };
      expect(afterFirst.users).toBeGreaterThan(0);

      const second = await seed();
      expect(second.code).toBe(0);

      const afterSecond = {
        users: await prisma.user.count(),
        settings: await prisma.userSettings.count(),
      };
      expect(afterSecond).toEqual(afterFirst);
    }, 120_000);
  });

  describe('known development user (US-5.2)', () => {
    it('creates dev@typing-game.local', async () => {
      expect((await seed()).code).toBe(0);

      const user = await prisma.user.findUnique({
        where: { email: 'dev@typing-game.local' },
      });

      expect(user).not.toBeNull();
      expect(user?.passwordHash).not.toBe('devpassword123');
    }, 120_000);
  });

  describe('production guard (US-5.4)', () => {
    it('exits 1 under NODE_ENV=production', async () => {
      const result = await seed({ NODE_ENV: 'production' });

      expect(result.code).toBe(1);
      expect(`${result.stdout}${result.stderr}`).toMatch(/production/i);
    }, 120_000);

    it('refuses before opening a connection, so an unreachable database is irrelevant (§ 7)', async () => {
      const result = await seed({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://nobody:nobody@127.0.0.1:1/nowhere?schema=public',
      });

      expect(result.code).toBe(1);
      expect(`${result.stdout}${result.stderr}`).not.toMatch(/P1001/);
    }, 120_000);
  });

  describe('public URL agreement (§ 5)', () => {
    it('fails when APP_PUBLIC_URL and NEXT_PUBLIC_APP_URL disagree', async () => {
      const result = await seed({
        NODE_ENV: 'development',
        APP_PUBLIC_URL: 'http://localhost:3000',
        NEXT_PUBLIC_APP_URL: 'http://localhost:4000',
      });

      expect(result.code).not.toBe(0);
      expect(`${result.stdout}${result.stderr}`).toMatch(/APP_PUBLIC_URL/);
    }, 120_000);
  });

  describe('migration drift (US-3.2)', () => {
    it('reports no drift between schema.prisma and the migration folder', async () => {
      const result = await runCli([
        'prisma',
        'migrate',
        'diff',
        '--from-migrations',
        './prisma/migrations',
        '--to-schema-datamodel',
        './prisma/schema.prisma',
        '--shadow-database-url',
        process.env.SHADOW_DATABASE_URL ?? '',
        '--exit-code',
      ]);

      expect(result.code).toBe(0);
    }, 120_000);
  });
});
