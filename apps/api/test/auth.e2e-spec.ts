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
} from './helpers/factories';
import { expectComparableMedians, sampleMedian } from './helpers/timing';

/**
 * Spec 001 § 9 "Backend — auth.e2e-spec.ts". Runs against postgres-test on
 * :5433 under `--runInBand`, on the injected fake clock (§ 8 *Time*).
 */

const ACCESS_TTL_SECONDS = 900; // JWT_ACCESS_TTL=15m, and `expiresIn` is derived from it, never a literal.

let test: TestApp;

beforeAll(async () => {
  test = await createTestApp();
});

afterAll(async () => {
  await test.close();
});

beforeEach(async () => {
  await test.reset();
});

describe('POST /auth/register', () => {
  it('registers a new user and opens a session', async () => {
    const identity = uniqueIdentity();

    const response = await request(test.server)
      .post('/api/v1/auth/register')
      .set('X-Client-Ip', CLIENT_IP)
      .send({ ...identity, password: DEFAULT_PASSWORD, acceptedTerms: true })
      .expect(201);

    // US-2.1, US-2.4 — the body carries no credential material of any kind.
    expect(response.body).toEqual({
      user: {
        id: expect.any(String),
        email: identity.email,
        username: identity.username,
        createdAt: expect.stringMatching(/Z$/),
      },
      accessToken: expect.any(String),
      expiresIn: ACCESS_TTL_SECONDS,
      claimedResults: 0,
    });
    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(JSON.stringify(response.body)).not.toContain('refreshToken');

    // US-2.7 — a consent that is validated and then discarded is not consent.
    const persisted = await test.prisma.user.findUniqueOrThrow({
      where: { email: identity.email },
    });
    expect(persisted.acceptedTermsAt).toEqual(test.clock.now());
    expect(persisted.passwordHash).not.toContain(DEFAULT_PASSWORD);

    // § 5 *Cookies*, API origin. `Secure` is omitted because NODE_ENV !== production.
    const cookies = parseSetCookies(response.headers['set-cookie']);
    const access = cookies.get(API_COOKIE.access);
    const refresh = cookies.get(API_COOKIE.refresh);

    expect(access?.attributes).toMatchObject({
      httponly: true,
      samesite: 'Lax',
      path: '/',
      domain: 'localhost',
    });
    expect(refresh?.attributes).toMatchObject({
      httponly: true,
      samesite: 'Strict',
      path: '/api/v1/auth',
    });
  });

  it('rejects a duplicate email case-insensitively', async () => {
    const identity = uniqueIdentity();
    await registerUser(test, identity);

    const response = await request(test.server)
      .post('/api/v1/auth/register')
      .set('X-Client-Ip', CLIENT_IP)
      .send({
        email: identity.email.toUpperCase(),
        username: `${identity.username}x`,
        password: DEFAULT_PASSWORD,
        acceptedTerms: true,
      })
      .expect(409);

    // US-2.2 — one account, whatever the case of the address.
    expect(response.body.error.code).toBe('EMAIL_ALREADY_REGISTERED');
  });

  it.each([
    ['ascii', 'admin'],
    ['homoglyph', 'аdmin'], // Cyrillic U+0430 followed by Latin "dmin"
  ])('rejects a reserved username (%s spelling)', async (_label, username) => {
    const response = await request(test.server)
      .post('/api/v1/auth/register')
      .set('X-Client-Ip', CLIENT_IP)
      .send({
        email: uniqueIdentity().email,
        username,
        password: DEFAULT_PASSWORD,
        acceptedTerms: true,
      })
      .expect(409);

    // § 4 and § 9: the reserved list is matched on the *skeleton*, so a
    // homoglyph spelling is 409 RESERVED and not a 400 for mixed script. The
    // reserved check therefore runs before the script check — see the note in
    // the gateway summary, § 7's edge-case row reads the other way round.
    expect(response.body.error.code).toBe('USERNAME_TAKEN');
    expect(response.body.error.details).toEqual([
      { path: 'username', message: 'RESERVED' },
    ]);
  });

  it('rejects a mixed-script username, naming both scripts', async () => {
    const response = await request(test.server)
      .post('/api/v1/auth/register')
      .set('X-Client-Ip', CLIENT_IP)
      .send({
        email: uniqueIdentity().email,
        username: 'nіco', // Latin "n", Cyrillic U+0456, Latin "co"
        password: DEFAULT_PASSWORD,
        acceptedTerms: true,
      })
      .expect(400);

    // § 4 *Username normalisation*: "looks like Latin and Cyrillic mixed" is
    // actionable feedback; "invalid" is not.
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(response.body.error.details[0].path).toBe('username');
    expect(response.body.error.details[0].message).toMatch(/Latin/i);
    expect(response.body.error.details[0].message).toMatch(/Cyrillic/i);
  });

  it('accepts a single-script non-Latin username and stores its skeleton', async () => {
    const username = 'никола'; // "никола", wholly Cyrillic

    await request(test.server)
      .post('/api/v1/auth/register')
      .set('X-Client-Ip', CLIENT_IP)
      .send({
        email: uniqueIdentity().email,
        username,
        password: DEFAULT_PASSWORD,
        acceptedTerms: true,
      })
      .expect(201);

    // Q18: excluding non-ASCII names to dodge homoglyphs excludes most of the
    // world's names. The display form is kept exactly as typed; uniqueness is
    // enforced on the skeleton, which the contracts unit suite pins character
    // by character — a wholly-Cyrillic name does not reduce to ASCII, so this
    // asserts the column is populated, not what it contains.
    const persisted = await test.prisma.user.findUniqueOrThrow({ where: { username } });
    expect(persisted.username).toBe(username);
    expect(persisted.usernameNormalized).not.toHaveLength(0);

    // Case is not a distinguishing feature, whatever the script.
    const collision = await request(test.server)
      .post('/api/v1/auth/register')
      .set('X-Client-Ip', CLIENT_IP)
      .send({
        email: uniqueIdentity().email,
        username: username.toUpperCase(),
        password: DEFAULT_PASSWORD,
        acceptedTerms: true,
      })
      .expect(409);
    expect(collision.body.error.code).toBe('USERNAME_TAKEN');
  });

  it('rejects a password shorter than 10 characters', async () => {
    const response = await request(test.server)
      .post('/api/v1/auth/register')
      .set('X-Client-Ip', CLIENT_IP)
      .send({ ...uniqueIdentity(), password: 'short', acceptedTerms: true })
      .expect(400);

    // US-2.3
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
    expect(response.body.error.details[0].path).toBe('password');
  });

  it('resolves exactly one of two concurrent registrations for the same email', async () => {
    const identity = uniqueIdentity();

    const attempt = (suffix: string) =>
      request(test.server)
        .post('/api/v1/auth/register')
        .set('X-Client-Ip', CLIENT_IP)
        .send({
          email: identity.email,
          username: `${identity.username}${suffix}`,
          password: DEFAULT_PASSWORD,
          acceptedTerms: true,
        });

    const [first, second] = await Promise.all([attempt('a'), attempt('b')]);
    const statuses = [first.status, second.status].sort();

    // § 7: enforced by the unique index, not a read-then-write check. Prisma
    // P2002 maps to the conflict at the filter boundary.
    expect(statuses).toEqual([201, 409]);
    expect([first, second].find((r) => r.status === 409)?.body.error.code).toBe(
      'EMAIL_ALREADY_REGISTERED',
    );
  });
});

