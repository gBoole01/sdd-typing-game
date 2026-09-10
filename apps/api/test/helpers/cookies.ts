/**
 * `Set-Cookie` parsing for the two cookie sets of spec 001 § 5. The suite
 * asserts attributes — `HttpOnly`, `SameSite`, `Path`, `Max-Age=0` — and not
 * just presence, because the first draft's cookies were well-formed and still
 * never sent: the attributes were the defect.
 */
export interface ParsedCookie {
  name: string;
  value: string;
  /** Attribute names are lowercased; valueless attributes are `true`. */
  attributes: Record<string, string | true>;
}

export function parseSetCookies(raw: string | string[] | undefined): Map<string, ParsedCookie> {
  const headers = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const parsed = new Map<string, ParsedCookie>();

  for (const header of headers) {
    const [pair, ...rest] = header.split(';');
    const separator = pair.indexOf('=');
    if (separator === -1) continue;

    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();

    const attributes: Record<string, string | true> = {};
    for (const attribute of rest) {
      const index = attribute.indexOf('=');
      if (index === -1) {
        attributes[attribute.trim().toLowerCase()] = true;
      } else {
        attributes[attribute.slice(0, index).trim().toLowerCase()] = attribute
          .slice(index + 1)
          .trim();
      }
    }

    parsed.set(name, { name, value, attributes });
  }

  return parsed;
}

export function cookieHeader(cookies: Record<string, string | undefined>): string {
  return Object.entries(cookies)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

/** A cookie is cleared, in the sense US-5.5 and § 5 mean, when it expires now. */
export function isCleared(cookie: ParsedCookie | undefined): boolean {
  if (!cookie) return false;
  const maxAge = cookie.attributes['max-age'];
  return maxAge === '0' || cookie.value === '';
}
