import { isIP } from 'node:net';
import { z } from 'zod';

/**
 * Boot-time environment contract (spec 002 § 5). The app refuses to start on a
 * missing or malformed variable, so no `process.env.X!` ever appears at a call
 * site — and every failure is reported in one pass rather than one per restart.
 */

const PINO_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const intIn = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

const hostname = z
  .string()
  .min(1)
  .regex(
    /^(?=.{1,253}$)[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/,
    'Must be a hostname.',
  );

/** `Name <addr@host>` or a bare `addr@host` (RFC 5322 in the shape we accept). */
const mailFrom = z
  .string()
  .min(1)
  .refine((value) => {
    const bracketed = /^[^<>]+<([^<>@\s]+@[^<>@\s]+\.[^<>@\s]+)>$/.exec(value);
    const address = bracketed ? bracketed[1] : value;
    return /^[^<>@\s]+@[^<>@\s]+\.[^<>@\s]+$/.test(address);
  }, 'Must be an RFC-5322 address or "Name <address>".');

const urlWithProtocol = (protocols: string[], message: string) =>
  z.string().min(1).superRefine((value, ctx) => {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${message} (unparseable URL).` });
      return;
    }
    if (!protocols.includes(parsed.protocol)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    }
  });

const commaSeparated = z
  .string()
  .min(1)
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );

const corsOrigins = commaSeparated.superRefine((origins, ctx) => {
  if (origins.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Must list at least one origin.' });
  }
  for (const origin of origins) {
    try {
      const parsed = new URL(origin);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Not an http(s) origin: ${origin}` });
      }
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Not a valid origin: ${origin}` });
    }
  }
});

/**
 * Required rather than defaulted: it decides whether `X-Client-Ip` is believed,
 * and every per-IP rate limit in spec 001 § 8 rests on it. A wrong default is
 * either one global bucket or a bypass, and neither should be reachable by
 * omission.
 */
const trustedProxyCidrs = commaSeparated.superRefine((cidrs, ctx) => {
  if (cidrs.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Must list at least one CIDR.' });
  }
  for (const cidr of cidrs) {
    const [address, prefix, ...rest] = cidr.split('/');
    const family = isIP(address ?? '');

    if (family === 0 || rest.length > 0 || prefix === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Not a valid CIDR: ${cidr}` });
      continue;
    }

    const bits = Number(prefix);
    const maxBits = family === 4 ? 32 : 128;
    if (!Number.isInteger(bits) || bits < 0 || bits > maxBits) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Prefix out of range: ${cidr}` });
    }
  }
});

const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']),
  PORT: intIn(1, 65535).default(3001),

  DATABASE_URL: urlWithProtocol(['postgresql:'], 'Must be a postgresql: connection URL.'),

  JWT_ACCESS_SECRET: z.string().min(32, 'Must be at least 32 characters.'),
  JWT_ACCESS_TTL: z
    .string()
    .regex(/^\d+(ms|s|m|h|d)$/, 'Must be a duration such as "15m".')
    .default('15m'),
  REFRESH_TOKEN_TTL_DAYS: intIn(1, 365).default(30),
  REFRESH_GRACE_SECONDS: intIn(0, 60).default(10),

  IP_HASH_PEPPER: z.string().min(16, 'Must be at least 16 characters.'),
  SESSION_MAX_ACTIVE: intIn(1, 100).default(20),
  GUEST_SESSION_TTL_DAYS: intIn(1, 365).default(90),

  ARGON2_MEMORY_KIB: intIn(19456, 4194304).default(19456),
  ARGON2_TIME_COST: intIn(1, 10).default(2),
  ARGON2_PARALLELISM: intIn(1, 8).default(1),

  CORS_ORIGIN: corsOrigins,
  TRUSTED_PROXY_CIDRS: trustedProxyCidrs,
  LOG_LEVEL: z.enum(PINO_LEVELS).default('info'),
  COOKIE_DOMAIN: hostname,

  APP_PUBLIC_URL: urlWithProtocol(['http:', 'https:'], 'Must be an http(s) URL.').refine(
    (value) => !value.endsWith('/'),
    'Must not end with a trailing slash.',
  ),

  MAIL_DRIVER: z.enum(['smtp', 'ses', 'memory']).default('smtp'),
  MAIL_FROM: mailFrom,
  SMTP_URL: urlWithProtocol(['smtp:', 'smtps:'], 'Must be an smtp(s) URL.').optional(),
  AWS_REGION: z.string().optional(),
  SES_CONFIGURATION_SET: z.string().min(1, 'Must not be empty when set.').optional(),
  PASSWORD_RESET_TTL_MINUTES: intIn(5, 1440).default(30),
});

/**
 * Choosing a mail driver without its credential fails at boot rather than at
 * the first password reset — the failure that otherwise surfaces only in
 * production, reported by a user who cannot log in to report it (§ 5).
 */
export const envSchema = baseSchema.superRefine((env, ctx) => {
  if (env.MAIL_DRIVER === 'smtp' && !env.SMTP_URL) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['SMTP_URL'],
      message: 'Required when MAIL_DRIVER=smtp.',
    });
  }

  if (env.MAIL_DRIVER === 'ses' && !env.AWS_REGION) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['AWS_REGION'],
      message: 'Required when MAIL_DRIVER=ses.',
    });
  }
});

export type Env = z.infer<typeof envSchema>;

/**
 * `@nestjs/config` `validate:` hook. Aborts the process on any failure, naming
 * every offending variable at once (US-2.1).
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);

  if (!result.success) {
    const lines = result.error.issues.map(
      (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new Error(
      `Invalid environment configuration:\n${lines.join('\n')}\n\nHint: cp .env.example .env`,
    );
  }

  return result.data;
}
