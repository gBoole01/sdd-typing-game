import { Inject, Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { deriveClientIp } from './client-ip';
import { TRUSTED_PROXY_CIDRS } from './client-ip.tokens';

/**
 * Resolves the client address once per request (spec 001 § 8). Doing it here
 * rather than at each call site means the `warn` for a missing or untrusted
 * header is emitted once, not once per consumer.
 */
@Injectable()
export class ClientIpMiddleware implements NestMiddleware {
  private readonly logger = new Logger(ClientIpMiddleware.name);
  constructor(
    @Inject(TRUSTED_PROXY_CIDRS) private readonly trustedCidrs: readonly string[],
  ) {}

  use(request: Request, _response: Response, next: NextFunction): void {
    const { address, warning } = deriveClientIp({
      peerAddress: request.socket.remoteAddress ?? undefined,
      headerValue: request.headers['x-client-ip'],
      trustedCidrs: this.trustedCidrs,
    });

    request.clientIp = address;

    if (warning !== null) {
      this.logger.warn(
        { warning, path: request.url },
        `Client address fell back to the peer address (${warning}).`,
      );
    }

    next();
  }
}
