import 'server-only';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import type { SessionResponse } from '@typing-game/contracts';

import { apiFetch } from './api-fetch';
import { WEB_COOKIE } from './cookies';

/**
 * Spec 001 § 6 *Session helpers*.
 *
 * `getSession()` **never** refreshes. It runs inside renders, where a cookie
 * cannot be written, so a rotated token could not be persisted — and replaying
 * the consumed one past the 10-second grace window is `REFRESH_TOKEN_REUSED`,
 * which is how the first draft logged every user out every fifteen minutes
 * (Q7). `proxy.ts` has already refreshed for any real navigation.
 *
 * Wrapped in React `cache()` so one render never issues two `/auth/session`
 * calls; the endpoint's budget is p95 ≤ 25 ms precisely because every protected
 * render makes it.
 */
export const getSession = cache(async (): Promise<SessionResponse | null> => {
  const jar = await cookies();
  if (!jar.get(WEB_COOKIE.access)?.value) return null;

  const result = await apiFetch<SessionResponse>('/auth/session');
  return result.ok ? result.data : null;
});

/** The pathname `proxy.ts` stamps on the request, so a redirect can name it. */
export const PATHNAME_HEADER = 'x-pathname';

export async function requireSession(): Promise<SessionResponse> {
  const session = await getSession();
  if (session) return session;

  const pathname = (await headers()).get(PATHNAME_HEADER);
  redirect(pathname ? `/login?next=${encodeURIComponent(pathname)}` : '/login');
}
