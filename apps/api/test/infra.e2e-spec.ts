import { Controller, Get, INestApplication, Post } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import * as net from 'node:net';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { Public } from '../src/common/decorators/public.decorator';
import { bootstrapApp } from '../src/bootstrap';
import { PrismaService } from '../src/prisma/prisma.service';
import { TEST_DATABASE_URL } from './env';

/**
 * Spec 002 § 9 "Infrastructure". Runs against postgres-test on :5433 (US-4.1),
 * which is tmpfs-backed and discarded with the container (US-4.2).
 */

/**
 * Exercises the persistence-layer error mapping over real HTTP, because the
 * contract is what a client sees — a Prisma code reaching the wire is the
 * failure this asserts against (§ 7).
 */
// Opted out of the global JwtAuthGuard that spec 001 introduced; this probe
// exercises the persistence-layer error mapping, not authentication.
@Public()
@Controller('__probe')
class ProbeController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('duplicate-user')
  async duplicateUser(): Promise<{ id: string }> {
    const email = 'duplicate@typing-game.local';
    const base = {
      email,
      username: 'duplicate',
      usernameNormalized: 'duplicate',
      passwordHash: 'not-a-real-hash',
      acceptedTermsAt: new Date(),
    };

    await this.prisma.user.create({ data: base });
    const second = await this.prisma.user.create({
      data: { ...base, username: 'duplicate2', usernameNormalized: 'duplicate2' },
    });

    return { id: second.id };
  }

  @Get('exhaust-pool')
  async exhaustPool(): Promise<{ completed: number }> {
    const constrained = new PrismaClient({
      datasourceUrl: TEST_DATABASE_URL.replace(
        /connection_limit=\d+&pool_timeout=\d+/,
        'connection_limit=1&pool_timeout=1',
      ),
    });

    try {
      const queries = Array.from({ length: 8 }, () =>
        constrained.$queryRaw`SELECT pg_sleep(3)`,
      );
      await Promise.all(queries);
      return { completed: queries.length };
    } finally {
      await constrained.$disconnect();
    }
  }
}

