import { z } from 'zod';

/**
 * The web app's half of the environment contract. Spec 002 § 5 validates the
 * API's; these three are `apps/web`'s, and they are validated the same way and
 * for the same reason: the app refuses to boot on a missing or malformed value,
 * so no `process.env.X!` appears at a call site.
 */
const webEnvSchema = z.object({
  /** Server-only: the browser never calls NestJS directly (ARCHITECTURE.md § 4). */
  API_BASE_URL: z.string().url().refine((value) => !value.endsWith('/'), 'No trailing slash.'),
  NEXT_PUBLIC_APP_URL: z.string().url(),
  /** The origin the `tgw_*` cookies live on — not the API's `COOKIE_DOMAIN` (§ 5). */
  WEB_COOKIE_DOMAIN: z.string().min(1),
});

export type WebEnv = z.infer<typeof webEnvSchema>;

let cached: WebEnv | null = null;

export function env(): WebEnv {
  if (cached) return cached;

  const result = webEnvSchema.safeParse({
    API_BASE_URL: process.env.API_BASE_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    WEB_COOKIE_DOMAIN: process.env.WEB_COOKIE_DOMAIN,
  });

  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new Error(`Invalid web environment:\n${lines.join('\n')}\n\nHint: cp .env.example .env`);
  }

  cached = result.data;
  return cached;
}
