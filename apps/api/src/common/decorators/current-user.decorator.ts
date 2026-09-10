import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';

import type { AuthContext } from '../auth/auth-context';

/**
 * The authenticated context the guard already resolved. Result attribution is
 * server-derived: a `userId` in a request body is a 400, never an identity
 * (spec 001 § 7 *Anti-cheat touchpoints*).
 */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthContext => {
    const request = context.switchToHttp().getRequest<Request>();
    if (!request.auth) throw new Error('CurrentAuth used on a route without JwtAuthGuard');
    return request.auth;
  },
);
