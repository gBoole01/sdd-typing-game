import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api, server } from '../test/msw';
import { captureRedirect, fakeCookies, fakeHeaders, redirectMock } from '../test/next';

/**
 * Spec 001 § 9 "Frontend — lib/session.test.ts", and § 6 *Where a cookie may be
 * written*.
 *
 * The first draft refreshed inside `getSession()` during an RSC render. The
 * rotated token could not be persisted, so the next render replayed the
 * consumed one; past the 10-second grace window that is `REFRESH_TOKEN_REUSED`,
 * and the reuse detector logged every user out roughly every fifteen minutes
 * (Q7). These tests exist to keep that fix from regressing.
 */

const cookieStore = vi.hoisted(() => ({ current: null as ReturnType<typeof fakeCookies> | null }));
const headerStore = vi.hoisted(() => ({ current: new Headers() }));

vi.mock('next/headers', () => ({
  cookies: async () => cookieStore.current,
  headers: async () => headerStore.current,
}));

vi.mock('next/navigation', () => ({ redirect: (target: string) => redirectMock(target) }));

/**
 * Asserts the *structural* half of "one render never issues two calls":
 * React's `cache()` only memoises under the RSC runtime, so dedup itself is not
 * decidable in vitest. What is decidable is that the export is wrapped.
 */
const cacheSpy = vi.hoisted(() => vi.fn());
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    cache: (fn: unknown) => {
      cacheSpy(fn);
      return actual.cache(fn as never);
    },
  };
});

const SESSION_BODY = {
  user: { id: 'clx0f9a2b0000v3t5n7m1b0af', username: 'nico' },
  settings: {
    caretStyle: 'SMOOTH',
    soundEnabled: false,
    theme: 'SYSTEM',
    defaultDuration: 30,
    defaultMode: 'TIME',
    language: 'en',
    blindMode: false,
    stopOnError: false,
  },
};

const unauthorized = (code: string) =>
  HttpResponse.json({ error: { code, message: 'no', requestId: 'r1' } }, { status: 401 });

/** Fails the test if the refresh endpoint is touched at all. */
function forbidRefresh(): void {
  server.use(
    http.post(api('/auth/refresh'), () => {
      throw new Error('getSession() must never refresh — it runs where a cookie cannot be written');
    }),
  );
}

beforeEach(() => {
  cookieStore.current = fakeCookies({ tgw_access: 'an.access.jwt' });
  headerStore.current = fakeHeaders({ 'x-pathname': '/account' });
  forbidRefresh();
});

describe('getSession', () => {
  it('reads identity and settings from GET /auth/session', async () => {
    const seen: { cookie: string | null } = { cookie: null };
    server.use(
      http.get(api('/auth/session'), ({ request }) => {
        seen.cookie = request.headers.get('cookie');
        return HttpResponse.json(SESSION_BODY);
      }),
    );

    const { getSession } = await import('./session');
    await expect(getSession()).resolves.toEqual(SESSION_BODY);

    // § 5 — the BFF authenticates by constructing the API-origin cookie from the
    // web-origin value it holds. The two sets are never confused because they
    // are never named the same thing (Q9).
    expect(seen.cookie).toContain('tg_access=an.access.jwt');
    expect(seen.cookie).not.toContain('tgw_access');
  });

  it('returns null on ACCESS_TOKEN_EXPIRED without refreshing or writing a cookie', async () => {
    server.use(http.get(api('/auth/session'), () => unauthorized('ACCESS_TOKEN_EXPIRED')));

    const { getSession } = await import('./session');
    await expect(getSession()).resolves.toBeNull();

    // The whole point of Q7: it returns null and lets the caller redirect.
    // `proxy.ts` has already refreshed for any real navigation.
    expect(cookieStore.current?.writes).toHaveLength(0);
    expect(cookieStore.current?.deletes).toHaveLength(0);
  });

  it('returns null when no access cookie is present, without calling the API', async () => {
    cookieStore.current = fakeCookies();
    server.use(
      http.get(api('/auth/session'), () => {
        throw new Error('no call should be made without a cookie to send');
      }),
    );

    const { getSession } = await import('./session');
    await expect(getSession()).resolves.toBeNull();
  });

  it('returns null on AUTHENTICATION_REQUIRED', async () => {
    server.use(http.get(api('/auth/session'), () => unauthorized('AUTHENTICATION_REQUIRED')));

    const { getSession } = await import('./session');
    await expect(getSession()).resolves.toBeNull();
  });

  it('is wrapped in React cache(), so one render issues one call', async () => {
    server.use(http.get(api('/auth/session'), () => HttpResponse.json(SESSION_BODY)));

    // `cache()` is applied when the module is evaluated, and the registry has
    // already cached it from an earlier test in this file.
    vi.resetModules();
    await import('./session');

    // Dedup itself belongs to the RSC runtime and is not observable here; that
    // the export is memoised is.
    expect(cacheSpy).toHaveBeenCalled();
  });
});

describe('requireSession', () => {
  it('returns the session when there is one', async () => {
    server.use(http.get(api('/auth/session'), () => HttpResponse.json(SESSION_BODY)));

    const { requireSession } = await import('./session');
    await expect(requireSession()).resolves.toEqual(SESSION_BODY);
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('redirects to login carrying the current path as next', async () => {
    headerStore.current = fakeHeaders({ 'x-pathname': '/account/security' });
    server.use(http.get(api('/auth/session'), () => unauthorized('AUTHENTICATION_REQUIRED')));

    const { requireSession } = await import('./session');
    const target = await captureRedirect(() => requireSession());

    expect(target).toBe('/login?next=%2Faccount%2Fsecurity');
  });

  it('falls back to /login with no next when the path header is absent', async () => {
    headerStore.current = fakeHeaders();
    server.use(http.get(api('/auth/session'), () => unauthorized('AUTHENTICATION_REQUIRED')));

    const { requireSession } = await import('./session');
    expect(await captureRedirect(() => requireSession())).toBe('/login');
  });
});
