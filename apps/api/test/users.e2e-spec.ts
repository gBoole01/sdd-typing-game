import request from 'supertest';

import { createTestApp, type TestApp } from './helpers/app';
import { isCleared, parseSetCookies } from './helpers/cookies';
import {
  API_COOKIE,
  CLIENT_IP,
  DEFAULT_PASSWORD,
  authHeader,
  extractSessionCookies,
  issueGuest,
  loginUser,
  refreshHeader,
  registerUser,
  uniqueIdentity,
  type SessionCookies,
} from './helpers/factories';

/** Spec 001 § 9 "Backend — users.e2e-spec.ts". */

const DEFAULT_SETTINGS = {
  caretStyle: 'SMOOTH',
  soundEnabled: false,
  theme: 'SYSTEM',
  defaultDuration: 30,
  defaultMode: 'TIME',
  language: 'en',
  blindMode: false,
  stopOnError: false,
};

let test: TestApp;

/** Rotates a device's pair, for the suites that advance the clock past an access TTL. */
async function rotate(cookies: SessionCookies): Promise<SessionCookies> {
  const response = await request(test.server)
    .post('/api/v1/auth/refresh')
    .set('Cookie', refreshHeader(cookies))
    .expect(200);

  return extractSessionCookies(response.headers['set-cookie']);
}

beforeAll(async () => {
  test = await createTestApp();
});

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  await test.reset();
});

