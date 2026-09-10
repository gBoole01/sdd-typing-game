import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@typing-game/contracts';

import { Public } from '../../common/decorators/public.decorator';
import { HealthService } from './health.service';

/**
 * `@Public()` because spec 001 made `JwtAuthGuard` global: a probe that needs a
 * credential is not a liveness probe. Endpoints are protected by default, so
 * this opt-out is the deliberate exception.
 */
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  check(): Promise<HealthResponse> {
    return this.health.check();
  }
}
