import { z } from 'zod';

import { checkUsername, describeMixedScript } from './username';

/** Shared field primitives for spec 001 § 5. Declared once; a shape declared twice diverges. */

export const PASSWORD_MIN_LENGTH = 10;
/** Capped *before* hashing, so a long password is not an Argon2 DoS vector (§ 7). */
export const PASSWORD_MAX_LENGTH = 128;
export const EMAIL_MAX_LENGTH = 254;

export const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .email('Must be a valid email address.')
  .max(EMAIL_MAX_LENGTH, `Must be at most ${EMAIL_MAX_LENGTH} characters.`);

export const passwordField = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Must be at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, `Must be at most ${PASSWORD_MAX_LENGTH} characters.`);

/**
 * Rejects malformed and mixed-script names only. A *reserved* name is a 409
 * `USERNAME_TAKEN` decided by the service (§ 5), not a 400 from the schema, so
 * this deliberately lets it through.
 */
export const usernameField = z.string().superRefine((value, ctx) => {
  const result = checkUsername(value);
  if (result.ok || result.reason === 'RESERVED') return;

  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    message:
      result.reason === 'MIXED_SCRIPT'
        ? describeMixedScript(result.scripts)
        : 'Must be 3–20 letters, digits or underscores.',
  });
});

/** BCP-47, in the shape this project accepts: language, optional script, optional region. */
export const languageField = z
  .string()
  .regex(/^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|\d{3}))?$/, 'Must be a BCP-47 language tag.');

/** § 7 — no-op writes are a client bug worth surfacing. */
export function requireAtLeastOneKey<T extends z.ZodTypeAny>(schema: T): z.ZodEffects<T> {
  return schema.refine(
    (value) => Object.keys(value as Record<string, unknown>).length > 0,
    'Provide at least one field to update.',
  );
}
