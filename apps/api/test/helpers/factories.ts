import request from 'supertest';

import { cookieHeader, parseSetCookies } from './cookies';
import type { TestApp } from './app';

/** The API-origin cookie set of spec 001 § 5. The `tgw_*` set is the web origin's. */
export const API_COOKIE = {
  access: 'tg_access',
  refresh: 'tg_refresh',
  guest: 'tg_guest',
} as const;

export const DEFAULT_PASSWORD = 'correct horse battery';

/** Inside `TRUSTED_PROXY_CIDRS` for the default test env, so the header is believed (§ 8). */
export const CLIENT_IP = '203.0.113.10';

/** Supertest sends none by default; a real client always does. */
export const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';

let sequence = 0;

export function uniqueIdentity(): { email: string; username: string } {
  sequence += 1;
  return { email: `player${sequence}@typing-game.local`, username: `player${sequence}` };
}

export interface Credentials {
  email: string;
  username: string;
  password: string;
}

export interface SessionCookies {
  access: string;
  refresh: string;
}

export interface RegisteredUser extends Credentials {
  id: string;
  accessToken: string;
  cookies: SessionCookies;
}

export function extractSessionCookies(raw: string | string[] | undefined): SessionCookies {
  const cookies = parseSetCookies(raw);
  const access = cookies.get(API_COOKIE.access);
  const refresh = cookies.get(API_COOKIE.refresh);

  if (!access || !refresh) {
    throw new Error(
      `Expected both session cookies, got: ${[...cookies.keys()].join(', ') || '(none)'}`,
    );
  }

  return { access: access.value, refresh: refresh.value };
}

export function authHeader(cookies: SessionCookies): string {
  return cookieHeader({ [API_COOKIE.access]: cookies.access });
}

export function refreshHeader(cookies: SessionCookies): string {
  return cookieHeader({ [API_COOKIE.refresh]: cookies.refresh });
}

export async function registerUser(
  test: TestApp,
  overrides: Partial<Credentials> & { guestId?: string; clientIp?: string } = {},
): Promise<RegisteredUser> {
  const identity = uniqueIdentity();
  const credentials: Credentials = {
    email: overrides.email ?? identity.email,
    username: overrides.username ?? identity.username,
    password: overrides.password ?? DEFAULT_PASSWORD,
  };

  const call = request(test.server)
    .post('/api/v1/auth/register')
    .set('X-Client-Ip', overrides.clientIp ?? CLIENT_IP)
    .set('User-Agent', USER_AGENT);

  if (overrides.guestId) call.set('X-Guest-Id', overrides.guestId);

  const response = await call.send({ ...credentials, acceptedTerms: true }).expect(201);

  return {
    ...credentials,
    id: response.body.user.id,
    accessToken: response.body.accessToken,
    cookies: extractSessionCookies(response.headers['set-cookie']),
  };
}

export async function loginUser(
  test: TestApp,
  credentials: Pick<Credentials, 'email' | 'password'>,
  options: { clientIp?: string; userAgent?: string } = {},
): Promise<{ accessToken: string; cookies: SessionCookies }> {
  const call = request(test.server)
    .post('/api/v1/auth/login')
    .set('X-Client-Ip', options.clientIp ?? CLIENT_IP)
    .set('User-Agent', options.userAgent ?? USER_AGENT);

  // Only the two credential fields: `loginSchema` is strict, and callers pass a
  // whole RegisteredUser.
  const response = await call
    .send({ email: credentials.email, password: credentials.password })
    .expect(200);

  return {
    accessToken: response.body.accessToken,
    cookies: extractSessionCookies(response.headers['set-cookie']),
  };
}

export async function issueGuest(
  test: TestApp,
  options: { existingGuestId?: string; clientIp?: string } = {},
): Promise<{ guestId: string; expiresAt: string; status: number }> {
  const call = request(test.server)
    .post('/api/v1/auth/guest')
    .set('X-Client-Ip', options.clientIp ?? CLIENT_IP);

  if (options.existingGuestId) call.set('X-Guest-Id', options.existingGuestId);

  const response = await call.send();

  return {
    guestId: response.body.guestId,
    expiresAt: response.body.expiresAt,
    status: response.status,
  };
}
