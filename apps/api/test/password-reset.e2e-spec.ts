import { Logger } from '@nestjs/common';
import request from 'supertest';

import { createTestApp, type TestApp } from './helpers/app';
import { extractSessionCookies, authHeader, refreshHeader, registerUser, CLIENT_IP, DEFAULT_PASSWORD } from './helpers/factories';
import { expectComparableMedians, sampleMedian } from './helpers/timing';

/**
 * Spec 001 § 9 "Backend — password-reset.e2e-spec.ts". The mail driver is the
 * memory recorder (§ 5 *Mail port*); the suite awaits its flush so "after the
 * response" (US-6.3) does not also mean "after the assertion".
 */

const NEW_PASSWORD = 'a brand new passphrase';

let test: TestApp;

beforeAll(async () => {
  test = await createTestApp();
});

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  await test.reset();
  jest.restoreAllMocks();
});

const forgot = (email: string, clientIp = CLIENT_IP) =>
  request(test.server)
    .post('/api/v1/auth/forgot-password')
    .set('X-Client-Ip', clientIp)
    .send({ email });

const validate = (token: string) =>
  request(test.server)
    .get('/api/v1/auth/reset-password/validate')
    .set('X-Client-Ip', CLIENT_IP)
    .query({ token });

const reset = (token: string, password = NEW_PASSWORD) =>
  request(test.server)
    .post('/api/v1/auth/reset-password')
    .set('X-Client-Ip', CLIENT_IP)
    .send({ token, password });

/** The plaintext token exists only in the mail; the database stores its SHA-256. */
async function requestResetToken(email: string): Promise<string> {
  await forgot(email).expect(202);
  await test.flushMail();

  const record = test.mail.records.at(-1);
  if (!record) throw new Error('no reset mail was recorded');

  const token = new URL(record.resetUrl).searchParams.get('token');
  if (!token) throw new Error(`no token in reset URL: ${record.resetUrl}`);
  return token;
}

describe('POST /auth/forgot-password', () => {
  it('answers 202 and sends one mail after the response', async () => {
    const user = await registerUser(test);

    const response = await forgot(user.email).expect(202);
    expect(response.body).toEqual({ message: expect.any(String) });

    // US-6.2, US-6.3 — the SMTP round trip is off the response path entirely.
    await test.flushMail();
    expect(test.mail.records).toHaveLength(1);
    expect(test.mail.records[0].to).toBe(user.email);
    expect(test.mail.records[0].expiresInMinutes).toBe(30);
    expect(test.mail.records[0].resetUrl).toMatch(
      /^http:\/\/localhost:3000\/reset-password\?token=.+/,
    );

    // Only the hash is at rest — a database dump must not yield a usable link.
    const stored = await test.prisma.passwordResetToken.findFirstOrThrow({
      where: { userId: user.id },
    });
    const token = new URL(test.mail.records[0].resetUrl).searchParams.get('token');
    expect(stored.tokenHash).not.toBe(token);
    expect(stored.expiresAt).toEqual(new Date(test.clock.now().getTime() + 30 * 60 * 1_000));
  });

  it('answers an unknown address identically and sends nothing', async () => {
    const user = await registerUser(test);

    const known = await forgot(user.email).expect(202);
    await test.throttler.resetAll();
    test.mail.reset();

    const unknown = await forgot('nobody@typing-game.local').expect(202);
    await test.flushMail();

    // US-6.1 — no enumeration, in the body or in the row count.
    expect(unknown.body).toEqual(known.body);
    expect(test.mail.records).toHaveLength(0);
    expect(await test.prisma.passwordResetToken.count()).toBe(1);
  });

  it('answers both branches in a comparable time', async () => {
    const user = await registerUser(test);
    const clearLimits = () => test.throttler.resetAll();

    // Q13 — the first draft awaited SMTP on the known branch only, which made
    // this endpoint an order-of-magnitude oracle for exactly the fact US-6.1 hides.
    const knownMedian = await sampleMedian(() => forgot(user.email).expect(202), {
      beforeSample: clearLimits,
    });
    const unknownMedian = await sampleMedian(
      () => forgot('nobody@typing-game.local').expect(202),
      { beforeSample: clearLimits },
    );

    expectComparableMedians(knownMedian, unknownMedian, 'forgot-password existence oracle');
  });

  it('supersedes a prior unused token', async () => {
    const user = await registerUser(test);
    const first = await requestResetToken(user.email);

    test.clock.advanceMinutes(1);
    const second = await requestResetToken(user.email);

    // US-6.4 — only the newest link works.
    const superseded = await reset(first).expect(400);
    expect(superseded.body.error.code).toBe('RESET_TOKEN_SUPERSEDED');

    await reset(second).expect(200);
  });

  it('enforces the per-email limit', async () => {
    const user = await registerUser(test);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await forgot(user.email).expect(202);
    }

    // US-6.8 — 3 per email per hour.
    const limited = await forgot(user.email).expect(429);
    expect(limited.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('still answers 202 when the mail provider fails', async () => {
    const user = await registerUser(test);
    const errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const unhandled = jest.fn();
    process.once('unhandledRejection', unhandled);

    test.mail.failNext(new Error('smtp is down'));

    // US-6.9 — a failure cannot alter a status code, because no status code is
    // still open by the time the send is attempted.
    await forgot(user.email).expect(202);
    await test.flushMail();

    expect(errorLog).toHaveBeenCalled();
    expect(unhandled).not.toHaveBeenCalled();
    process.off('unhandledRejection', unhandled);
  });

  it('never logs the plaintext token', async () => {
    const user = await registerUser(test);
    const written: string[] = [];

    for (const level of ['log', 'error', 'warn', 'debug', 'verbose'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        written.push(args.map((arg) => JSON.stringify(arg)).join(' '));
      });
    }

    const token = await requestResetToken(user.email);

    // § 8 *Logging* — never a token, a token hash, or a reset URL, in any environment.
    expect(token.length).toBeGreaterThan(20);
    for (const line of written) {
      expect(line).not.toContain(token);
      expect(line).not.toContain('/reset-password?token=');
    }
  });
});

describe('GET /auth/reset-password/validate', () => {
  it('reports validity without consuming the token', async () => {
    const user = await registerUser(test);
    const token = await requestResetToken(user.email);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await validate(token).expect(200);
      expect(response.body).toEqual({ valid: true, reason: null });
    }

    // § 5 — a mail client prefetching the link must not be able to burn it.
    await reset(token).expect(200);
  });

  it.each([
    ['INVALID', async () => 'a-token-that-was-never-issued'],
    [
      'EXPIRED',
      async (email: string) => {
        const token = await requestResetToken(email);
        test.clock.advanceMinutes(31);
        return token;
      },
    ],
    [
      'USED',
      async (email: string) => {
        const token = await requestResetToken(email);
        await reset(token).expect(200);
        return token;
      },
    ],
    [
      'SUPERSEDED',
      async (email: string) => {
        const token = await requestResetToken(email);
        test.clock.advanceMinutes(1);
        await requestResetToken(email);
        return token;
      },
    ],
  ])('reports %s as its own reason', async (reason, prepare) => {
    const user = await registerUser(test);
    const token = await prepare(user.email);

    // US-6.7 — the page says "this link has expired", not "something went wrong".
    // Always 200: the shape is the answer, never a 404.
    const response = await validate(token).expect(200);
    expect(response.body).toEqual({ valid: false, reason });
  });
});