describe('guest sessions and the claim-on-signup flow', () => {
  it('issues a guest session and is idempotent about it', async () => {
    const first = await issueGuest(test);
    expect(first.status).toBe(201);
    expect(first.guestId).toEqual(expect.any(String));

    const second = await issueGuest(test, { existingGuestId: first.guestId });

    // § 5: a client retrying on network failure must not accumulate orphan rows.
    expect(second.status).toBe(200);
    expect(second.guestId).toBe(first.guestId);
    expect(await test.prisma.guestSession.count()).toBe(1);
  });

  it('expires the guest session 90 days out', async () => {
    const { expiresAt } = await issueGuest(test);
    const expected = new Date(test.clock.now().getTime() + 90 * 24 * 60 * 60 * 1_000);

    // GUEST_SESSION_TTL_DAYS, confirmed at 90 (Q2).
    expect(new Date(expiresAt).toISOString()).toBe(expected.toISOString());
  });

  it('claims guest results on registration', async () => {
    const { guestId } = await issueGuest(test);

    // Spec 003 owns result submission, so the rows are seeded directly: this
    // spec creates TestResult with only the columns its own flows need (Q12).
    await test.prisma.testResult.createMany({
      data: Array.from({ length: 3 }, () => ({ guestSessionId: guestId, unranked: true })),
    });

    const identity = uniqueIdentity();
    const response = await request(test.server)
      .post('/api/v1/auth/register')
      .set('X-Client-Ip', CLIENT_IP)
      .set('X-Guest-Id', guestId)
      .send({ ...identity, password: DEFAULT_PASSWORD, acceptedTerms: true })
      .expect(201);

    // US-2.5 — the funnel from "tried it once" to "registered" loses no data.
    expect(response.body.claimedResults).toBe(3);

    const claimed = await test.prisma.testResult.findMany();
    expect(claimed).toHaveLength(3);
    for (const result of claimed) {
      expect(result.userId).toBe(response.body.user.id);
      expect(result.guestSessionId).toBeNull();
    }

    const guest = await test.prisma.guestSession.findUniqueOrThrow({ where: { id: guestId } });
    expect(guest.claimedBy).toBe(response.body.user.id);
    expect(guest.claimedAt).toEqual(test.clock.now());

    // The guest cookie is spent; the account cookies replace it.
    const cookies = parseSetCookies(response.headers['set-cookie']);
    expect(isCleared(cookies.get(API_COOKIE.guest))).toBe(true);
  });

  it('claims idempotently when the guest session was already claimed', async () => {
    const { guestId } = await issueGuest(test);
    await test.prisma.testResult.create({ data: { guestSessionId: guestId, unranked: true } });
    await registerUser(test, { guestId });

    const response = await request(test.server)
      .post('/api/v1/auth/register')
      .set('X-Client-Ip', CLIENT_IP)
      .set('X-Guest-Id', guestId)
      .send({ ...uniqueIdentity(), password: DEFAULT_PASSWORD, acceptedTerms: true })
      .expect(201);

    // § 7 — registration succeeds, nothing is claimed, and it is not an error.
    expect(response.body.claimedResults).toBe(0);
  });
});

