import 'server-only';

import { cookies, headers } from 'next/headers';
import type { ErrorDetail } from '@typing-game/contracts';

import { API_COOKIE, WEB_COOKIE, translateToWebOrigin } from './cookies';
import { env } from './env';

/**
 * The only thing in this app that talks to NestJS (ARCHITECTURE.md § 4). The
 * browser never does: tokens stay in httpOnly cookies scoped to the web origin,
 * so an XSS foothold cannot exfiltrate a session.
 */

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string; details?: ErrorDetail[] };

export interface ApiFetchInit extends Omit<RequestInit, 'signal'> {
  /**
   * True only in a Server Action or route handler — the places Next.js permits
   * `cookies().set()` (§ 6, Q7). It authorises two things that are the same
   * permission: retrying once through `POST /auth/refresh`, and writing any
   * rotated or newly issued session cookie.
   *
   * A Server Component leaves it false, so a render can never drop a rotated
   * token on the floor and replay a consumed one on the next pass.
   */
  refreshOnExpiry?: boolean;
  /** Read server-side from the httpOnly `tgw_guest` cookie by the caller. */
  guestId?: string | null;
}

const TIMEOUT_MS = 5_000;
const EXPIRED = 'ACCESS_TOKEN_EXPIRED';

interface ErrorBody {
  error?: { code?: string; message?: string; details?: ErrorDetail[] };
}

async function readBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (text.length === 0) return undefined;

  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** § 8 — the single client address the platform reports, never the whole list. */
function clientIpFrom(requestHeaders: Headers): string | null {
  const forwarded = requestHeaders.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() ?? null;
  return requestHeaders.get('x-real-ip');
}

export async function apiFetch<T = unknown>(
  path: string,
  init: ApiFetchInit = {},
): Promise<ApiResult<T>> {
  const { refreshOnExpiry = false, guestId, ...requestInit } = init;

  const jar = await cookies();
  const requestHeaders = await headers();

  const send = async (accessToken: string | undefined): Promise<Response> => {
    const outgoing = new Headers(requestInit.headers);

    if (requestInit.body !== undefined && !outgoing.has('content-type')) {
      outgoing.set('content-type', 'application/json');
    }

    // The BFF authenticates by constructing the API-origin cookie from the
    // web-origin value it holds.
    if (accessToken) outgoing.set('cookie', `${API_COOKIE.access}=${accessToken}`);

    const clientIp = clientIpFrom(requestHeaders);
    if (clientIp) outgoing.set('x-client-ip', clientIp);

    const requestId = requestHeaders.get('x-request-id');
    if (requestId) outgoing.set('x-request-id', requestId);

    if (guestId) outgoing.set('x-guest-id', guestId);

    return fetch(`${env().API_BASE_URL}${path}`, {
      ...requestInit,
      headers: outgoing,
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  };

  const toResult = async (response: Response): Promise<ApiResult<T>> => {
    const body = await readBody(response);

    if (response.ok) {
      // Any response that opens or rotates a session carries the cookies for it.
      if (refreshOnExpiry) writeSessionCookies(jar, response.headers);
      return { ok: true, data: body as T };
    }

    const envelope = (body ?? {}) as ErrorBody;
    return {
      ok: false,
      code: envelope.error?.code ?? 'INTERNAL_ERROR',
      message: envelope.error?.message ?? 'Something went wrong.',
      ...(envelope.error?.details ? { details: envelope.error.details } : {}),
    };
  };

  try {
    const first = await toResult(await send(jar.get(WEB_COOKIE.access)?.value));
    if (first.ok || first.code !== EXPIRED || !refreshOnExpiry) return first;

    const rotated = await rotate(jar);
    if (!rotated) {
      // The refresh itself failed: the session is gone, and leaving its cookies
      // in place would replay a dead token on every subsequent request.
      jar.delete(WEB_COOKIE.access);
      jar.delete(WEB_COOKIE.refresh);
      return first;
    }

    // Exactly one retry. A second failure surfaces rather than looping.
    return toResult(await send(jar.get(WEB_COOKIE.access)?.value));
  } catch {
    // The action's union absorbs it: a client never sees a thrown error boundary
    // for something it can render (§ 6 *Server Actions*).
    return { ok: false, code: 'INTERNAL_ERROR', message: 'Something went wrong.' };
  }
}

type CookieJar = Awaited<ReturnType<typeof cookies>>;

function writeSessionCookies(jar: CookieJar, responseHeaders: Headers): void {
  for (const cookie of translateToWebOrigin(responseHeaders)) {
    jar.set(cookie.name, cookie.value, cookie.options);
  }
}

async function rotate(jar: CookieJar): Promise<boolean> {
  const refreshToken = jar.get(WEB_COOKIE.refresh)?.value;
  if (!refreshToken) return false;

  const response = await fetch(`${env().API_BASE_URL}/auth/refresh`, {
    method: 'POST',
    headers: { cookie: `${API_COOKIE.refresh}=${refreshToken}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) return false;

  writeSessionCookies(jar, response.headers);
  return true;
}
