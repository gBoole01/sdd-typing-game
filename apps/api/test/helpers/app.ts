import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';

import { AppModule } from '../../src/app.module';
import { bootstrapApp } from '../../src/bootstrap';
import { AfterResponse, AFTER_RESPONSE } from '../../src/common/after-response/after-response.service';
import { TRUSTED_PROXY_CIDRS } from '../../src/common/client-ip/client-ip.tokens';
import { CLOCK } from '../../src/common/clock/clock';
import { ResettableThrottlerStorage } from '../../src/common/throttler/resettable-throttler.storage';
import { MemoryMailService } from '../../src/modules/mail/drivers/memory-mail.service';
import { MAIL_SERVICE } from '../../src/modules/mail/mail.port';
import { PrismaService } from '../../src/prisma/prisma.service';
import { applyTestEnv } from '../env';
import { FakeClock } from './clock';

export interface CreateTestAppOptions {
  /** Starting instant for the injected `Clock`. */
  now?: Date;
  /**
   * Environment applied before the module is compiled, for the suites that need
   * a different contract than the default — `TRUSTED_PROXY_CIDRS` excluding the
   * test peer is the case § 9 names explicitly.
   */
  env?: Record<string, string>;
}

export interface TestApp {
  app: INestApplication;
  server: Server;
  prisma: PrismaService;
  clock: FakeClock;
  mail: MemoryMailService;
  throttler: ResettableThrottlerStorage;
  /**
   * Truncation plus `throttler.resetAll()` (spec 001 § 9). Truncating tables
   * does not clear an in-memory rate-limit counter, so without the second half
   * every rate-limit suite is order-dependent.
   */
  reset(): Promise<void>;
  /**
   * Awaits the work US-6.3 dispatches *after* the response — otherwise "the
   * mail is sent after the response" also means "after the assertion".
   */
  flushMail(): Promise<void>;
  close(): Promise<void>;
}

export async function createTestApp(options: CreateTestAppOptions = {}): Promise<TestApp> {
  applyTestEnv();

  const overridden = options.env ?? {};
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overridden)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }

  const clock = new FakeClock(options.now);

  const builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(CLOCK)
    .useValue(clock);

  // `ConfigModule.forRoot()` validates once per module registry, so a second app
  // in the same process would otherwise inherit the first one's environment.
  if (overridden.TRUSTED_PROXY_CIDRS !== undefined) {
    builder
      .overrideProvider(TRUSTED_PROXY_CIDRS)
      .useValue(overridden.TRUSTED_PROXY_CIDRS.split(',').map((cidr) => cidr.trim()));
  }

  const moduleRef = await builder.compile();

  const app = bootstrapApp(moduleRef.createNestApplication());
  await app.init();

  const prisma = app.get(PrismaService);
  const mail = app.get<MemoryMailService>(MAIL_SERVICE);
  const afterResponse = app.get<AfterResponse>(AFTER_RESPONSE);
  const throttler = app.get(ResettableThrottlerStorage);

  return {
    app,
    server: app.getHttpServer() as Server,
    prisma,
    clock,
    mail,
    throttler,

    async reset(): Promise<void> {
      await prisma.truncateAll();
      await throttler.resetAll();
      mail.reset();
    },

    async flushMail(): Promise<void> {
      await afterResponse.flush();
    },

    async close(): Promise<void> {
      await afterResponse.flush();
      await app.close();

      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
}