describe('infrastructure (spec 002)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProbeController],
    }).compile();

    app = moduleRef.createNestApplication();
    bootstrapApp(app);
    await app.init();

    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('bootstraps against the test database (US-4.1)', () => {
    it('compiles the app module and connects PrismaService', async () => {
      expect(app).toBeDefined();
      await expect(prisma.$queryRaw`SELECT 1 AS one`).resolves.toEqual([{ one: 1 }]);
    });

    it('is connected to typing_game_test on 5433, not the development database', async () => {
      const [row] = await prisma.$queryRaw<
        { database: string }[]
      >`SELECT current_database() AS database`;

      expect(row.database).toBe('typing_game_test');
    });
  });

  describe('GET /api/v1/health', () => {
    it('reports 200 with database up', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/health').expect(200);

      expect(response.body).toEqual({
        status: 'ok',
        database: 'up',
        uptime: expect.any(Number),
        version: expect.any(String),
      });
      expect(response.body.uptime).toBeGreaterThan(0);
    });

    it('reports 503 SERVICE_UNAVAILABLE with the connection severed', async () => {
      const severed: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService)
        .useValue({
          $queryRaw: (): Promise<never> =>
            Promise.reject(
              Object.assign(new Error("Can't reach database server"), { code: 'P1001' }),
            ),
          onModuleInit: (): Promise<void> => Promise.resolve(),
          onModuleDestroy: (): Promise<void> => Promise.resolve(),
        })
        .compile();

      const severedApp = severed.createNestApplication();
      bootstrapApp(severedApp);
      await severedApp.init();

      try {
        const response = await request(severedApp.getHttpServer())
          .get('/api/v1/health')
          .expect(503);

        expect(response.body.error).toMatchObject({
          code: 'SERVICE_UNAVAILABLE',
          message: expect.any(String),
          requestId: expect.any(String),
        });
        expect(response.body.database).toBeUndefined();
      } finally {
        await severedApp.close();
      }
    });

    it('does not read application tables, so it answers before migrations run', async () => {
      const spy = jest.spyOn(prisma, '$queryRaw');

      await request(app.getHttpServer()).get('/api/v1/health').expect(200);

      const executed = spy.mock.calls.map((call) => JSON.stringify(call));
      expect(executed.join(' ')).not.toMatch(/"User"|"UserSettings"/);
      spy.mockRestore();
    });
  });

  describe('truncateAll() guard (§ 7)', () => {
    it('throws unless NODE_ENV is test', async () => {
      const original = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';

      try {
        await expect(prisma.truncateAll()).rejects.toThrow();
      } finally {
        process.env.NODE_ENV = original;
      }
    });

    it('throws in production too', async () => {
      const original = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      try {
        await expect(prisma.truncateAll()).rejects.toThrow();
      } finally {
        process.env.NODE_ENV = original;
      }
    });

    it('succeeds when NODE_ENV is test', async () => {
      expect(process.env.NODE_ENV).toBe('test');
      await expect(prisma.truncateAll()).resolves.not.toThrow();
    });

    it('completes in under 100 ms (US-4.3, § 10 Q4)', async () => {
      const started = process.hrtime.bigint();
      await prisma.truncateAll();
      const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;

      expect(elapsedMs).toBeLessThan(100);
    });
  });

  describe('timestamptz round-trip', () => {
    it('reads back identical in UTC regardless of host TZ', async () => {
      const original = process.env.TZ;
      process.env.TZ = 'Pacific/Kiritimati';

      try {
        const written = new Date('2026-09-10T14:32:05.123Z');
        const user = await prisma.user.create({
          data: {
            email: 'tz@typing-game.local',
            username: 'tz',
            usernameNormalized: 'tz',
            passwordHash: 'not-a-real-hash',
            acceptedTermsAt: written,
          },
        });

        const read = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

        expect(read.acceptedTermsAt.toISOString()).toBe('2026-09-10T14:32:05.123Z');
        expect(read.acceptedTermsAt.getTime()).toBe(written.getTime());
      } finally {
        process.env.TZ = original;
      }
    });

    it('stores the column as timestamptz, not timestamp', async () => {
      const rows = await prisma.$queryRaw<{ column_name: string; data_type: string }[]>`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'User' AND column_name IN ('createdAt', 'updatedAt', 'acceptedTermsAt')
      `;

      expect(rows).not.toHaveLength(0);
      for (const row of rows) {
        expect(row.data_type).toBe('timestamp with time zone');
      }
    });
  });

  describe('Prisma error mapping (§ 7)', () => {
    it('maps P2002 to 409 without leaking the Prisma code', async () => {
      const response = await request(app.getHttpServer()).post('/api/v1/__probe/duplicate-user');

      expect(response.status).toBe(409);
      expect(response.body.error).toMatchObject({
        code: expect.stringMatching(/^[A-Z][A-Z0-9_]*$/),
        message: expect.any(String),
        requestId: expect.any(String),
      });

      const serialised = JSON.stringify(response.body);
      expect(serialised).not.toMatch(/P2002/);
      expect(serialised).not.toMatch(/prisma/i);
    });

    it('maps P2024 pool exhaustion to 503 SERVICE_UNAVAILABLE', async () => {
      const response = await request(app.getHttpServer()).get('/api/v1/__probe/exhaust-pool');

      expect(response.status).toBe(503);
      expect(response.body.error.code).toBe('SERVICE_UNAVAILABLE');
      expect(JSON.stringify(response.body)).not.toMatch(/P2024/);
    });
  });

  describe('mail driver in tests', () => {
    it('resolves MAIL_DRIVER to memory, so no SMTP transport is configured', () => {
      expect(process.env.MAIL_DRIVER).toBe('memory');
    });

    it('opens no connection to the SMTP port during the suite', async () => {
      const connections: string[] = [];
      const originalConnect = net.Socket.prototype.connect;

      jest
        .spyOn(net.Socket.prototype, 'connect')
        .mockImplementation(function (this: net.Socket, ...args: unknown[]) {
          connections.push(JSON.stringify(args));
          return originalConnect.apply(this, args as never);
        });

      try {
        await request(app.getHttpServer()).get('/api/v1/health').expect(200);
        expect(connections.join(' ')).not.toMatch(/1025/);
      } finally {
        jest.restoreAllMocks();
      }
    });
  });
});
