import { NextResponse, type NextRequest } from 'next/server';

import { API_COOKIE, WEB_COOKIE, translateToWebOrigin } from './lib/cookies';
import { env } from './lib/env';
import { PATHNAME_HEADER } from './lib/session';

/**
 * Spec 001 § 6 *Route protection*, and ARCHITECTURE.md § 4.
 *
 * Optimistic on identity, active on transport: it decides from cookie presence
 * and an **unverified** `exp`, and the only API calls it makes are the refresh
 * and guest-issuance calls § 6 names. It never reads the database, and the
 * authoritative check remains the Nest guard plus `requireSession()`.
 *
 * Both calls live here because this is one of the three places Next.js permits
 * a cookie to be written (Q7, Q10).
 */

/** Refresh a little before expiry, so a request in flight does not race it. */
const REFRESH_SKEW_SECONDS = 30;
const API_TIMEOUT_MS = 5_000;

const ACCOUNT_ROUTE = /^\/account(\/|$)/;
const AUTH_FORM_ROUTES = new Set(['/login', '/register']);
const GAME_ROUTE = '/';

/** Reads `exp` without verifying the signature — the guard is authoritative. */
function expiresWithinSkew(token: string | undefined): boolean {
  if (!token) return true;

  const payload = token.split('.')[1];
  if (!payload) return true;

  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      exp?: number;
    };
    if (typeof claims.exp !== 'number') return true;

    return claims.exp - Math.floor(Date.now() / 1_000) <= REFRESH_SKEW_SECONDS;
  } catch {
    return true;
  }
}

function proceed(request: NextRequest): NextResponse {
  // Stamped so `requireSession()` can name the current path in `?next=`; a
  // Server Component is given no pathname of its own.
  const forwarded = new Headers(request.headers);
  forwarded.set(PATHNAME_HEADER, request.nextUrl.pathname);

  return NextResponse.next({ request: { headers: forwarded } });
}

function toLogin(request: NextRequest): NextResponse {
  const target = new URL('/login', request.nextUrl.origin);
  target.searchParams.set('next', request.nextUrl.pathname);

  return NextResponse.redirect(target);
}

function clearSession(response: NextResponse): NextResponse {
  for (const name of [WEB_COOKIE.access, WEB_COOKIE.refresh]) {
    response.cookies.set(name, '', { path: '/', maxAge: 0 });
  }

  return response;
}

async function callApi(path: string, init: RequestInit): Promise<Response | null> {
  try {
    return await fetch(`${env().API_BASE_URL}${path}`, {
      ...init,
      cache: 'no-store',
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  const accessToken = request.cookies.get(WEB_COOKIE.access)?.value;
  const refreshToken = request.cookies.get(WEB_COOKIE.refresh)?.value;

  if (ACCOUNT_ROUTE.test(pathname)) {
    if (!refreshToken) return toLogin(request);
    if (!expiresWithinSkew(accessToken)) return proceed(request);

    // At most once per 15 minutes per client, not once per prefetch — which is
    // what keeps prefetched RSC payloads from rendering as logged-out redirects.
    const refreshed = await callApi('/auth/refresh', {
      method: 'POST',
      headers: { cookie: `${API_COOKIE.refresh}=${refreshToken}` },
    });

    if (!refreshed?.ok) return clearSession(toLogin(request));

    const response = proceed(request);
    for (const cookie of translateToWebOrigin(refreshed.headers)) {
      response.cookies.set(cookie.name, cookie.value, cookie.options);
    }

    return response;
  }

  // Q17 — the "already signed in" redirect lives here and nowhere else. Putting
  // it in the (auth) layout made two static pages dynamic, discarded `?next=`,
  // and fired on /forgot-password and /reset-password, which a signed-in user is
  // entitled to visit.
  if (AUTH_FORM_ROUTES.has(pathname)) {
    return refreshToken
      ? NextResponse.redirect(new URL('/account', request.nextUrl.origin))
      : proceed(request);
  }

  if (pathname === GAME_ROUTE) {
    const hasSession = Boolean(accessToken || refreshToken);
    const hasGuest = Boolean(request.cookies.get(WEB_COOKIE.guest)?.value);
    // US-1.5 — only a real document navigation mints one, so the router's
    // prefetches cannot create orphan rows.
    const isDocument = request.headers.get('sec-fetch-dest') === 'document';

    if (!hasSession && !hasGuest && isDocument) {
      const issued = await callApi('/auth/guest', { method: 'POST' });
      const response = proceed(request);

      if (issued?.ok) {
        const guest = (await issued.json()) as { guestId?: string; expiresAt?: string };

        if (guest.guestId) {
          response.cookies.set(WEB_COOKIE.guest, guest.guestId, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            ...(guest.expiresAt ? { expires: new Date(guest.expiresAt) } : {}),
          });
        }
      }

      // A guest session is a convenience; failing to mint one must not cost the
      // visitor the page they asked for.
      return response;
    }
  }

  return proceed(request);
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|robots.txt).*)'],
};