describe('POST /auth/login', () => {
  it('logs in with correct credentials and records the device', async () => {
    const user = await registerUser(test);
    const before = await test.prisma.session.count();

    test.clock.advanceMinutes(5);
    const response = await request(test.server)
      .post('/api/v1/auth/login')
      .set('X-Client-Ip', CLIENT_IP)
      .set('User-Agent', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')
      .send({ email: user.email, password: user.password })
      .expect(200);

    expect(response.body).toEqual({
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        createdAt: expect.any(String),
      },
      accessToken: expect.any(String),
      expiresIn: ACCESS_TTL_SECONDS,
    });
    expect(response.body).not.toHaveProperty('claimedResults');

    // US-3.4 — one new Session (a device) holding exactly one RefreshToken.
    const persisted = await test.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(persisted.lastLoginAt).toEqual(test.clock.now());
    expect(await test.prisma.session.count()).toBe(before + 1);

    const session = await test.prisma.session.findFirstOrThrow({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      include: { refreshTokens: true },
    });
    expect(session.refreshTokens).toHaveLength(1);
    expect(session.userAgent).toContain('Macintosh');
    expect(session.ipHash).not.toBeNull();
    expect(session.ipHash).not.toContain(CLIENT_IP); // § 8 — peppered, never raw.
  });

  it('answers an unknown email and a wrong password identically', async () => {
    const user = await registerUser(test);

    const unknown = await request(test.server)
      .post('/api/v1/auth/login')
      .set('X-Client-Ip', CLIENT_IP)
      .send({ email: 'nobody@typing-game.local', password: DEFAULT_PASSWORD })
      .expect(401);

    await test.throttler.resetAll();

    const wrongPassword = await request(test.server)
      .post('/api/v1/auth/login')
      .set('X-Client-Ip', CLIENT_IP)
      .send({ email: user.email, password: 'a completely wrong passphrase' })
      .expect(401);

    // US-3.2 — the response must not reveal whether the email exists.
    expect(unknown.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.body.error.message).toBe(wrongPassword.body.error.message);
    expect(unknown.body.error.details).toEqual(wrongPassword.body.error.details);
  });

  it('answers both branches in a comparable time', async () => {
    const user = await registerUser(test);
    const reset = () => test.throttler.resetAll();

    // § 9 Q19 — 25 samples each after 5 warm-ups, medians within 50 ms. The
    // unknown-email branch runs a dummy Argon2 verify so the hash, which
    // dominates the response, is paid on both paths.
    const unknownMedian = await sampleMedian(
      () =>
        request(test.server)
          .post('/api/v1/auth/login')
          .set('X-Client-Ip', CLIENT_IP)
          .send({ email: 'nobody@typing-game.local', password: DEFAULT_PASSWORD })
          .expect(401),
      { beforeSample: reset },
    );

    const wrongPasswordMedian = await sampleMedian(
      () =>
        request(test.server)
          .post('/api/v1/auth/login')
          .set('X-Client-Ip', CLIENT_IP)
          .send({ email: user.email, password: 'a completely wrong passphrase' })
          .expect(401),
      { beforeSample: reset },
    );

    expectComparableMedians(unknownMedian, wrongPasswordMedian, 'login existence oracle');
  });

  it('evicts the least recently used device at the session cap', async () => {
    // Registration opens session 1 and it is never used again, so it stays the
    // least recently used throughout and is the row the cap must evict.
    const user = await registerUser(test);
    const lruSessionId = (
      await test.prisma.session.findFirstOrThrow({ where: { userId: user.id } })
    ).id;

    // 20 further logins take the account to 21 sessions. SESSION_MAX_ACTIVE is
    // 20, so opening the last one evicts the LRU (US-3.5).
    for (let index = 0; index < 20; index += 1) {
      test.clock.advanceMinutes(1);
      await test.throttler.resetAll(); // login is 10/15min/IP and 5/15min/email.
      await loginUser(test, user);
    }

    // The device list stays bounded, and therefore one page long.
    expect(
      await test.prisma.session.count({ where: { userId: user.id, revokedAt: null } }),
    ).toBe(20);

    const evicted = await test.prisma.session.findUniqueOrThrow({ where: { id: lruSessionId } });
    expect(evicted.revokedAt).not.toBeNull();
    expect(evicted.revokedReason).toBe('SESSION_LIMIT');

    // That device is signed out on its next request, not at token expiry.
    await request(test.server)
      .get('/api/v1/users/me')
      .set('Cookie', authHeader(user.cookies))
      .expect(401);
  });
});

