import { z } from 'zod';

/** Spec 002 § 5 "Liveness / readiness". */
export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  database: z.enum(['up', 'down']),
  uptime: z.number().nonnegative(),
  version: z.string(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
