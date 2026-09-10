import { z } from 'zod';

import { passwordField, requireAtLeastOneKey, usernameField } from './fields';
import { settingsSchema } from './settings';

/** Spec 001 § 5 — the `/users/*` contracts. */

export const updateProfileSchema = requireAtLeastOneKey(
  z.object({ username: usernameField }).strict().partial(),
);

export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1, 'Required.'), newPassword: passwordField })
  .strict();

/** US-8.1 — the literal confirmation, and the opt-in that US-8.5 states before submission. */
export const deleteAccountSchema = z
  .object({
    password: z.string().min(1, 'Required.'),
    confirm: z.literal('DELETE'),
    deleteResults: z.boolean().default(false),
  })
  .strict();

/** No `stats` key: aggregates are `GET /users/me/stats`, owned by spec 003 (Q15). */
export const userProfileSchema = z.object({
  id: z.string(),
  email: z.string(),
  username: z.string(),
  createdAt: z.string(),
  lastLoginAt: z.string().nullable(),
  passwordChangedAt: z.string().nullable(),
  settings: settingsSchema,
});

/** One row per `Session` — a device, never a rotation (US-5.3). */
export const deviceSessionSchema = z.object({
  id: z.string(),
  current: z.boolean(),
  userAgent: z.string().nullable(),
  createdAt: z.string(),
  lastUsedAt: z.string(),
  expiresAt: z.string(),
});

/**
 * Capped at SESSION_MAX_ACTIVE by US-3.5, so it is always one page. `pageInfo`
 * is kept for consistency with spec/README § Pagination and is always empty.
 */
export const deviceSessionListSchema = z.object({
  data: z.array(deviceSessionSchema),
  pageInfo: z.object({
    nextCursor: z.string().nullable(),
    hasNextPage: z.boolean(),
  }),
});

export const usernameAvailabilityQuerySchema = z.object({ username: z.string() }).strict();

export const usernameAvailabilityReasonSchema = z.enum([
  'TAKEN',
  'RESERVED',
  'INVALID_FORMAT',
  'MIXED_SCRIPT',
]);

export const usernameAvailabilitySchema = z.object({
  available: z.boolean(),
  reason: usernameAvailabilityReasonSchema.nullable(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
export type UserProfile = z.infer<typeof userProfileSchema>;
export type DeviceSession = z.infer<typeof deviceSessionSchema>;
export type DeviceSessionList = z.infer<typeof deviceSessionListSchema>;
export type UsernameAvailability = z.infer<typeof usernameAvailabilitySchema>;
export type UsernameAvailabilityReason = z.infer<typeof usernameAvailabilityReasonSchema>;