describe('POST /auth/refresh', () => {
  const refresh = (token: string) =>
    request(test.server)
      .post('/api/v1/auth/refresh')
      .set('X-Client-Ip', CLIENT_IP)
      .set('Cookie', refreshHeader({ access: '', refresh: token }));

  it('rotates the token without replacing the device', async () => {
    const user = await registerUser(test);
    const session = await test.prisma.session.findFirstOrThrow({ where: { userId: user.id } });

    test.clock.advanceMinutes(14);
    const response = await refresh(user.cookies.refresh).expect(200);

    expect(response.body).toEqual({
      accessToken: expect.any(String),
      expiresIn: ACCESS_TTL_SECONDS,
    });

    // US-4.1, US-4.2 — a new pair, inside the same Session row.
    const rotated = extractSessionCookies(response.headers['set-cookie']);
    expect(rotated.access).not.toBe(user.cookies.access);
    expect(rotated.refresh).not.toBe(user.cookies.refresh);

    expect(await test.prisma.session.count({ where: { userId: user.id } })).toBe(1);
    const after = await test.prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(after.id).toBe(session.id);
    expect(after.lastUsedAt).toEqual(test.clock.now());
    expect(after.revokedAt).toBeNull();

    const tokens = await test.prisma.refreshToken.findMany({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(tokens).toHaveLength(2);
    expect(tokens[0].consumedAt).toEqual(test.clock.now()); // predecessor consumed
    expect(tokens[1].consumedAt).toBeNull(); // successor issued
  });

  it('allows a second rotation inside the grace window', async () => {
    const user = await registerUser(test);
    const session = await test.prisma.session.findFirstOrThrow({ where: { userId: user.id } });

    await refresh(user.cookies.refresh).expect(200);
    const consumedAt = (
      await test.prisma.refreshToken.findFirstOrThrow({
        where: { sessionId: session.id },
        orderBy: { createdAt: 'asc' },
      })
    ).consumedAt;

    // REFRESH_GRACE_SECONDS is 10: two tabs refreshing at the same moment both win.
    test.clock.advanceSeconds(5);
    await refresh(user.cookies.refresh).expect(200);

    const predecessor = await test.prisma.refreshToken.findFirstOrThrow({
      where: { sessionId: session.id },
      orderBy: { createdAt: 'asc' },
    });

    // US-4.5 — grace runs from the *first* use, so polling cannot extend it.
    expect(predecessor.consumedAt).toEqual(consumedAt);

    // US-4.3 — both successors live in the same device, so the list still shows one row.
    expect(await test.prisma.session.count({ where: { userId: user.id } })).toBe(1);
  });

  it('refuses to extend the grace window by repeated use', async () => {
    const user = await registerUser(test);

    await refresh(user.cookies.refresh).expect(200);
    test.clock.advanceSeconds(9);
    await refresh(user.cookies.refresh).expect(200);

    // § 7 "a token polled every 9 s to stay alive": the second grace rotation
    // did not move consumedAt, so 9 + 9 is outside the window, not inside it.
    test.clock.advanceSeconds(9);
    const response = await refresh(user.cookies.refresh).expect(401);
    expect(response.body.error.code).toBe('REFRESH_TOKEN_REUSED');
  });

  it('revokes the whole device when a token is reused after the grace window', async () => {
    const user = await registerUser(test);
    const session = await test.prisma.session.findFirstOrThrow({ where: { userId: user.id } });

    const first = await refresh(user.cookies.refresh).expect(200);
    const successor = extractSessionCookies(first.headers['set-cookie']);

    test.clock.advanceSeconds(11);
    const response = await refresh(user.cookies.refresh).expect(401);

    // US-4.4 — this is the detection signal for a stolen token.
    expect(response.body.error.code).toBe('REFRESH_TOKEN_REUSED');

    const revoked = await test.prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(revoked.revokedAt).toEqual(test.clock.now());
    expect(revoked.revokedReason).toBe('REUSE_DETECTED');

    // Revoking the session kills every token in it — there is no per-token flag
    // to keep in step, so the honest successor dies with the rest.
    const successorResponse = await refresh(successor.refresh).expect(401);
    expect(successorResponse.body.error.code).toBe('SESSION_EXPIRED');

    await request(test.server)
      .get('/api/v1/users/me')
      .set('Cookie', authHeader(successor))
      .expect(401);
  });

  it('never extends the absolute session lifetime', async () => {
    const user = await registerUser(test);
    const session = await test.prisma.session.findFirstOrThrow({ where: { userId: user.id } });
    const createdAt = test.clock.now();

    // REFRESH_TOKEN_TTL_DAYS is 30, fixed at creation (US-4.6, Q16).
    expect(session.expiresAt).toEqual(new Date(createdAt.getTime() + 30 * 24 * 60 * 60 * 1_000));

    test.clock.advanceDays(29);
    const rotated = await refresh(user.cookies.refresh).expect(200);
    const successor = extractSessionCookies(rotated.headers['set-cookie']);

    const after = await test.prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(after.expiresAt).toEqual(session.expiresAt);

    // Every successor inherits the session's expiry verbatim.
    const tokens = await test.prisma.refreshToken.findMany({ where: { sessionId: session.id } });
    for (const token of tokens) expect(token.expiresAt).toEqual(session.expiresAt);

    test.clock.advanceDays(2); // day 31
    const expired = await refresh(successor.refresh).expect(401);
    expect(expired.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('prefers revocation over reuse detection', async () => {
    const user = await registerUser(test);

    await request(test.server)
      .post('/api/v1/auth/logout-all')
      .set('Cookie', authHeader(user.cookies))
      .expect(204);

    const response = await refresh(user.cookies.refresh).expect(401);

    // Decision procedure step 2 before step 3: a refresh after logout-all is
    // not reported as theft.
    expect(response.body.error.code).toBe('SESSION_EXPIRED');
  });

  it('rejects a missing and an unknown refresh token distinctly', async () => {
    const missing = await request(test.server)
      .post('/api/v1/auth/refresh')
      .set('X-Client-Ip', CLIENT_IP)
      .expect(401);
    expect(missing.body.error.code).toBe('REFRESH_TOKEN_MISSING');

    const unknown = await refresh('not-a-token-that-was-ever-issued').expect(401);
    expect(unknown.body.error.code).toBe('REFRESH_TOKEN_INVALID');
  });
});

describe('POST /auth/logout · /auth/logout-all', () => {
  it('is idempotent with and without a session', async () => {
    const user = await registerUser(test);

    const response = await request(test.server)
      .post('/api/v1/auth/logout')
      .set('Cookie', authHeader(user.cookies))
      .expect(204);

    // US-5.1 — a client with a stale token can always reach a clean state.
    const cookies = parseSetCookies(response.headers['set-cookie']);
    expect(isCleared(cookies.get(API_COOKIE.access))).toBe(true);
    expect(isCleared(cookies.get(API_COOKIE.refresh))).toBe(true);

    const session = await test.prisma.session.findFirstOrThrow({ where: { userId: user.id } });
    expect(session.revokedReason).toBe('LOGOUT');

    await request(test.server).post('/api/v1/auth/logout').expect(204);
    await request(test.server)
      .post('/api/v1/auth/logout')
      .set('Cookie', authHeader(user.cookies))
      .expect(204);
  });

  it('signs every other device out on logout-all', async () => {
    const user = await registerUser(test);
    test.clock.advanceMinutes(1);
    const second = await loginUser(test, user);

    await request(test.server)
      .post('/api/v1/auth/logout-all')
      .set('Cookie', authHeader(user.cookies))
      .expect(204);

    // US-5.2 — the caller's own session included.
    const sessions = await test.prisma.session.findMany({ where: { userId: user.id } });
    expect(sessions).toHaveLength(2);
    for (const session of sessions) {
      expect(session.revokedAt).not.toBeNull();
      expect(session.revokedReason).toBe('LOGOUT_ALL');
    }

    await request(test.server)
      .get('/api/v1/users/me')
      .set('Cookie', authHeader(second.cookies))
      .expect(401);
  });
});

describe('the access-token guard', () => {
  it('rejects a token whose session was revoked, without waiting for expiry', async () => {
    const user = await registerUser(test);

    await request(test.server)
      .get('/api/v1/users/me')
      .set('Cookie', authHeader(user.cookies))
      .expect(200);

    await test.prisma.session.updateMany({
      where: { userId: user.id },
      data: { revokedAt: test.clock.now(), revokedReason: 'MANUAL_REVOKE' },
    });

    // US-5.6 — `sid` names the device, so one revocation kills every token it holds.
    const response = await request(test.server)
      .get('/api/v1/users/me')
      .set('Cookie', authHeader(user.cookies))
      .expect(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('rejects a token whose subject no longer exists', async () => {
    const user = await registerUser(test);
    await test.prisma.user.delete({ where: { id: user.id } });

    const response = await request(test.server)
      .get('/api/v1/users/me')
      .set('Cookie', authHeader(user.cookies))
      .expect(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('distinguishes an expired token from a malformed one', async () => {
    const user = await registerUser(test);

    // Distinct so the caller refreshes instead of redirecting to login (§ 5).
    test.clock.advanceMinutes(16);
    const expired = await request(test.server)
      .get('/api/v1/users/me')
      .set('Cookie', authHeader(user.cookies))
      .expect(401);
    expect(expired.body.error.code).toBe('ACCESS_TOKEN_EXPIRED');

    const malformed = await request(test.server)
      .get('/api/v1/users/me')
      .set('Cookie', authHeader({ access: 'not.a.jwt', refresh: '' }))
      .expect(401);
    expect(malformed.body.error.code).toBe('ACCESS_TOKEN_INVALID');
  });
});

describe('GET /auth/session', () => {
  it('returns identity and settings, and nothing that costs another query', async () => {
    // LOG_LEVEL=debug is what makes PrismaService emit query events, which is
    // the spy § 9 asks for.
    const spied = await createTestApp({ env: { LOG_LEVEL: 'debug' } });

    try {
      await spied.reset();
      const user = await registerUser(spied);

      const statements: string[] = [];
      const client = spied.prisma as unknown as {
        $on(event: 'query', callback: (payload: { query: string }) => void): void;
      };
      client.$on('query', (payload) => statements.push(payload.query));

      const response = await request(spied.server)
        .get('/api/v1/auth/session')
        .set('Cookie', authHeader(user.cookies))
        .expect(200);

      expect(response.body).toEqual({
        user: { id: user.id, username: user.username },
        settings: {
          caretStyle: 'SMOOTH',
          soundEnabled: false,
          theme: 'SYSTEM',
          defaultDuration: 30,
          defaultMode: 'TIME',
          language: 'en',
          blindMode: false,
          stopOnError: false,
        },
      });

      // Q15 — this endpoint runs on every protected render, so it may never
      // grow an aggregate. No email, no stats.
      expect(response.body.user).not.toHaveProperty('email');
      expect(response.body).not.toHaveProperty('stats');

      // § 8: the guard resolves user + session in one indexed query on `sid`,
      // and `relationJoins` lets that same query carry UserSettings — so the
      // whole request is one round trip.
      const selects = statements.filter((statement) => /^\s*SELECT/i.test(statement));
      expect(selects).toHaveLength(1);
    } finally {
      await spied.close();
    }
  });
});

describe('rate limiting and client-address derivation', () => {
  /** Distinct emails on every attempt, so the per-email limit never masks the per-IP one. */
  const failedLogin = (server: TestApp['server'], clientIp: string) =>
    request(server)
      .post('/api/v1/auth/login')
      .set('X-Client-Ip', clientIp)
      .send({ email: uniqueIdentity().email, password: DEFAULT_PASSWORD });

  it('keys the login limit on the forwarded client address', async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await failedLogin(test.server, '198.51.100.7').expect(401);
    }

    // US-3.3 — 10 attempts per client IP per 15 minutes.
    const limited = await failedLogin(test.server, '198.51.100.7').expect(429);
    expect(limited.body.error.code).toBe('RATE_LIMIT_EXCEEDED');

    // A different client is a different bucket, which is the whole point of Q8:
    // keyed on the BFF's address this would be one global bucket.
    await failedLogin(test.server, '198.51.100.8').expect(401);
  });

  describe('when the peer is not a trusted proxy', () => {
    let untrusted: TestApp;

    beforeAll(async () => {
      // The loopback peer the suite connects from is deliberately excluded.
      untrusted = await createTestApp({ env: { TRUSTED_PROXY_CIDRS: '10.0.0.0/8' } });
    });

    afterAll(async () => {
      await untrusted.close();
    });

    beforeEach(async () => {
      await untrusted.reset();
    });

    it('ignores X-Client-Ip and falls back to the peer address', async () => {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await failedLogin(untrusted.server, '198.51.100.7').expect(401);
      }

      // § 8.2 — trusting the header from an untrusted peer is a one-line
      // rate-limit bypass, so both header values share the peer's single bucket.
      const limited = await failedLogin(untrusted.server, '203.0.113.99').expect(429);
      expect(limited.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    });

    it('hashes the peer address into the session rather than the header value', async () => {
      const user = await registerUser(untrusted, { clientIp: '203.0.113.99' });
      const session = await untrusted.prisma.session.findFirstOrThrow({
        where: { userId: user.id },
      });

      expect(session.ipHash).not.toBeNull();
      expect(session.ipHash).not.toContain('203.0.113.99');
    });
  });

  it('caps guest issuance per client IP', async () => {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await issueGuest(test, { clientIp: '198.51.100.20' });
      expect(response.status).toBe(201);
    }

    // § 8 — the cap exists because this endpoint writes a row for an
    // unauthenticated caller.
    const limited = await request(test.server)
      .post('/api/v1/auth/guest')
      .set('X-Client-Ip', '198.51.100.20')
      .send()
      .expect(429);
    expect(limited.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('caps registrations per client IP', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await registerUser(test, { clientIp: '198.51.100.30' });
    }

    // US-2.6 — 5 registrations per client IP per hour.
    const limited = await request(test.server)
      .post('/api/v1/auth/register')
      .set('X-Client-Ip', '198.51.100.30')
      .send({ ...uniqueIdentity(), password: DEFAULT_PASSWORD, acceptedTerms: true })
      .expect(429);
    expect(limited.body.error.code).toBe('RATE_LIMIT_EXCEEDED');
  });
});
