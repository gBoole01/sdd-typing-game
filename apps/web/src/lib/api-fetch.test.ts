import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api, server } from '../test/msw';
import { fakeCookies, fakeHeaders } from '../test/next';

/**
 * Spec 001 § 9 "Frontend — lib/api-fetch.test.ts", and § 6 *Session helpers*.
 *
 * `apiFetch` is the only thing that talks to NestJS. It retries once through
 * `POST /auth/refresh` on `ACCESS_TOKEN_EXPIRED` and writes the rotated cookies
 * — but **only** where a cookie may legally be written (Q7), which the caller
 * declares.
 */

const cookieStore = vi.hoisted(() => ({ current: null as ReturnType<typeof fakeCookies> | null }));
const headerStore = vi.hoisted(() => ({ current: new Headers() }));

vi.mock('next/headers', () => ({
  cookies: async () => cookieStore.current,
  headers: async () => headerStore.current,
}));

const expired = () =>
  HttpResponse.json(
    { error: { code: 'ACCESS_TOKEN_EXPIRED', message: 'expired', requestId: 'r1' } },
    { status: 401 },
  );

/**
 * The API-origin pair, exactly as § 5 describes it. `Domain` is omitted from the
 * fixture because MSW's cookie jar is tough-cookie, which rejects `localhost` as
 * a public suffix — a limitation of the test double, not of the contract. The
 * assertions below are about the *translated* web-origin cookies either way.
 */
const rotatedCookies = [
  'tg_access=rotated.access; Path=/; HttpOnly; SameSite=Lax',
  'tg_refresh=rotated.refresh; Path=/api/v1/auth; HttpOnly; SameSite=Strict',
];

beforeEach(() => {
  cookieStore.current = fakeCookies({
    tgw_access: 'stale.access',
    tgw_refresh: 'current.refresh',
  });
  headerStore.current = fakeHeaders({
    'x-forwarded-for': '203.0.113.10, 198.51.100.4',
    'x-request-id': 'req-from-edge',
  });
});

