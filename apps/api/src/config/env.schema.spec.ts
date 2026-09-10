import { envSchema } from './env.schema';

/**
 * Spec 002 § 9 "Config", US-2.
 * The schema is the boot gate: everything it rejects here is a process that
 * never starts, rather than an `undefined` surfacing at a call site later.
 */

const validEnv: Record<string, string> = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://typing:typing@localhost:5432/typing_game?schema=public',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  IP_HASH_PEPPER: 'b'.repeat(16),
  CORS_ORIGIN: 'http://localhost:3000',
  TRUSTED_PROXY_CIDRS: '127.0.0.1/32,::1/128',
  COOKIE_DOMAIN: 'localhost',
  APP_PUBLIC_URL: 'http://localhost:3000',
  MAIL_FROM: 'Typing Game <no-reply@typing-game.local>',
  SMTP_URL: 'smtp://localhost:1025',
};

function envWithout(...keys: string[]): Record<string, string> {
  const env = { ...validEnv };
  for (const key of keys) delete env[key];
  return env;
}

describe('envSchema', () => {
  describe('accepts a valid env', () => {
    it('parses and fills every documented default', () => {
      const result = envSchema.safeParse(validEnv);

      expect(result.success).toBe(true);
      if (!result.success) return;

      expect(result.data).toMatchObject({
        NODE_ENV: 'development',
        PORT: 3001,
        JWT_ACCESS_TTL: '15m',
        REFRESH_TOKEN_TTL_DAYS: 30,
        REFRESH_GRACE_SECONDS: 10,
        SESSION_MAX_ACTIVE: 20,
        GUEST_SESSION_TTL_DAYS: 90,
        ARGON2_MEMORY_KIB: 19456,
        ARGON2_TIME_COST: 2,
        ARGON2_PARALLELISM: 1,
        LOG_LEVEL: 'info',
        MAIL_DRIVER: 'smtp',
        PASSWORD_RESET_TTL_MINUTES: 30,
      });
    });

    it('accepts a 32-character JWT_ACCESS_SECRET', () => {
      const result = envSchema.safeParse({ ...validEnv, JWT_ACCESS_SECRET: 'c'.repeat(32) });

      expect(result.success).toBe(true);
    });
  });

  describe('rejects a missing DATABASE_URL', () => {
    it('names the variable in the error', () => {
      const result = envSchema.safeParse(envWithout('DATABASE_URL'));

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain('DATABASE_URL');
    });
  });

  describe('rejects a non-postgresql: DATABASE_URL', () => {
    it.each([
      ['mysql://typing:typing@localhost:3306/typing_game'],
      ['postgres://typing:typing@localhost:5432/typing_game'],
      ['http://localhost:5432/typing_game'],
    ])('rejects %s', (url) => {
      const result = envSchema.safeParse({ ...validEnv, DATABASE_URL: url });

      expect(result.success).toBe(false);
      if (result.success) return;

      const issue = result.error.issues.find((i) => i.path.join('.') === 'DATABASE_URL');
      expect(issue).toBeDefined();
      expect(issue?.message).toMatch(/postgresql/i);
    });

    it('rejects a malformed URL with the parse error (US-2.2)', () => {
      const result = envSchema.safeParse({ ...validEnv, DATABASE_URL: 'not-a-url' });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues.map((i) => i.path.join('.'))).toContain('DATABASE_URL');
    });
  });

  describe('rejects a short JWT_ACCESS_SECRET (US-2.3)', () => {
    it('rejects 31 characters', () => {
      const result = envSchema.safeParse({ ...validEnv, JWT_ACCESS_SECRET: 'd'.repeat(31) });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues.map((i) => i.path.join('.'))).toContain('JWT_ACCESS_SECRET');
    });
  });

  describe('reports all failures at once (US-2.1)', () => {
    it('names both missing variables in one error', () => {
      const result = envSchema.safeParse(envWithout('DATABASE_URL', 'JWT_ACCESS_SECRET'));

      expect(result.success).toBe(false);
      if (result.success) return;

      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toEqual(expect.arrayContaining(['DATABASE_URL', 'JWT_ACCESS_SECRET']));
    });

    it('names every missing variable when the env is empty entirely', () => {
      const result = envSchema.safeParse({});

      expect(result.success).toBe(false);
      if (result.success) return;

      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toEqual(
        expect.arrayContaining([
          'NODE_ENV',
          'DATABASE_URL',
          'JWT_ACCESS_SECRET',
          'IP_HASH_PEPPER',
          'CORS_ORIGIN',
          'TRUSTED_PROXY_CIDRS',
          'COOKIE_DOMAIN',
          'APP_PUBLIC_URL',
          'MAIL_FROM',
        ]),
      );
    });
  });

  describe('coerces PORT from a string', () => {
    it('parses "3001" to the number 3001', () => {
      const result = envSchema.safeParse({ ...validEnv, PORT: '3001' });

      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.PORT).toBe(3001);
    });

    it.each([['0'], ['65536'], ['not-a-port']])('rejects out-of-range PORT %s', (port) => {
      const result = envSchema.safeParse({ ...validEnv, PORT: port });

      expect(result.success).toBe(false);
    });
  });

  describe('conditional mail credentials (§ 5 superRefine)', () => {
    it('requires SMTP_URL when MAIL_DRIVER is smtp', () => {
      const result = envSchema.safeParse({
        ...envWithout('SMTP_URL'),
        MAIL_DRIVER: 'smtp',
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues.map((i) => i.path.join('.'))).toContain('SMTP_URL');
    });

    it('requires AWS_REGION when MAIL_DRIVER is ses', () => {
      const result = envSchema.safeParse({
        ...envWithout('SMTP_URL'),
        MAIL_DRIVER: 'ses',
        AWS_REGION: '',
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues.map((i) => i.path.join('.'))).toContain('AWS_REGION');
    });

    it('requires neither when MAIL_DRIVER is memory', () => {
      const result = envSchema.safeParse({
        ...envWithout('SMTP_URL'),
        MAIL_DRIVER: 'memory',
      });

      expect(result.success).toBe(true);
    });
  });

  describe('APP_PUBLIC_URL', () => {
    it('rejects a trailing slash', () => {
      const result = envSchema.safeParse({ ...validEnv, APP_PUBLIC_URL: 'http://localhost:3000/' });

      expect(result.success).toBe(false);
    });

    it('rejects a non-http(s) protocol', () => {
      const result = envSchema.safeParse({ ...validEnv, APP_PUBLIC_URL: 'ftp://localhost:3000' });

      expect(result.success).toBe(false);
    });
  });

  describe('TRUSTED_PROXY_CIDRS', () => {
    it('rejects an unparseable CIDR', () => {
      const result = envSchema.safeParse({ ...validEnv, TRUSTED_PROXY_CIDRS: '127.0.0.1/33' });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.issues.map((i) => i.path.join('.'))).toContain('TRUSTED_PROXY_CIDRS');
    });
  });

  describe('ARGON2_MEMORY_KIB', () => {
    it('rejects a value below the OWASP baseline of 19456', () => {
      const result = envSchema.safeParse({ ...validEnv, ARGON2_MEMORY_KIB: '4096' });

      expect(result.success).toBe(false);
    });
  });
});
