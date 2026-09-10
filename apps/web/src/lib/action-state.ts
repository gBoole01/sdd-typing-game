import type { ErrorDetail } from '@typing-game/contracts';
import type { ZodError } from 'zod';

/**
 * Spec 001 § 6 *Server Actions* — a discriminated union, so the client never
 * sees a thrown error boundary for an expected 4xx.
 */
export type ActionFailure = {
  ok: false;
  code: string;
  message: string;
  details?: ErrorDetail[];
};

export type ActionState = { ok: true } | ActionFailure | null;

export function failure(
  code: string,
  message: string,
  details?: ErrorDetail[],
): ActionFailure {
  return { ok: false, code, message, ...(details ? { details } : {}) };
}

/** Client validation is additive; the action validates again before any call. */
export function validationFailure(error: ZodError): ActionFailure {
  return failure(
    'VALIDATION_FAILED',
    'Please check the highlighted fields.',
    error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
  );
}

/**
 * `?next=` is accepted only when it starts with a single `/` and is not `//`.
 * Without this the parameter is an open redirect (§ 6).
 */
export function safeNext(value: FormDataEntryValue | null | undefined): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  if (!value.startsWith('/')) return null;
  if (value.startsWith('//') || value.startsWith('/\\')) return null;

  return value;
}
