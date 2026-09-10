import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Response } from 'express';

import type { Env } from '../../config/env.schema';

/**
 * The **API-origin** cookie set of spec 001 § 5. The browser never holds these:
 * the BFF translates them onto the web origin as `tgw_*`. They are consumed by
 * the BFF, by the Supertest suite, and by `curl` in development, and they are
 * the seam a future native client would replace (Q9, Q11).
 */
export const COOKIE = {
  access: 'tg_access',
  refresh: 'tg_refresh',
  guest: 'tg_guest',
} as const;

/** `SameSite=Strict` and an API path: nothing but `/auth/*` ever needs to send it. */
const REFRESH_PATH = '/api/v1/auth';

@Injectable()
export class CookieService {
  private readonly secure: boolean;
  private readonly domain: string;

  constructor(private readonly config: ConfigService<Env, true>) {
    // § 5 — omitted only when NODE_ENV !== "production".
    this.secure = config.get('NODE_ENV', { infer: true }) === 'production';
    this.domain = config.get('COOKIE_DOMAIN', { infer: true });
  }

  setSession(
    response: Response,
    session: { accessToken: string; refreshToken: string; expiresAt: Date; accessTtlSeconds: number },
  ): void {
    response.cookie(COOKIE.access, session.accessToken, {
      ...this.base(),
      sameSite: 'lax',
      path: '/',
      domain: this.domain,
      maxAge: session.accessTtlSeconds * 1_000,
    });

    response.cookie(COOKIE.refresh, session.refreshToken, {
      ...this.base(),
      sameSite: 'strict',
      path: REFRESH_PATH,
      expires: session.expiresAt,
    });
  }

  clearSession(response: Response): void {
    // Attributes must match the ones the cookie was set with, or the browser
    // keeps it and the "logged out" state is a lie.
    response.clearCookie(COOKIE.access, {
      ...this.base(),
      sameSite: 'lax',
      path: '/',
      domain: this.domain,
    });
    response.clearCookie(COOKIE.refresh, {
      ...this.base(),
      sameSite: 'strict',
      path: REFRESH_PATH,
    });
  }

  setGuest(response: Response, guest: { guestId: string; expiresAt: Date }): void {
    response.cookie(COOKIE.guest, guest.guestId, {
      ...this.base(),
      sameSite: 'lax',
      path: '/',
      expires: guest.expiresAt,
    });
  }

  clearGuest(response: Response): void {
    response.clearCookie(COOKIE.guest, { ...this.base(), sameSite: 'lax', path: '/' });
  }

  private base(): CookieOptions {
    return { httpOnly: true, secure: this.secure };
  }
}
