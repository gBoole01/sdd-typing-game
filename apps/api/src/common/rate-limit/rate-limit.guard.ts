import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { RATE_LIMIT, type RateLimitRule } from './rate-limit';
import { RateLimiterService } from './rate-limiter.service';

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiterService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const rules = this.reflector.getAllAndOverride<RateLimitRule[] | undefined>(RATE_LIMIT, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!rules || rules.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request>();
    // Handler-scoped rather than URL-scoped: two routes must not share a bucket
    // merely because a path parameter made their URLs equal.
    const route = `${context.getClass().name}.${context.getHandler().name}`;

    for (const rule of rules) {
      const subject = this.subjectFor(rule, request);
      if (subject === null) continue;

      this.limiter.consume(`${route}:${rule.scope}:${subject}`, rule.limit, rule.ttlSeconds);
    }

    return true;
  }

  private subjectFor(rule: RateLimitRule, request: Request): string | null {
    if (rule.scope === 'ip') return request.clientIp ?? null;

    const body = request.body as { email?: unknown } | undefined;
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    return email.length > 0 ? email : null;
  }
}
