import { HttpException } from '@nestjs/common';
import type { ErrorDetail } from '@typing-game/contracts';

/**
 * Every error the API emits carries a stable `code`; clients branch on it and
 * never on `message` (spec/README.md § Error envelope).
 */
export class AppException extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    status: number,
    readonly details?: ErrorDetail[],
  ) {
    super({ code, message, details }, status);
  }
}
