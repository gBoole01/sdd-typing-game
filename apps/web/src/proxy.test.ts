import { http, HttpResponse } from 'msw';
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';

import { api, server } from './test/msw';

/**
 * Spec 001 § 9 "Frontend — proxy.test.ts", against the redirect/refresh/guest
 * flowchart in § 6.
 *
 * `proxy.ts` is optimistic on identity and active on transport: it decides from
 * cookie presence and an *unverified* `exp`, and the only API calls it makes are
 * the refresh and guest-issuance calls § 6 names. The authoritative check stays
 * the Nest guard plus `requireSession()`.
 */

/** An unverified token: the proxy reads `exp` and never checks the signature. */
function jwt(expiresInSeconds: number): string {
  const encode = (value: object): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');

  return [
    encode({ alg: 'HS256', typ: 'JWT' }),
    encode({
      sub: 'u1',
      sid: 's1',
      exp: Math.floor(Date.now() / 1_000) + expiresInSeconds,
    }),
    'not-a-real-signature',
  ].join('.');
}

interface RequestOptions {
  cookies?: Record<string, string>;
  document?: boolean;
}

function navigate(path: string, options: RequestOptions = {}): NextRequest {
  const headers = new Headers();
  const cookies = Object.entries(options.cookies ?? {});

  if (cookies.length > 0) {
    headers.set('cookie', cookies.map(([name, value]) => `${name}=${value}`).join('; '));
  }

  // US-1.5 — only a real document navigation may mint a guest session; the
  // router's prefetches must not create orphan rows.
  headers.set('sec-fetch-dest', options.document === false ? 'empty' : 'document');

  return new NextRequest(new URL(path, 'https://typing-game.local'), { headers });
}

const FRESH = () => jwt(600);
const STALE = () => jwt(10); // inside the 30-second refresh window

const rotated = () =>
  HttpResponse.json(
    { accessToken: 'rotated.access', expiresIn: 900 },
    {
      headers: [
        ['set-cookie', 'tg_access=rotated.access; Path=/; HttpOnly; SameSite=Lax'],
        ['set-cookie', 'tg_refresh=rotated.refresh; Path=/api/v1/auth; HttpOnly; SameSite=Strict'],
      ],
    },
  );

const refreshRejected = () =>
  HttpResponse.json(
    { error: { code: 'REFRESH_TOKEN_REUSED', message: 'reused', requestId: 'r1' } },
    { status: 401 },
  );

function forbidApi(): void {
  server.use(
    http.post(api('/auth/refresh'), () => {
      throw new Error('no refresh should have been attempted');
    }),
    http.post(api('/auth/guest'), () => {
      throw new Error('no guest session should have been minted');
    }),
  );
}

