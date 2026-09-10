import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

const QUERY_LOG_LEVEL = 'debug';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log:
        process.env.LOG_LEVEL === QUERY_LOG_LEVEL
          ? [
              { emit: 'event', level: 'query' },
              { emit: 'event', level: 'warn' },
              { emit: 'event', level: 'error' },
            ]
          : [
              { emit: 'event', level: 'warn' },
              { emit: 'event', level: 'error' },
            ],
    });
  }

  async onModuleInit(): Promise<void> {
    this.bridgeLogsToNest();
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Empties every application table in one statement. `CASCADE` makes foreign-key
   * ordering irrelevant (§ 7), and `_prisma_migrations` is preserved so the suite
   * migrates once per run rather than once per file (§ 9).
   *
   * The guard reads `NODE_ENV` at call time, not at construction: it is the only
   * thing standing between a typo and a wiped development database.
   */
  async truncateAll(): Promise<void> {
    if (process.env.NODE_ENV !== 'test') {
      throw new Error(
        `truncateAll() is refused unless NODE_ENV is "test" (it is "${process.env.NODE_ENV}").`,
      );
    }

    const tables = await this.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    `;

    if (tables.length === 0) return;

    const quoted = tables.map((table) => `"public"."${table.tablename}"`).join(', ');
    await this.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
  }

  private bridgeLogsToNest(): void {
    const client = this as unknown as {
      $on(event: string, callback: (payload: unknown) => void): void;
    };

    client.$on('warn', (payload) => this.logger.warn((payload as Prisma.LogEvent).message));
    client.$on('error', (payload) => this.logger.error((payload as Prisma.LogEvent).message));

    if (process.env.LOG_LEVEL === QUERY_LOG_LEVEL) {
      client.$on('query', (payload) => {
        const event = payload as Prisma.QueryEvent;
        this.logger.debug(`${event.query} — ${event.duration}ms`);
      });
    }
  }
}
