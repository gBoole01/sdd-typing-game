import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { api, server } from '../../test/msw';
import { captureRedirect, fakeCookies, fakeHeaders, redirectMock } from '../../test/next';

/**
 * Spec 001 § 9 "Frontend — app/(auth)/actions.test.ts", against § 6 *Server
 * Actions*.
 *
 * Actions return a discriminated union so the client never sees a thrown error
 * boundary for an expected 4xx, and they translate the API-origin `tg_*`
 * cookies onto the web origin rather than forwarding them (Q9).
 */

const cookieStore = vi.hoisted(() => ({ current: null as ReturnType<typeof fakeCookies> | null }));

vi.mock('next/headers', () => ({
  cookies: async () => cookieStore.current,
  headers: async () => fakeHeaders({ 'x-forwarded-for': '203.0.113.10' }),
}));

vi.mock('next/navigation', () => ({ redirect: (target: string) => redirectMock(target) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

/**
 * The API-origin pair, exactly as § 5 describes it. `Domain` is omitted from the
 * fixture because MSW's cookie jar is tough-cookie, which rejects `localhost` as
 * a public suffix — a limitation of the test double, not of the contract. The
 * assertions below are about the *translated* web-origin cookies either way.
 */
const sessionCookies = [
  'tg_access=new.access; Path=/; HttpOnly; SameSite=Lax',
  'tg_refresh=new.refresh; Path=/api/v1/auth; HttpOnly; SameSite=Strict',
];

const sessionBody = {
  user: {
    id: 'clx0f9a2b0000v3t5n7m1b0af',
    email: 'nicolas@example.com',
    username: 'nico',
    createdAt: '2026-09-10T14:32:05.123Z',
  },
  accessToken: 'new.access',
  expiresIn: 900,
};

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

const CREDENTIALS = { email: 'nicolas@example.com', password: 'correct horse battery' };

beforeEach(() => {
  cookieStore.current = fakeCookies();
  server.use(
    http.post(api('/auth/login'), () =>
      HttpResponse.json(sessionBody, {
        headers: sessionCookies.map((value): [string, string] => ['set-cookie', value]),
      }),
    ),
  );
});

describe('loginAction', () => {
  it('translates the API cookies onto the web origin', async () => {
    const { loginAction } = await import('./actions');
    await captureRedirect(() => loginAction(null, form(CREDENTIALS)));

    const written = Object.fromEntries(
      (cookieStore.current?.writes ?? []).map((cookie) => [cookie.name, cookie]),
    );

    expect(written.tgw_access?.value).toBe('new.access');
    expect(written.tgw_refresh?.value).toBe('new.refresh');

    // Path=/ on both, because the Next.js server reads them on every route. The
    // draft's Path=/api/v1/auth was an API-origin path that no web-origin
    // request ever matches, so the refresh cookie would never have been sent.
    for (const name of ['tgw_access', 'tgw_refresh']) {
      expect(written[name]?.options).toMatchObject({
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      });
    }

    // The API-origin names never reach the browser.
    expect(cookieStore.current?.writes.some((c) => c.name.startsWith('tg_'))).toBe(false);
  });

  it('redirects to /account by default', async () => {
    const { loginAction } = await import('./actions');
    expect(await captureRedirect(() => loginAction(null, form(CREDENTIALS)))).toBe('/account');
  });

  it('honours a safe relative next', async () => {
    const { loginAction } = await import('./actions');
    const target = await captureRedirect(() =>
      loginAction(null, form({ ...CREDENTIALS, next: '/account/security' })),
    );

    expect(target).toBe('/account/security');
  });

  it.each([
    ['a protocol-relative URL', '//evil.example'],
    ['an absolute URL', 'https://evil.example/steal'],
    ['a backslash-prefixed URL', '\\\\evil.example'],
    ['a scheme', 'javascript:alert(1)'],
    ['an empty value', ''],
  ])('discards %s and falls back to /account', async (_label, next) => {
    // § 6 — accepted only when it starts with a single "/" and is not "//".
    // Without this the parameter is an open redirect.
    const { loginAction } = await import('./actions');
    const target = await captureRedirect(() => loginAction(null, form({ ...CREDENTIALS, next })));

    expect(target).toBe('/account');
  });

  it('maps INVALID_CREDENTIALS onto the union without redirecting', async () => {
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

    const { loginAction } = await import('./actions');
    const result = await loginAction(null, form(CREDENTIALS));

    expect(result).toMatchObject({ ok: false, code: 'INVALID_CREDENTIALS' });
    expect(redirectMock).not.toHaveBeenCalled();
    expect(cookieStore.current?.writes).toHaveLength(0);
  });

  it('rejects a malformed submission before calling the API', async () => {
    server.use(
      http.post(api('/auth/login'), () => {
        throw new Error('client-side validation is additive, but a bad payload must not be sent');
      }),
    );

    const { loginAction } = await import('./actions');
    const result = await loginAction(null, form({ email: 'not-an-email', password: 'x' }));

    expect(result).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
  });
});

describe('registerAction', () => {
  const REGISTRATION = {
    email: 'nicolas@example.com',
    username: 'nico',
    password: 'correct horse battery',
    acceptedTerms: 'on',
  };

  it('forwards the guest id and clears the guest cookie on success', async () => {
    cookieStore.current = fakeCookies({ tgw_guest: 'guest-1' });

    const seen: { guest: string | null } = { guest: null };
    server.use(
      http.post(api('/auth/register'), ({ request }) => {
        seen.guest = request.headers.get('x-guest-id');
        return HttpResponse.json(
          { ...sessionBody, claimedResults: 3 },
          { status: 201, headers: sessionCookies.map((value): [string, string] => ['set-cookie', value]) },
        );
      }),
    );

    const { registerAction } = await import('./actions');
    await captureRedirect(() => registerAction(null, form(REGISTRATION)));

    // US-2.5 — the guest id travels in the header, read server-side from the
    // httpOnly cookie.
    expect(seen.guest).toBe('guest-1');
    // The guest cookie is spent; the account cookies replace it.
    expect(cookieStore.current?.deletes).toContain('tgw_guest');
  });

  it('sends no guest header when there is no guest cookie', async () => {
    const seen: { guest: string | null } = { guest: 'unset' };
    server.use(
      http.post(api('/auth/register'), ({ request }) => {
        seen.guest = request.headers.get('x-guest-id');
        return HttpResponse.json(
          { ...sessionBody, claimedResults: 0 },
          { status: 201, headers: sessionCookies.map((value): [string, string] => ['set-cookie', value]) },
        );
      }),
    );

    const { registerAction } = await import('./actions');
    await captureRedirect(() => registerAction(null, form(REGISTRATION)));

    expect(seen.guest).toBeNull();
  });

  it.each([
    ['EMAIL_ALREADY_REGISTERED', 409],
    ['USERNAME_TAKEN', 409],
  ])('maps %s onto the union', async (code, status) => {
    server.use(
      http.post(api('/auth/register'), () =>
        HttpResponse.json(
          { error: { code, message: 'taken', requestId: 'r1' } },
          { status },
        ),
      ),
    );

    const { registerAction } = await import('./actions');
    expect(await registerAction(null, form(REGISTRATION))).toMatchObject({ ok: false, code });
  });

  it('requires acceptedTerms', async () => {
    server.use(
      http.post(api('/auth/register'), () => {
        throw new Error('consent is required before the API is called');
      }),
    );

    const { acceptedTerms: _omitted, ...withoutConsent } = REGISTRATION;
    const { registerAction } = await import('./actions');

    expect(await registerAction(null, form(withoutConsent))).toMatchObject({
      ok: false,
      code: 'VALIDATION_FAILED',
    });
  });
});

describe('forgotPasswordAction', () => {
  it('returns the same success state whether or not the account exists', async () => {
    server.use(
      http.post(api('/auth/forgot-password'), () =>
        HttpResponse.json(
          { message: 'If an account exists for that address, a reset link is on its way.' },
          { status: 202 },
        ),
      ),
    );

    const { forgotPasswordAction } = await import('./actions');

    const known = await forgotPasswordAction(null, form({ email: 'nicolas@example.com' }));
    const unknown = await forgotPasswordAction(null, form({ email: 'nobody@example.com' }));

    // US-6.1 — the UI must never branch on existence, so the states must be equal.
    expect(known).toEqual(unknown);
    expect(known).toMatchObject({ ok: true });
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it('surfaces a rate limit rather than pretending to succeed', async () => {
    server.use(
      http.post(api('/auth/forgot-password'), () =>
        HttpResponse.json(
          { error: { code: 'RATE_LIMIT_EXCEEDED', message: 'slow down', requestId: 'r1' } },
          { status: 429 },
        ),
      ),
    );

    const { forgotPasswordAction } = await import('./actions');
    expect(await forgotPasswordAction(null, form({ email: 'nicolas@example.com' }))).toMatchObject({
      ok: false,
      code: 'RATE_LIMIT_EXCEEDED',
    });
  });
});

describe('resetPasswordAction', () => {
  it('signs the user in and redirects on success', async () => {
    server.use(
      http.post(api('/auth/reset-password'), () =>
        HttpResponse.json(sessionBody, {
          headers: sessionCookies.map((value): [string, string] => ['set-cookie', value]),
        }),
      ),
    );

    const { resetPasswordAction } = await import('./actions');
    const target = await captureRedirect(() =>
      resetPasswordAction(null, form({ token: 'tok', password: 'a brand new passphrase' })),
    );

    // US-6.6 — having proved control of the mailbox, a forced login adds
    // friction without adding security.
    expect(target).toBe('/account');
    expect(cookieStore.current?.writes.map((c) => c.name)).toEqual(
      expect.arrayContaining(['tgw_access', 'tgw_refresh']),
    );
  });

  it.each([
    'RESET_TOKEN_EXPIRED',
    'RESET_TOKEN_USED',
    'RESET_TOKEN_SUPERSEDED',
    'RESET_TOKEN_INVALID',
  ])('returns %s so the page can render its reason panel', async (code) => {
    server.use(
      http.post(api('/auth/reset-password'), () =>
        HttpResponse.json({ error: { code, message: 'no', requestId: 'r1' } }, { status: 400 }),
      ),
    );

    const { resetPasswordAction } = await import('./actions');
    const result = await resetPasswordAction(
      null,
      form({ token: 'tok', password: 'a brand new passphrase' }),
    );

    // The token can expire between page load and submit, so these render the
    // same reason panels rather than a form error (§ 6).
    expect(result).toMatchObject({ ok: false, code });
  });
});