describe('GET /users/me', () => {
  it('returns the profile and settings, and no aggregates', async () => {
    const user = await registerUser(test);

    const response = await request(test.server)
      .get('/api/v1/users/me')
      .set('Cookie', authHeader(user.cookies))
      .expect(200);

    // US-7.1, Q15 — aggregates are GET /users/me/stats, owned by spec 003, and
    // are fetched only by /account. The draft made the heaviest endpoint the
    // one every render called.
    expect(response.body).toEqual({
      id: user.id,
      email: user.email,
      username: user.username,
      createdAt: expect.any(String),
      lastLoginAt: null,
      passwordChangedAt: null,
      settings: DEFAULT_SETTINGS,
    });
    expect(response.body).not.toHaveProperty('stats');
    expect(response.body).not.toHaveProperty('passwordHash');
  });

  it('refuses a guest session', async () => {
    const { guestId } = await issueGuest(test);

    // US-1.4
    const response = await request(test.server)
      .get('/api/v1/users/me')
      .set('X-Guest-Id', guestId)
      .expect(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });
});

describe('PATCH /users/me', () => {
  it('applies a partial update and leaves omitted fields alone', async () => {
    const user = await registerUser(test);
    const renamed = `${user.username}_v2`;

    const response = await request(test.server)
      .patch('/api/v1/users/me')
      .set('Cookie', authHeader(user.cookies))
      .send({ username: renamed })
      .expect(200);

    // US-7.2
    expect(response.body.username).toBe(renamed);
    expect(response.body.email).toBe(user.email);
    expect(response.body.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('rejects an empty body', async () => {
    const user = await registerUser(test);

    // § 7 — no-op writes are a client bug worth surfacing.
    const response = await request(test.server)
      .patch('/api/v1/users/me')
      .set('Cookie', authHeader(user.cookies))
      .send({})
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects a username that is taken, matched on the normalised form', async () => {
    const taken = await registerUser(test);
    const user = await registerUser(test);

    // § 7 — a username differing only in case is the same username.
    const response = await request(test.server)
      .patch('/api/v1/users/me')
      .set('Cookie', authHeader(user.cookies))
      .send({ username: taken.username.toUpperCase() })
      .expect(409);
    expect(response.body.error.code).toBe('USERNAME_TAKEN');
  });

  it('enforces the 30-day username cooldown', async () => {
    const user = await registerUser(test);

    await request(test.server)
      .patch('/api/v1/users/me')
      .set('Cookie', authHeader(user.cookies))
      .send({ username: `${user.username}_a` })
      .expect(200);

    const changedAt = test.clock.now();
    test.clock.advanceDays(29);

    // The 15-minute access token cannot survive the advance, so the device does
    // what a real one does and rotates first. The cooldown is what is under
    // test, not token lifetime.
    const cookies = await rotate(user.cookies);

    const response = await request(test.server)
      .patch('/api/v1/users/me')
      .set('Cookie', authHeader(cookies))
      .send({ username: `${user.username}_b` })
      .expect(429);

    // US-7.3 — `retryAfter` rides in `details[]`, the only structured slot the
    // error envelope has (spec/README § Error envelope).
    expect(response.body.error.code).toBe('USERNAME_CHANGE_TOO_SOON');
    expect(response.body.error.details[0].path).toBe('username');
    expect(new Date(response.body.error.details[0].message).toISOString()).toBe(
      new Date(changedAt.getTime() + 30 * 24 * 60 * 60 * 1_000).toISOString(),
    );

    // Day 31 is past the session's absolute 30-day lifetime, which rotation
    // never extends (US-4.6) — so the device signs in again rather than
    // refreshing. The cooldown, not session lifetime, is what is under test.
    test.clock.advanceDays(2);
    const renewed = await loginUser(test, user);

    await request(test.server)
      .patch('/api/v1/users/me')
      .set('Cookie', authHeader(renewed.cookies))
      .send({ username: `${user.username}_b` })
      .expect(200);
  });
});

describe('GET /users/username-available', () => {
  it.each([
    ['a free name', () => uniqueIdentity().username, { available: true, reason: null }],
    ['a reserved name', () => 'admin', { available: false, reason: 'RESERVED' }],
    ['a mixed-script name', () => 'nіco', { available: false, reason: 'MIXED_SCRIPT' }],
    ['a malformed name', () => 'no', { available: false, reason: 'INVALID_FORMAT' }],
  ])('reports %s', async (_label, username, expected) => {
    const response = await request(test.server)
      .get('/api/v1/users/username-available')
      .set('X-Client-Ip', CLIENT_IP)
      .query({ username: username() })
      .expect(200);

    expect(response.body).toEqual(expected);
  });

  it('reports a taken name', async () => {
    const user = await registerUser(test);

    const response = await request(test.server)
      .get('/api/v1/users/username-available')
      .set('X-Client-Ip', CLIENT_IP)
      .query({ username: user.username })
      .expect(200);

    expect(response.body).toEqual({ available: false, reason: 'TAKEN' });
  });
});

describe('PATCH /users/me/settings', () => {
  it('updates a subset and returns the whole object', async () => {
    const user = await registerUser(test);

    const response = await request(test.server)
      .patch('/api/v1/users/me/settings')
      .set('Cookie', authHeader(user.cookies))
      .send({ caretStyle: 'BLOCK', defaultDuration: 60 })
      .expect(200);

    expect(response.body).toEqual({
      ...DEFAULT_SETTINGS,
      caretStyle: 'BLOCK',
      defaultDuration: 60,
    });
  });

  it('rejects an unknown key rather than dropping it', async () => {
    const user = await registerUser(test);

    // § 5 — a typo'd preference key must be loud. This is what `whitelist` and
    // `forbidNonWhitelisted` mean under zod: the schemas are strict.
    const response = await request(test.server)
      .patch('/api/v1/users/me/settings')
      .set('Cookie', authHeader(user.cookies))
      .send({ caretStyleee: 'BLOCK' })
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects a defaultDuration outside the allowed set', async () => {
    const user = await registerUser(test);

    const response = await request(test.server)
      .patch('/api/v1/users/me/settings')
      .set('Cookie', authHeader(user.cookies))
      .send({ defaultDuration: 45 })
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });
});

describe('database check constraints', () => {
  it('refuses a defaultDuration outside 15/30/60/120 at the database', async () => {
    const user = await registerUser(test);

    // § 4 — the schema is the primary gate; this constraint is the backstop.
    await expect(
      test.prisma.$executeRawUnsafe(
        `UPDATE "UserSettings" SET "defaultDuration" = 45 WHERE "userId" = $1`,
        user.id,
      ),
    ).rejects.toThrow(/23514|UserSettings_defaultDuration_allowed/);
  });

  it('refuses a TestResult naming both a user and a guest session', async () => {
    const user = await registerUser(test);
    const { guestId } = await issueGuest(test);

    // § 7 — the exclusivity is enforced by the database, not by a service.
    await expect(
      test.prisma.$executeRawUnsafe(
        `INSERT INTO "TestResult" ("id", "userId", "guestSessionId", "unranked", "createdAt")
         VALUES ('ckresulttwoowners0001', $1, $2, false, now())`,
        user.id,
        guestId,
      ),
    ).rejects.toThrow(/23514|TestResult_owner_exclusive/);
  });

  it('allows a result with neither owner, which is what anonymisation leaves', async () => {
    // `<= 1` rather than `= 1`: an anonymised result legitimately has neither.
    await expect(
      test.prisma.$executeRawUnsafe(
        `INSERT INTO "TestResult" ("id", "unranked", "createdAt")
         VALUES ('ckresultnoowner000001', false, now())`,
      ),
    ).resolves.toBe(1);
  });
});

describe('PATCH /users/me/password', () => {
  it('changes the password and signs every other device out', async () => {
    const user = await registerUser(test);
    test.clock.advanceMinutes(1);
    const otherDevice = await loginUser(test, user);
    const callerSessionId = (
      await test.prisma.session.findFirstOrThrow({
        where: { userId: user.id },
        orderBy: { createdAt: 'asc' },
      })
    ).id;

    await request(test.server)
      .patch('/api/v1/users/me/password')
      .set('Cookie', authHeader(user.cookies))
      .send({ currentPassword: DEFAULT_PASSWORD, newPassword: 'a brand new passphrase' })
      .expect(204);

    // US-7.5 — every session *except* the caller's own, unambiguous now that a
    // session is a device.
    const caller = await test.prisma.session.findUniqueOrThrow({ where: { id: callerSessionId } });
    expect(caller.revokedAt).toBeNull();

    const others = await test.prisma.session.findMany({
      where: { userId: user.id, id: { not: callerSessionId } },
    });
    expect(others).not.toHaveLength(0);
    for (const session of others) expect(session.revokedReason).toBe('PASSWORD_CHANGE');

    await request(test.server)
      .get('/api/v1/users/me')
      .set('Cookie', authHeader(user.cookies))
      .expect(200);
    await request(test.server)
      .get('/api/v1/users/me')
      .set('Cookie', authHeader(otherDevice.cookies))
      .expect(401);

    const persisted = await test.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(persisted.passwordChangedAt).toEqual(test.clock.now());
  });

  it('rejects an unchanged password on the authenticated endpoint', async () => {
    const user = await registerUser(test);

    // Q14 — this is the endpoint that keeps the check, because the caller has
    // already authenticated.
    const response = await request(test.server)
      .patch('/api/v1/users/me/password')
      .set('Cookie', authHeader(user.cookies))
      .send({ currentPassword: DEFAULT_PASSWORD, newPassword: DEFAULT_PASSWORD })
      .expect(400);
    expect(response.body.error.code).toBe('PASSWORD_UNCHANGED');
  });

  it('rejects a wrong current password', async () => {
    const user = await registerUser(test);

    const response = await request(test.server)
      .patch('/api/v1/users/me/password')
      .set('Cookie', authHeader(user.cookies))
      .send({ currentPassword: 'not the password', newPassword: 'a brand new passphrase' })
      .expect(401);
    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('GET /users/me/sessions · DELETE /users/me/sessions/:id', () => {
  it('lists one row per device, not one per rotation', async () => {
    const user = await registerUser(test);
    const sessionId = (
      await test.prisma.session.findFirstOrThrow({ where: { userId: user.id } })
    ).id;

    let cookies = user.cookies;
    for (let rotation = 0; rotation < 5; rotation += 1) {
      test.clock.advanceMinutes(14);
      const rotated = await request(test.server)
        .post('/api/v1/auth/refresh')
        .set('Cookie', refreshHeader(cookies))
        .expect(200);
      cookies = extractSessionCookies(rotated.headers['set-cookie']);
    }

    const response = await request(test.server)
      .get('/api/v1/users/me/sessions')
      .set('Cookie', authHeader(cookies))
      .expect(200);

    // US-5.3 — the whole point of splitting Session from RefreshToken. Five
    // rotations, one device.
    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0]).toEqual({
      id: sessionId,
      current: true,
      userAgent: expect.anything(),
      createdAt: expect.any(String),
      lastUsedAt: expect.any(String),
      expiresAt: expect.any(String),
    });

    // Pagination exemption: capped at SESSION_MAX_ACTIVE, so always one page.
    expect(response.body.pageInfo).toEqual({ nextCursor: null, hasNextPage: false });

    // Never token material, never a raw IP.
    expect(JSON.stringify(response.body)).not.toContain(CLIENT_IP);
    expect(response.body.data[0]).not.toHaveProperty('ipHash');
  });

  it('revokes one device without touching the others', async () => {
    const user = await registerUser(test);
    test.clock.advanceMinutes(1);
    const second = await loginUser(test, user);

    const list = await request(test.server)
      .get('/api/v1/users/me/sessions')
      .set('Cookie', authHeader(second.cookies))
      .expect(200);

    const other = list.body.data.find((row: { current: boolean }) => !row.current);
    expect(other).toBeDefined();

    await request(test.server)
      .delete(`/api/v1/users/me/sessions/${other.id}`)
      .set('Cookie', authHeader(second.cookies))
      .expect(204);

    const revoked = await test.prisma.session.findUniqueOrThrow({ where: { id: other.id } });
    expect(revoked.revokedReason).toBe('MANUAL_REVOKE');

    await request(test.server)
      .get('/api/v1/users/me')
      .set('Cookie', authHeader(user.cookies))
      .expect(401);
    await request(test.server)
      .get('/api/v1/users/me')
      .set('Cookie', authHeader(second.cookies))
      .expect(200);
  });

  it('answers 404 identically for an unknown id and another user\'s id', async () => {
    const user = await registerUser(test);
    const stranger = await registerUser(test);
    const strangerSession = await test.prisma.session.findFirstOrThrow({
      where: { userId: stranger.id },
    });

    const foreign = await request(test.server)
      .delete(`/api/v1/users/me/sessions/${strangerSession.id}`)
      .set('Cookie', authHeader(user.cookies))
      .expect(404);

    const unknown = await request(test.server)
      .delete('/api/v1/users/me/sessions/ckunknownsession00001')
      .set('Cookie', authHeader(user.cookies))
      .expect(404);

    // US-5.4 — never 403, which would confirm the id exists. The bodies are
    // indistinguishable apart from the requestId.
    expect(foreign.body.error.code).toBe('SESSION_NOT_FOUND');
    expect(foreign.body.error.message).toBe(unknown.body.error.message);

    // The stranger keeps their session.
    const untouched = await test.prisma.session.findUniqueOrThrow({
      where: { id: strangerSession.id },
    });
    expect(untouched.revokedAt).toBeNull();
  });

  it('clears both cookies when the revoked device is the caller\'s own', async () => {
    const user = await registerUser(test);
    const sessionId = (
      await test.prisma.session.findFirstOrThrow({ where: { userId: user.id } })
    ).id;

    const response = await request(test.server)
      .delete(`/api/v1/users/me/sessions/${sessionId}`)
      .set('Cookie', authHeader(user.cookies))
      .expect(204);

    // US-5.5 — revoking one's own current session behaves exactly like logout.
    const cookies = parseSetCookies(response.headers['set-cookie']);
    expect(isCleared(cookies.get(API_COOKIE.access))).toBe(true);
    expect(isCleared(cookies.get(API_COOKIE.refresh))).toBe(true);
  });

  it('lists only live sessions', async () => {
    const user = await registerUser(test);
    test.clock.advanceMinutes(1);
    const second = await loginUser(test, user);

    await request(test.server)
      .post('/api/v1/auth/logout')
      .set('Cookie', authHeader(user.cookies))
      .expect(204);

    const response = await request(test.server)
      .get('/api/v1/users/me/sessions')
      .set('Cookie', authHeader(second.cookies))
      .expect(200);

    expect(response.body.data).toHaveLength(1);
    expect(response.body.data[0].current).toBe(true);
  });
});

describe('DELETE /users/me', () => {
  async function seedResults(userId: string, count: number): Promise<void> {
    await test.prisma.testResult.createMany({
      data: Array.from({ length: count }, () => ({ userId, unranked: false })),
    });
  }

  it('anonymises results by default', async () => {
    const user = await registerUser(test);
    await seedResults(user.id, 3);

    const response = await request(test.server)
      .delete('/api/v1/users/me')
      .set('Cookie', authHeader(user.cookies))
      .send({ password: DEFAULT_PASSWORD, confirm: 'DELETE', deleteResults: false })
      .expect(204);

    // US-8.1–8.3 — anonymisation is the `onDelete: SetNull` relation, not
    // service code, so leaderboard integrity survives.
    expect(await test.prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
    expect(await test.prisma.session.count({ where: { userId: user.id } })).toBe(0);

    const results = await test.prisma.testResult.findMany();
    expect(results).toHaveLength(3);
    for (const result of results) expect(result.userId).toBeNull();

    const cookies = parseSetCookies(response.headers['set-cookie']);
    expect(isCleared(cookies.get(API_COOKIE.access))).toBe(true);
    expect(isCleared(cookies.get(API_COOKIE.refresh))).toBe(true);

    await request(test.server)
      .get('/api/v1/users/me')
      .set('Cookie', authHeader(user.cookies))
      .expect(401);
  });

  it('deletes results when the box is ticked', async () => {
    const user = await registerUser(test);
    await seedResults(user.id, 3);

    await request(test.server)
      .delete('/api/v1/users/me')
      .set('Cookie', authHeader(user.cookies))
      .send({ password: DEFAULT_PASSWORD, confirm: 'DELETE', deleteResults: true })
      .expect(204);

    // US-8.4 — deleted first, in the same transaction as the user row.
    expect(await test.prisma.testResult.count()).toBe(0);
    expect(await test.prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
  });

  it('rejects a wrong password and changes nothing', async () => {
    const user = await registerUser(test);

    const response = await request(test.server)
      .delete('/api/v1/users/me')
      .set('Cookie', authHeader(user.cookies))
      .send({ password: 'not the password', confirm: 'DELETE', deleteResults: false })
      .expect(401);

    expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(await test.prisma.user.findUnique({ where: { id: user.id } })).not.toBeNull();
  });

  it.each([
    ['a missing confirmation', { password: DEFAULT_PASSWORD, deleteResults: false }],
    ['a wrong confirmation', { password: DEFAULT_PASSWORD, confirm: 'delete', deleteResults: false }],
    [
      'a non-boolean deleteResults',
      { password: DEFAULT_PASSWORD, confirm: 'DELETE', deleteResults: 'yes' },
    ],
  ])('rejects %s', async (_label, body) => {
    const user = await registerUser(test);

    const response = await request(test.server)
      .delete('/api/v1/users/me')
      .set('Cookie', authHeader(user.cookies))
      .send(body)
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(await test.prisma.user.findUnique({ where: { id: user.id } })).not.toBeNull();
  });
});