describe('account routes', () => {
  it('redirects to login with the path as next when no refresh cookie is present', async () => {
    forbidApi();
    const { proxy } = await import('./proxy');

    const response = await proxy(navigate('/account/security'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://typing-game.local/login?next=%2Faccount%2Fsecurity',
    );
  });

  it('continues without a network call when the access cookie is still fresh', async () => {
    forbidApi();
    const { proxy } = await import('./proxy');

    const response = await proxy(
      navigate('/account', { cookies: { tgw_access: FRESH(), tgw_refresh: 'r' } }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('location')).toBeNull();
  });

  it('refreshes once when the access cookie is within 30s of expiry, then continues', async () => {
    let refreshCalls = 0;
    server.use(
      http.post(api('/auth/refresh'), ({ request }) => {
        refreshCalls += 1;
        // The BFF constructs the API-origin cookie from the web-origin value.
        expect(request.headers.get('cookie')).toContain('tg_refresh=current.refresh');
        return rotated();
      }),
    );

    const { proxy } = await import('./proxy');
    const response = await proxy(
      navigate('/account', { cookies: { tgw_access: STALE(), tgw_refresh: 'current.refresh' } }),
    );

    expect(refreshCalls).toBe(1);
    expect(response.status).toBe(200);

    // Rewritten onto the web origin, not forwarded (§ 6 *Server Actions*).
    expect(response.cookies.get('tgw_access')?.value).toBe('rotated.access');
    expect(response.cookies.get('tgw_refresh')?.value).toBe('rotated.refresh');
    expect(response.cookies.get('tg_access')).toBeUndefined();
  });

  it('refreshes when the access cookie is absent but a refresh cookie remains', async () => {
    let refreshCalls = 0;
    server.use(
      http.post(api('/auth/refresh'), () => {
        refreshCalls += 1;
        return rotated();
      }),
    );

    const { proxy } = await import('./proxy');
    const response = await proxy(navigate('/account', { cookies: { tgw_refresh: 'r' } }));

    expect(refreshCalls).toBe(1);
    expect(response.status).toBe(200);
  });

  it('clears both cookies and redirects when the refresh is rejected', async () => {
    server.use(http.post(api('/auth/refresh'), () => refreshRejected()));

    const { proxy } = await import('./proxy');
    const response = await proxy(
      navigate('/account', { cookies: { tgw_access: STALE(), tgw_refresh: 'stolen' } }),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'https://typing-game.local/login?next=%2Faccount',
    );
    expect(response.cookies.get('tgw_access')?.value).toBe('');
    expect(response.cookies.get('tgw_refresh')?.value).toBe('');
  });

  it('passes the pathname on, so requireSession can name it in ?next=', async () => {
    forbidApi();
    const { proxy } = await import('./proxy');

    const response = await proxy(
      navigate('/account/settings', { cookies: { tgw_access: FRESH(), tgw_refresh: 'r' } }),
    );

    expect(response.headers.get('x-middleware-request-x-pathname')).toBe('/account/settings');
  });
});

describe('auth routes', () => {
  it('sends an already-signed-in visitor from /login to /account', async () => {
    forbidApi();
    const { proxy } = await import('./proxy');

    const response = await proxy(navigate('/login', { cookies: { tgw_refresh: 'r' } }));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://typing-game.local/account');
  });

  it('renders the form for a signed-out visitor', async () => {
    forbidApi();
    const { proxy } = await import('./proxy');

    expect((await proxy(navigate('/login'))).status).toBe(200);
    expect((await proxy(navigate('/register'))).status).toBe(200);
  });

  it.each(['/forgot-password', '/reset-password', '/terms', '/privacy'])(
    'never redirects away from %s, even when signed in',
    async (path) => {
      forbidApi();
      const { proxy } = await import('./proxy');

      // A logged-in user resetting a password on a shared device is legitimate.
      const response = await proxy(navigate(path, { cookies: { tgw_refresh: 'r' } }));

      expect(response.status).toBe(200);
      expect(response.headers.get('location')).toBeNull();
    },
  );
});

describe('guest issuance on the game route', () => {
  it('mints a guest session on a document navigation with no cookies', async () => {
    let guestCalls = 0;
    server.use(
      http.post(api('/auth/guest'), () => {
        guestCalls += 1;
        return HttpResponse.json(
          { guestId: 'guest-1', expiresAt: '2026-12-09T14:32:05.123Z' },
          { status: 201 },
        );
      }),
    );

    const { proxy } = await import('./proxy');
    const response = await proxy(navigate('/'));

    expect(guestCalls).toBe(1);
    // § 5 — proxy.ts writes tgw_guest from the response body.
    expect(response.cookies.get('tgw_guest')?.value).toBe('guest-1');
  });

  it('does not mint on a prefetch', async () => {
    forbidApi();
    const { proxy } = await import('./proxy');

    // US-1.5 — the router must not be able to create orphan rows.
    const response = await proxy(navigate('/', { document: false }));

    expect(response.cookies.get('tgw_guest')).toBeUndefined();
  });

  it('does not mint when a guest cookie is already held', async () => {
    forbidApi();
    const { proxy } = await import('./proxy');

    const response = await proxy(navigate('/', { cookies: { tgw_guest: 'guest-1' } }));

    expect(response.cookies.get('tgw_guest')).toBeUndefined();
  });

  it('does not mint for a signed-in visitor', async () => {
    forbidApi();
    const { proxy } = await import('./proxy');

    const response = await proxy(
      navigate('/', { cookies: { tgw_access: FRESH(), tgw_refresh: 'r' } }),
    );

    expect(response.cookies.get('tgw_guest')).toBeUndefined();
  });

  it('renders the game even when guest issuance fails', async () => {
    server.use(http.post(api('/auth/guest'), () => HttpResponse.error()));

    const { proxy } = await import('./proxy');
    const response = await proxy(navigate('/'));

    // A guest session is a convenience; failing to mint one must not cost the
    // visitor the page they asked for.
    expect(response.status).toBe(200);
  });
});

describe('the matcher', () => {
  it('excludes the API, Next internals and static assets', async () => {
    const { config } = await import('./proxy');
    const patterns = (config.matcher as string[]).map(
      (pattern) => new RegExp(`^${pattern}$`),
    );
    const matches = (path: string): boolean => patterns.some((pattern) => pattern.test(path));

    expect(matches('/')).toBe(true);
    expect(matches('/account')).toBe(true);
    expect(matches('/login')).toBe(true);

    // Excluded from the matcher entirely, so no proxy runs (§ 6).
    expect(matches('/api/health')).toBe(false);
    expect(matches('/_next/static/chunk.js')).toBe(false);
    expect(matches('/_next/image')).toBe(false);
    expect(matches('/favicon.ico')).toBe(false);
    expect(matches('/robots.txt')).toBe(false);
  });
});
