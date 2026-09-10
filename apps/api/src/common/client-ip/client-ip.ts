import { isIP } from 'node:net';

/**
 * Spec 001 § 8 *Client address derivation* (resolved: Q8).
 *
 * Every request reaches the API from the Next.js BFF, so the transport-level
 * peer address is the same for every user on the planet. Keying rate limits or
 * `ipHash` on it makes "5 registrations per IP per hour" mean five per hour for
 * the entire product.
 */

export type ClientIpWarning = 'UNTRUSTED_PEER' | 'HEADER_ABSENT' | 'HEADER_MALFORMED';

export interface DeriveClientIpInput {
  peerAddress: string | undefined;
  headerValue: string | string[] | undefined;
  trustedCidrs: readonly string[];
  /**
   * Accepted only so it can be ignored explicitly. § 8.3: it is a list, anything
   * upstream may append to it, and trusting it from an untrusted peer is a
   * one-line rate-limit bypass.
   */
  forwardedFor?: string | string[] | undefined;
}

export interface DerivedClientIp {
  address: string;
  trusted: boolean;
  warning: ClientIpWarning | null;
}

const UNKNOWN_ADDRESS = 'unknown';
const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

/** Node reports loopback as `::ffff:127.0.0.1` over IPv4-in-IPv6 sockets. */
function normalizeAddress(address: string): string {
  return IPV4_MAPPED.exec(address)?.[1] ?? address;
}

function toBits(address: string): { family: 4 | 6; value: bigint } | null {
  const normalized = normalizeAddress(address);
  const family = isIP(normalized);

  if (family === 4) {
    const octets = normalized.split('.').map(Number);
    if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null;
    return { family: 4, value: octets.reduce((acc, octet) => (acc << 8n) | BigInt(octet), 0n) };
  }

  if (family === 6) {
    const [head, tail] = normalized.split('::');
    const left = head ? head.split(':').filter(Boolean) : [];
    const right = tail ? tail.split(':').filter(Boolean) : [];
    const groups =
      normalized.includes('::')
        ? [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right]
        : left;

    if (groups.length !== 8) return null;
    return {
      family: 6,
      value: groups.reduce((acc, group) => (acc << 16n) | BigInt(Number.parseInt(group, 16)), 0n),
    };
  }

  return null;
}

function withinCidr(address: string, cidr: string): boolean {
  const [network, rawPrefix] = cidr.split('/');
  const target = toBits(address);
  const base = toBits(network ?? '');
  const prefix = Number(rawPrefix);

  if (!target || !base || target.family !== base.family) return false;

  const width = base.family === 4 ? 32 : 128;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > width) return false;

  const shift = BigInt(width - prefix);
  return target.value >> shift === base.value >> shift;
}

function singleHeaderAddress(headerValue: string | string[] | undefined): string | null {
  if (typeof headerValue !== 'string') return null;

  const candidate = headerValue.trim();
  // "only when it parses as one IP" — a list is exactly what X-Forwarded-For is.
  return candidate.length > 0 && isIP(normalizeAddress(candidate)) !== 0 ? candidate : null;
}

export function deriveClientIp({
  peerAddress,
  headerValue,
  trustedCidrs,
}: DeriveClientIpInput): DerivedClientIp {
  const peer = peerAddress ? normalizeAddress(peerAddress) : null;
  const trusted = peer !== null && trustedCidrs.some((cidr) => withinCidr(peer, cidr));

  if (!trusted) {
    // The header is ignored entirely, and its presence is worth a log line:
    // trusting it unconditionally hands every rate limit to the caller.
    return {
      address: peer ?? UNKNOWN_ADDRESS,
      trusted: false,
      warning: headerValue === undefined ? null : 'UNTRUSTED_PEER',
    };
  }

  if (headerValue === undefined) {
    // It means the BFF forgot to forward, and the limits have quietly become
    // global — a `warn`, not silence (§ 7).
    return { address: peer as string, trusted: true, warning: 'HEADER_ABSENT' };
  }

  const forwarded = singleHeaderAddress(headerValue);
  if (forwarded === null) {
    return { address: peer as string, trusted: true, warning: 'HEADER_MALFORMED' };
  }

  return { address: forwarded, trusted: true, warning: null };
}
