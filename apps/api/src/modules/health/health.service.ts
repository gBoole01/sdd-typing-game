import { HttpStatus, Injectable } from '@nestjs/common';
import { type HealthResponse, InfraErrorCode } from '@typing-game/contracts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../prisma/prisma.service';

const DATABASE_PROBE_TIMEOUT_MS = 2000;

@Injectable()
export class HealthService {
  private readonly version = HealthService.readVersion();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Liveness probe. Deliberately touches no application table: a probe that
   * depends on the schema being migrated reports "down" during every deploy
   * (spec 002 § 5).
   */
  async check(): Promise<HealthResponse> {
    if (!(await this.databaseAnswers())) {
      throw new AppException(
        InfraErrorCode.ServiceUnavailable,
        'The database is not reachable.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return {
      status: 'ok',
      database: 'up',
      uptime: process.uptime(),
      version: this.version,
    };
  }

  private async databaseAnswers(): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;

    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('Database probe timed out.')),
        DATABASE_PROBE_TIMEOUT_MS,
      );
    });

    try {
      await Promise.race([this.prisma.$queryRaw`SELECT 1`, timeout]);
      return true;
    } catch {
      return false;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private static readVersion(): string {
    const manifest = readFileSync(join(__dirname, '..', '..', '..', 'package.json'), 'utf8');
    return (JSON.parse(manifest) as { version?: string }).version ?? '0.0.0';
  }
}
