import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';

import type { Env } from '../../config/env.schema';

/**
 * Argon2id, never bcrypt (spec 001 § 8). Parameters come from validated env vars
 * so a slow host can be tuned without a code change; the OWASP 2024 baseline is
 * the default.
 */
@Injectable()
export class PasswordService {
  private readonly options: argon2.HashOptions & { raw?: false };
  /** Verified against on the unknown-email branch of login, so both branches cost the same. */
  private dummyHash: Promise<string> | null = null;

  constructor(config: ConfigService<Env, true>) {
    this.options = {
      type: argon2.argon2id,
      memoryCost: config.get('ARGON2_MEMORY_KIB', { infer: true }),
      timeCost: config.get('ARGON2_TIME_COST', { infer: true }),
      parallelism: config.get('ARGON2_PARALLELISM', { infer: true }),
    };
  }

  hash(password: string): Promise<string> {
    return argon2.hash(password, this.options);
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  /**
   * § 5 — an unknown email still runs a verify, so timing does not distinguish
   * it from a wrong password. This is the one endpoint where the dummy verify is
   * the right tool: both branches are otherwise a single indexed lookup, and the
   * hash dominates the response time.
   */
  async verifyDummy(password: string): Promise<false> {
    const dummy = (this.dummyHash ??= argon2.hash('a password nobody has', this.options));
    await this.verify(await dummy, password);
    return false;
  }
}
