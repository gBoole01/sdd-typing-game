import { deriveClientIp } from './client-ip';

/**
 * Spec 001 § 8 *Client address derivation* (resolved: Q8).
 *
 * Every request reaches the API from the BFF, so the peer address is the same
 * for every user on the planet. Keyed on it, "5 registrations per IP per hour"
 * means five registrations per hour for the entire product.
 */

const TRUSTED = ['127.0.0.1/32', '::1/128', '10.0.0.0/8'];

describe('deriveClientIp', () => {
  it('believes the header from a trusted peer', () => {
    expect(
      deriveClientIp({
        peerAddress: '10.1.2.3',
        headerValue: '203.0.113.10',
        trustedCidrs: TRUSTED,
      }),
    ).toEqual({ address: '203.0.113.10', trusted: true, warning: null });
  });

  it('ignores the header from an untrusted peer and warns', () => {
    // § 8.2 — trusting it unconditionally hands every rate limit to the caller.
    expect(
      deriveClientIp({
        peerAddress: '198.51.100.4',
        headerValue: '203.0.113.10',
        trustedCidrs: TRUSTED,
      }),
    ).toEqual({ address: '198.51.100.4', trusted: false, warning: 'UNTRUSTED_PEER' });
  });

  it('falls back to the peer and warns when the header is absent', () => {
    // § 7 — it means the BFF forgot to forward, and the limits have quietly
    // become global. That deserves a log line, not silence.
    expect(
      deriveClientIp({ peerAddress: '10.1.2.3', headerValue: undefined, trustedCidrs: TRUSTED }),
    ).toEqual({ address: '10.1.2.3', trusted: true, warning: 'HEADER_ABSENT' });
  });

  it.each([
    ['not-an-ip', 'not-an-ip'],
    ['a list', '203.0.113.10, 198.51.100.4'],
    ['an empty value', ''],
    ['a repeated header', ['203.0.113.10', '198.51.100.4']],
  ])('falls back to the peer when the header is %s', (_label, headerValue) => {
    // "only when it parses as one IP" — a list is exactly what X-Forwarded-For
    // is, and it is why that header is ignored entirely.
    expect(
      deriveClientIp({ peerAddress: '10.1.2.3', headerValue, trustedCidrs: TRUSTED }),
    ).toEqual({ address: '10.1.2.3', trusted: true, warning: 'HEADER_MALFORMED' });
  });

  it('treats an IPv4-mapped IPv6 peer as its IPv4 form', () => {
    // Node reports loopback as ::ffff:127.0.0.1 over IPv4-in-IPv6 sockets, so a
    // 127.0.0.1/32 entry that did not account for it would trust nothing.
    expect(
      deriveClientIp({
        peerAddress: '::ffff:127.0.0.1',
        headerValue: '203.0.113.10',
        trustedCidrs: ['127.0.0.1/32'],
      }),
    ).toEqual({ address: '203.0.113.10', trusted: true, warning: null });
  });

  it('matches IPv6 CIDRs on prefix, not on string equality', () => {
    expect(
      deriveClientIp({
        peerAddress: '2001:db8::dead:beef',
        headerValue: '203.0.113.10',
        trustedCidrs: ['2001:db8::/32'],
      }),
    ).toEqual({ address: '203.0.113.10', trusted: true, warning: null });
  });

  it('does not widen a prefix by accident', () => {
    expect(
      deriveClientIp({
        peerAddress: '11.0.0.1',
        headerValue: '203.0.113.10',
        trustedCidrs: ['10.0.0.0/8'],
      }).trusted,
    ).toBe(false);
  });

  it('never consults X-Forwarded-For', () => {
    // § 8.3 — it is a list, anything upstream may append to it, and trusting it
    // from an untrusted peer is a one-line rate-limit bypass.
    const result = deriveClientIp({
      peerAddress: '10.1.2.3',
      headerValue: undefined,
      forwardedFor: '203.0.113.10',
      trustedCidrs: TRUSTED,
    });

    expect(result.address).toBe('10.1.2.3');
    expect(result.warning).toBe('HEADER_ABSENT');
  });

  it('falls back safely when the peer address is unknown', () => {
    expect(
      deriveClientIp({ peerAddress: undefined, headerValue: '203.0.113.10', trustedCidrs: TRUSTED })
        .trusted,
    ).toBe(false);
  });
});
