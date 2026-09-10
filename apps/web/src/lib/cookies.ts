import { env } from './env';

/**
 * Two cookie sets, on two origins, with two different jobs (spec 001 § 5, Q9).
 * They are never confused because they are never named the same thing.
 */

/** The only cookies a browser ever holds. */
export const WEB_COOKIE = {
  access: 'tgw_access',
  refresh: 'tgw_refresh',
  guest: 'tgw_guest',
} as const;

/** Emitted by the API, consumed by this BFF, never sent to a browser. */
export const API_COOKIE = {
  access: 'tg_access',
  refresh: 'tg_refresh',
  guest: 'tg_guest',
} as const;

const API_TO_WEB: Record<string, string> = {
  [API_COOKIE.access]: WEB_COOKIE.access,
  [API_COOKIE.refresh]: WEB_COOKIE.refresh,
  [API_COOKIE.guest]: WEB_COOKIE.guest,
};

export interface WebCookie {
  name: string;
  value: string;
  options: {
    httpOnly: true;
    secure: boolean;
    sameSite: 'lax';
    path: '/';
    domain?: string;
    expires?: Date;
  };
}

function parseOne(header: string): { name: string; value: string; expires?: Date } | null {
  const [pair, ...attributes] = header.split(';');
  const separator = pair.indexOf('=');
  if (separator === -1) return null;

  const parsed = {
    name: pair.slice(0, separator).trim(),
    value: pair.slice(separator + 1).trim(),
    expires: undefined as Date | undefined,
  };

  for (const attribute of attributes) {
    const [rawName, ...rest] = attribute.split('=');
    const name = rawName.trim().toLowerCase();

    if (name === 'expires') parsed.expires = new Date(rest.join('=').trim());
    if (name === 'max-age') {
      const seconds = Number(rest.join('=').trim());
      if (Number.isFinite(seconds)) parsed.expires = new Date(Date.now() + seconds * 1_000);
    }
  }

  return parsed;
}

export function readSetCookies(headers: Headers): string[] {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const single = headers.get('set-cookie');
  return single ? [single] : [];
}

/**
 * Rewrites the API's `tg_*` cookies onto the web origin as `tgw_*`. The header is
 * **translated**, never forwarded: the two origins are not necessarily the same
 * host, and their cookies do not have the same job.
 *
 * `Path=/` on all three, because the Next.js server reads them on every route —
 * the draft's `Path=/api/v1/auth` was an API-origin path that no web-origin
 * request ever matches, so the refresh cookie would simply never have been sent.
 * `SameSite=Lax` rather than `Strict` so a user arriving from their mail client
 * does not get a logged-out first paint.
 */
export function translateToWebOrigin(headers: Headers): WebCookie[] {
  const translated: WebCookie[] = [];

  for (const header of readSetCookies(headers)) {
    const parsed = parseOne(header);
    const name = parsed && API_TO_WEB[parsed.name];
    if (!parsed || !name) continue;

    translated.push({
      name,
      value: parsed.value,
      options: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        // § 5's web-origin table carries Domain on `tgw_access` alone; the other
        // two are host-only.
        ...(name === WEB_COOKIE.access ? { domain: env().WEB_COOKIE_DOMAIN } : {}),
        ...(parsed.expires ? { expires: parsed.expires } : {}),
      },
    });
  }

  return translated;
}
