import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC = 'auth:public';

/**
 * Opt-out from the global `JwtAuthGuard`. Endpoints are protected by default, so
 * a forgotten decorator fails closed (CLAUDE.md § API).
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);