describe('apiFetch', () => {
  it('adds the base URL, the translated cookie, the client address and the request id', async () => {
    const seen: Record<string, string | null> = {};
    server.use(
      http.get(api('/users/me'), ({ request }) => {
        seen.cookie = request.headers.get('cookie');
        seen.clientIp = request.headers.get('x-client-ip');
        seen.requestId = request.headers.get('x-request-id');
        return HttpResponse.json({ id: 'u1' });
      }),
    );

    const { apiFetch } = await import('./api-fetch');
    await expect(apiFetch('/users/me')).resolves.toEqual({ ok: true, data: { id: 'u1' } });

    expect(seen.cookie).toContain('tg_access=stale.access');
    // § 8 — the single client address the platform reports, never the whole
    // X-Forwarded-For list: the API ignores that header entirely.
    expect(seen.clientIp).toBe('203.0.113.10');
    expect(seen.requestId).toBe('req-from-edge');
  });

  it('parses the error envelope into the discriminated union', async () => {
    server.use(
      http.post(api('/auth/login'), () =>
        HttpResponse.json(
          {
            error: {
              code: 'INVALID_CREDENTIALS',
              message: 'Email or password is incorrect.',
              requestId: 'r1',
            },
          },
          { status: 401 },
        ),
      ),
    );

    const { apiFetch } = await import('./api-fetch');
    await expect(apiFetch('/auth/login', { method: 'POST' })).resolves.toEqual({
      ok: false,
      code: 'INVALID_CREDENTIALS',
      message: 'Email or password is incorrect.',
    });
  });

  it('carries details through, so a field-level error can be placed', async () => {
    server.use(
      http.post(api('/auth/register'), () =>
        HttpResponse.json(
          {
            error: {
              code: 'VALIDATION_FAILED',
              message: 'Request payload is invalid.',
              details: [{ path: 'password', message: 'Must be at least 10 characters.' }],
              requestId: 'r1',
            },
          },
          { status: 400 },
        ),
      ),
    );

    const { apiFetch } = await import('./api-fetch');
    const result = await apiFetch('/auth/register', { method: 'POST' });

    expect(result).toMatchObject({
      ok: false,
      code: 'VALIDATION_FAILED',
      details: [{ path: 'password', message: 'Must be at least 10 characters.' }],
    });
  });

  describe('in a Server Action or route handler', () => {
    it('refreshes exactly once, rotates the cookies, and retries', async () => {
      let profileCalls = 0;
      let refreshCalls = 0;

      server.use(
        http.get(api('/users/me'), ({ request }) => {
          profileCalls += 1;
          if (profileCalls === 1) return expired();
          // The retry must carry the *rotated* token, not the stale one.
          expect(request.headers.get('cookie')).toContain('tg_access=rotated.access');
          return HttpResponse.json({ id: 'u1' });
        }),
        http.post(api('/auth/refresh'), ({ request }) => {
          refreshCalls += 1;
          expect(request.headers.get('cookie')).toContain('tg_refresh=current.refresh');
          return HttpResponse.json(
            { accessToken: 'rotated.access', expiresIn: 900 },
            { headers: rotatedCookies.map((value): [string, string] => ['set-cookie', value]) },
          );
        }),
      );

      const { apiFetch } = await import('./api-fetch');
      await expect(apiFetch('/users/me', { refreshOnExpiry: true })).resolves.toEqual({
        ok: true,
        data: { id: 'u1' },
      });

      expect(refreshCalls).toBe(1);
      expect(profileCalls).toBe(2);

      // § 6 — the header is rewritten onto the web origin rather than forwarded:
      // the two origins are not necessarily the same host and their cookies do
      // not have the same job.
      const written = Object.fromEntries(
        (cookieStore.current?.writes ?? []).map((cookie) => [cookie.name, cookie]),
      );

      expect(written.tgw_access?.value).toBe('rotated.access');
      expect(written.tgw_refresh?.value).toBe('rotated.refresh');
      expect(written.tgw_access?.options).toMatchObject({
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      });
      // Path=/ on the refresh cookie too: the draft's /api/v1/auth was an
      // API-origin path no web-origin request ever matches, so the cookie would
      // simply never have been sent.
      expect(written.tgw_refresh?.options).toMatchObject({
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      });
      expect(cookieStore.current?.writes.some((c) => c.name.startsWith('tg_'))).toBe(false);
    });

    it('surfaces a second failure rather than looping', async () => {
      let refreshCalls = 0;

      server.use(
        http.get(api('/users/me'), () => expired()),
        http.post(api('/auth/refresh'), () => {
          refreshCalls += 1;
          return HttpResponse.json({ accessToken: 'rotated.access', expiresIn: 900 });
        }),
      );

      const { apiFetch } = await import('./api-fetch');
      const result = await apiFetch('/users/me', { refreshOnExpiry: true });

      expect(result).toMatchObject({ ok: false, code: 'ACCESS_TOKEN_EXPIRED' });
      expect(refreshCalls).toBe(1);
    });

    it('gives up and clears the cookies when the refresh itself fails', async () => {
      server.use(
        http.get(api('/users/me'), () => expired()),
        http.post(api('/auth/refresh'), () =>
          HttpResponse.json(
            { error: { code: 'REFRESH_TOKEN_REUSED', message: 'reused', requestId: 'r1' } },
            { status: 401 },
          ),
        ),
      );

      const { apiFetch } = await import('./api-fetch');
      const result = await apiFetch('/users/me', { refreshOnExpiry: true });

      expect(result).toMatchObject({ ok: false });
      expect(cookieStore.current?.deletes).toEqual(
        expect.arrayContaining(['tgw_access', 'tgw_refresh']),
      );
    });
  });

  it('never refreshes when the caller cannot write a cookie', async () => {
    server.use(
      http.get(api('/users/me'), () => expired()),
      http.post(api('/auth/refresh'), () => {
        throw new Error('a Server Component render must never refresh (Q7)');
      }),
    );

    const { apiFetch } = await import('./api-fetch');
    await expect(apiFetch('/users/me')).resolves.toMatchObject({
      ok: false,
      code: 'ACCESS_TOKEN_EXPIRED',
    });
    expect(cookieStore.current?.writes).toHaveLength(0);
  });

  it('forwards the guest id as X-Guest-Id when one is given', async () => {
    const seen: { guest: string | null } = { guest: null };
    server.use(
      http.post(api('/auth/register'), ({ request }) => {
        seen.guest = request.headers.get('x-guest-id');
        return HttpResponse.json({ claimedResults: 0 }, { status: 201 });
      }),
    );

    const { apiFetch } = await import('./api-fetch');
    await apiFetch('/auth/register', { method: 'POST', guestId: 'guest-1' });

    expect(seen.guest).toBe('guest-1');
  });

  it('reports a transport failure as INTERNAL_ERROR rather than throwing', async () => {
    server.use(http.get(api('/users/me'), () => HttpResponse.error()));

    const { apiFetch } = await import('./api-fetch');
    // The action's union must absorb it: a client never sees a thrown error
    // boundary for something it can render (§ 6 *Server Actions*).
    await expect(apiFetch('/users/me')).resolves.toMatchObject({
      ok: false,
      code: 'INTERNAL_ERROR',
    });
  });
});
