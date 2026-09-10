import { z } from 'zod';

import { languageField, requireAtLeastOneKey } from './fields';

/** Spec 001 § 4 `UserSettings` and § 5 `PATCH /users/me/settings`. */

export const caretStyleSchema = z.enum(['OFF', 'BLOCK', 'UNDERLINE', 'SMOOTH']);
export const themeSchema = z.enum(['SYSTEM', 'LIGHT', 'DARK']);
export const testModeSchema = z.enum(['TIME', 'WORDS', 'QUOTE']);

/** Mirrored by a CHECK constraint in the initial migration; the schema is the primary gate. */
export const DEFAULT_DURATIONS = [15, 30, 60, 120] as const;
export const defaultDurationSchema = z.union([
  z.literal(15),
  z.literal(30),
  z.literal(60),
  z.literal(120),
]);

export const settingsSchema = z
  .object({
    caretStyle: caretStyleSchema,
    soundEnabled: z.boolean(),
    theme: themeSchema,
    defaultDuration: defaultDurationSchema,
    defaultMode: testModeSchema,
    language: languageField,
    blindMode: z.boolean(),
    stopOnError: z.boolean(),
  })
  .strict();

export const updateSettingsSchema = requireAtLeastOneKey(settingsSchema.partial().strict());

export type CaretStyle = z.infer<typeof caretStyleSchema>;
export type Theme = z.infer<typeof themeSchema>;
export type TestMode = z.infer<typeof testModeSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type UpdateSettings = z.infer<typeof updateSettingsSchema>;