describe('POST /auth/reset-password', () => {
  it('sets the password, revokes every session and signs the user in', async () => {
    const user = await registerUser(test);
    test.clock.advanceMinutes(1);
    const otherDevice = await test.prisma.session.findFirstOrThrow({ where: { userId: user.id } });

    const token = await requestResetToken(user.email);
    const response = await reset(token).expect(200);

    // US-6.6 — having just proved control of the mailbox, a forced login adds
    // friction without adding security.
    expect(response.body).toEqual({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        createdAt: expect.any(String),
      },
      accessToken: expect.any(String),
      expiresIn: 900,
    });
    const fresh = extractSessionCookies(response.headers['set-cookie']);

    // US-6.5 — every session that existed before the reset is gone.
    const revoked = await test.prisma.session.findUniqueOrThrow({ where: { id: otherDevice.id } });
    expect(revoked.revokedReason).toBe('PASSWORD_RESET');

    await request(test.server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshHeader(user.cookies))
      .expect(401);

    // The session opened by the reset itself is not among them.
    await request(test.server)
      .get('/api/v1/users/me')
      .set('Cookie', authHeader(fresh))
      .expect(200);

    const persisted = await test.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(persisted.passwordChangedAt).toEqual(test.clock.now());

    const consumed = await test.prisma.passwordResetToken.findFirstOrThrow({
      where: { userId: user.id },
    });
    expect(consumed.usedAt).toEqual(test.clock.now());
  });

  it('accepts the current password as the new one', async () => {
    const user = await registerUser(test);
    const token = await requestResetToken(user.email);

    // US-6.10, Q14 — answering "that is already your password" to whoever holds
    // the link turns a forwarded mail into an unauthenticated password oracle.
    await reset(token, DEFAULT_PASSWORD).expect(200);
  });

  it.each([
    [
      'RESET_TOKEN_EXPIRED',
      async (email: string) => {
        const token = await requestResetToken(email);
        test.clock.advanceMinutes(31);
        return token;
      },
    ],
    [
      'RESET_TOKEN_USED',
      async (email: string) => {
        const token = await requestResetToken(email);
        await reset(token).expect(200);
        return token;
      },
    ],
    ['RESET_TOKEN_INVALID', async () => 'a-token-that-was-never-issued'],
  ])('rejects with %s', async (code, prepare) => {
    const user = await registerUser(test);
    const token = await prepare(user.email);

    // Distinct codes are intentional: the token is the secret, and by the time
    // it is presented, saying why it failed leaks nothing (§ 5).
    const response = await reset(token).expect(400);
    expect(response.body.error.code).toBe(code);
  });

  it('rejects a password that breaks the shared rules', async () => {
    const user = await registerUser(test);
    const token = await requestResetToken(user.email);

    const response = await reset(token, 'short').expect(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(response.body.error.details[0].path).toBe('password');

    // A rejected attempt must not have burned the link.
    await validate(token).expect(200).expect({ valid: true, reason: null });
  });
});
