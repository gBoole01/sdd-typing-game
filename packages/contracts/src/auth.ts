import { z } from 'zod';

import { emailField, passwordField, usernameField } from './fields';
import { settingsSchema } from './settings';

/** Spec 001 § 5 — the `/auth/*` contracts. */

export const registerSchema = z
  .object({
    email: emailField,
    username: usernameField,
    password: passwordField,
    /** US-2.7 — validating a consent and then discarding it is not consent. */
    acceptedTerms: z.literal(true),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.password === value.email || value.password === value.username) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['password'],
        message: 'Must not be your email address or username.',
      });
    }
  });

/**
 * Deliberately not the registration password rules: rejecting a short password
 * here would tell the caller their password is not one this system would issue,
 * and would lock out every account that predates a rule change.
 */
export const loginSchema = z
  .object({ email: emailField, password: z.string().min(1, 'Required.') })
  .strict();

export const forgotPasswordSchema = z.object({ email: emailField }).strict();

/**
 * No field here could carry an unchanged-password check, which is the point:
 * US-6.10 / Q14 keep that check on the authenticated endpoint so a link in an
 * inbox never becomes a password-testing oracle.
 */
export const resetPasswordSchema = z
  .object({ token: z.string().min(1, 'Required.'), password: passwordField })
  .strict();

export const validateResetTokenSchema = z.object({ token: z.string().min(1) }).strict();

export const resetTokenReasonSchema = z.enum(['EXPIRED', 'USED', 'INVALID', 'SUPERSEDED']);

export const resetTokenValidationSchema = z.object({
  valid: z.boolean(),
  reason: resetTokenReasonSchema.nullable(),
});

export const authUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  username: z.string(),
  createdAt: z.string(),
});

/** `expiresIn` is derived from `JWT_ACCESS_TTL`; the two must not be able to drift. */
export const authSessionResponseSchema = z.object({
  user: authUserSchema,
  accessToken: z.string(),
  expiresIn: z.number().int().positive(),
});

export const registerResponseSchema = authSessionResponseSchema.extend({
  claimedResults: z.number().int().nonnegative(),
});

export const refreshResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number().int().positive(),
});

/**
 * Q15 — this runs on every protected render, so it may never grow an aggregate.
 * No email, no stats.
 */
export const sessionResponseSchema = z.object({
  user: z.object({ id: z.string(), username: z.string() }),
  settings: settingsSchema,
});

export const guestSessionResponseSchema = z.object({
  guestId: z.string(),
  expiresAt: z.string(),
});

export const forgotPasswordResponseSchema = z.object({ message: z.string() });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ResetTokenReason = z.infer<typeof resetTokenReasonSchema>;
export type ResetTokenValidation = z.infer<typeof resetTokenValidationSchema>;
export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;
export type RegisterResponse = z.infer<typeof registerResponseSchema>;
export type RefreshResponse = z.infer<typeof refreshResponseSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
export type GuestSessionResponse = z.infer<typeof guestSessionResponseSchema>;
export type ForgotPasswordResponse = z.infer<typeof forgotPasswordResponseSchema>;
export type UserProfileAuthUser = z.infer<typeof authUserSchema>;
