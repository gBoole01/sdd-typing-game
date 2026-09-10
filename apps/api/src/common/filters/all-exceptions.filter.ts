import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InfraErrorCode, type ErrorDetail, type ErrorEnvelope } from '@typing-game/contracts';
import type { Request, Response } from 'express';
import { ZodValidationException } from 'nestjs-zod';
import type { ZodError } from 'zod';

import { AppException } from '../errors/app.exception';

interface Mapped {
  status: number;
  code: string;
  message: string;
  details?: ErrorDetail[];
  logAsError: boolean;
}

/**
 * The single boundary every non-2xx response passes through. Prisma error codes
 * are translated here rather than at each call site, because "a Prisma code
 * never reaches a client" is a property of the boundary — one uncovered service
 * method would otherwise break the guarantee silently (spec 002 § 7).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  /**
   * Unique constraints whose violation has a domain meaning. Anything absent
   * falls back to a generic 409 rather than inventing a code that no spec
   * declares.
   */
  private static readonly UNIQUE_CONSTRAINT_CODES: Record<string, string> = {
    'User.email': 'EMAIL_ALREADY_REGISTERED',
    'User.username': 'USERNAME_TAKEN',
    'User.usernameNormalized': 'USERNAME_TAKEN',
  };

  /**
   * Codes for the framework-generated failures infrastructure can produce.
   * Bounded on purpose: a code is part of the API surface and must appear in a
   * spec before it appears here (spec/README.md § Error envelope).
   */
  private static readonly STATUS_CODES: Record<number, string> = {
    [HttpStatus.BAD_REQUEST]: InfraErrorCode.ValidationFailed,
    [HttpStatus.NOT_FOUND]: InfraErrorCode.NotFound,
    [HttpStatus.SERVICE_UNAVAILABLE]: InfraErrorCode.ServiceUnavailable,
  };

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request & { id?: string }>();
    const response = context.getResponse<Response>();

    const mapped = this.map(exception);

    if (mapped.logAsError) {
      this.logger.error(
        { requestId: request.id, code: mapped.code, path: request.url },
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorEnvelope = {
      error: {
        code: mapped.code,
        message: mapped.message,
        ...(mapped.details ? { details: mapped.details } : {}),
        requestId: request.id ?? 'unknown',
      },
    };

    response.status(mapped.status).json(body);
  }

  private map(exception: unknown): Mapped {
    if (exception instanceof AppException) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        details: exception.details,
        logAsError: exception.getStatus() >= HttpStatus.INTERNAL_SERVER_ERROR,
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.mapPrisma(exception);
    }

    if (exception instanceof Prisma.PrismaClientInitializationError) {
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        code: InfraErrorCode.ServiceUnavailable,
        message: 'The service is temporarily unavailable.',
        logAsError: true,
      };
    }

    if (exception instanceof ZodValidationException) {
      return {
        status: HttpStatus.BAD_REQUEST,
        code: InfraErrorCode.ValidationFailed,
        message: 'Request payload is invalid.',
        details: (exception.getZodError() as ZodError).issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
        logAsError: false,
      };
    }

    if (exception instanceof HttpException) {
      return this.mapHttp(exception);
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: InfraErrorCode.InternalError,
      message: 'An unexpected error occurred.',
      logAsError: true,
    };
  }

  private mapPrisma(exception: Prisma.PrismaClientKnownRequestError): Mapped {
    switch (exception.code) {
      case 'P2002': {
        // Prisma reports the violated *fields*, not the constraint name.
        const meta = exception.meta as { modelName?: string; target?: unknown } | undefined;
        const fields = Array.isArray(meta?.target) ? meta.target.join(',') : String(meta?.target);
        const constraint = `${meta?.modelName ?? ''}.${fields}`;

        return {
          status: HttpStatus.CONFLICT,
          code:
            AllExceptionsFilter.UNIQUE_CONSTRAINT_CODES[constraint] ??
            InfraErrorCode.ResourceConflict,
          message: 'That value is already taken.',
          logAsError: false,
        };
      }

      case 'P2024':
        // Pool exhausted after pool_timeout — logged with the pool metrics (§ 7).
        this.logger.error(
          { prismaCode: exception.code, meta: exception.meta },
          'Connection pool exhausted',
        );
        return {
          status: HttpStatus.SERVICE_UNAVAILABLE,
          code: InfraErrorCode.ServiceUnavailable,
          message: 'The service is temporarily unavailable.',
          logAsError: false,
        };

      case 'P1001':
      case 'P1002':
        return {
          status: HttpStatus.SERVICE_UNAVAILABLE,
          code: InfraErrorCode.ServiceUnavailable,
          message: 'The service is temporarily unavailable.',
          logAsError: true,
        };

      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          code: InfraErrorCode.InternalError,
          message: 'An unexpected error occurred.',
          logAsError: true,
        };
    }
  }

  private mapHttp(exception: HttpException): Mapped {
    const status = exception.getStatus();
    const payload = exception.getResponse();

    if (typeof payload === 'object' && payload !== null && 'code' in payload) {
      const structured = payload as { code: string; message?: string; details?: ErrorDetail[] };
      return {
        status,
        code: structured.code,
        message: structured.message ?? exception.message,
        details: structured.details,
        logAsError: status >= HttpStatus.INTERNAL_SERVER_ERROR,
      };
    }

    if (status === HttpStatus.BAD_REQUEST) {
      const message =
        typeof payload === 'object' && payload !== null && 'message' in payload
          ? (payload as { message: string | string[] }).message
          : exception.message;

      return {
        status,
        code: InfraErrorCode.ValidationFailed,
        message: 'Request payload is invalid.',
        details: (Array.isArray(message) ? message : [message]).map((entry) => ({
          path: '',
          message: entry,
        })),
        logAsError: false,
      };
    }

    return {
      status,
      code: AllExceptionsFilter.STATUS_CODES[status] ?? InfraErrorCode.InternalError,
      message: exception.message,
      logAsError: status >= HttpStatus.INTERNAL_SERVER_ERROR,
    };
  }
}
