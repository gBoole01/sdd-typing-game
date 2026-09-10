import { z } from 'zod';

/**
 * The single error envelope every non-2xx API response uses
 * (spec/README.md § Error envelope). Clients branch on `code`, never `message`.
 */
export const errorDetailSchema = z.object({
  path: z.string(),
  message: z.string(),
});

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    message: z.string(),
    details: z.array(errorDetailSchema).optional(),
    requestId: z.string(),
  }),
});

export type ErrorDetail = z.infer<typeof errorDetailSchema>;
export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

/**
 * Infrastructure-level error codes owned by spec 002 § 5. Domain codes live in
 * the spec that introduces them.
 */
export const InfraErrorCode = {
  ServiceUnavailable: 'SERVICE_UNAVAILABLE',
  InternalError: 'INTERNAL_ERROR',
  ResourceConflict: 'RESOURCE_CONFLICT',
  ValidationFailed: 'VALIDATION_FAILED',
  NotFound: 'NOT_FOUND',
} as const;

export type InfraErrorCode = (typeof InfraErrorCode)[keyof typeof InfraErrorCode];
