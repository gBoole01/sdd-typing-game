import { AppException } from '../../common/errors/app.exception';
import type { Clock } from '../../common/clock/clock';
import type { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';

/**
 * Spec 001 § 9 "Unit suites" — the refresh decision procedure of § 5, across
 * {unconsumed, consumed inside grace, consumed outside grace} ×
 * {active, revoked, expired}.
 *
 * The e2e suite proves the same procedure over HTTP against a real Postgres;
 * this one exists because the grace-window branch is the single most delicate
 * piece of logic in the spec and deserves the full matrix rather than the three
 * cases an e2e run can afford.
 *
 * NOTE FOR THE GATEWAY: the constructor shape below is a proposal, not
 * something the spec fixes. Reviewing it is part of approving these tests.
 */

const GRACE_SECONDS = 10;
const NOW = new Date('2026-09-10T14:32:05.123Z');

interface SessionRow {
  id: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
  lastUsedAt: Date;
}

interface TokenRow {
  id: string;
  sessionId: string;
  tokenHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}

/**
 * An in-memory stand-in for the two tables the rotation path touches. Assertions
 * are made against the resulting rows rather than against call shapes, so the
 * test constrains the decision procedure and not the phrasing of the queries.
 */
class PrismaFake {
  sessions = new Map<string, SessionRow>();
  tokens = new Map<string, TokenRow>();

  readonly session = {
    update: async ({ where, data }: { where: { id: string }; data: Partial<SessionRow> }) => {
      const row = this.sessions.get(where.id);
      if (!row) throw new Error(`no session ${where.id}`);
      Object.assign(row, data);
      return row;
    },
  };

  readonly refreshToken = {
    findUnique: async ({ where }: { where: { tokenHash: string } }) => {
      for (const token of this.tokens.values()) {
        if (token.tokenHash === where.tokenHash) {
          return { ...token, session: this.sessions.get(token.sessionId) ?? null };
        }
      }
      return null;
    },
    update: async ({ where, data }: { where: { id: string }; data: Partial<TokenRow> }) => {
      const row = this.tokens.get(where.id);
      if (!row) throw new Error(`no token ${where.id}`);
      Object.assign(row, data);
      return row;
    },
    create: async ({ data }: { data: TokenRow }) => {
      this.tokens.set(data.id, { ...data });
      return data;
    },
  };

  async $transaction<T>(work: (client: PrismaFake) => Promise<T>): Promise<T> {
    return work(this);
  }
}

class StubClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return new Date(this.current);
  }
  advanceSeconds(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1_000);
  }
}

/** Hashing is deterministic and identity-shaped here; its real form is SHA-256. */
const stubTokens = {
  hashRefreshToken: (raw: string) => `hash:${raw}`,
  generateRefreshToken: () => 'successor',
  signAccessToken: () => 'access.jwt.value',
} as unknown as TokenService;

type SessionState = 'active' | 'revoked' | 'expired';
type TokenState = 'unconsumed' | 'consumedInsideGrace' | 'consumedOutsideGrace';

function buildScenario(sessionState: SessionState, tokenState: TokenState) {
  const prisma = new PrismaFake();
  const clock = new StubClock(NOW);

  prisma.sessions.set('session-1', {
    id: 'session-1',
    userId: 'user-1',
    expiresAt:
      sessionState === 'expired'
        ? new Date(NOW.getTime() - 1_000)
        : new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1_000),
    revokedAt: sessionState === 'revoked' ? new Date(NOW.getTime() - 60_000) : null,
    revokedReason: sessionState === 'revoked' ? 'LOGOUT_ALL' : null,
    lastUsedAt: new Date(NOW.getTime() - 60_000),
  });

  const consumedAt =
    tokenState === 'unconsumed'
      ? null
      : tokenState === 'consumedInsideGrace'
        ? new Date(NOW.getTime() - (GRACE_SECONDS - 5) * 1_000)
        : new Date(NOW.getTime() - (GRACE_SECONDS + 1) * 1_000);

  prisma.tokens.set('token-1', {
    id: 'token-1',
    sessionId: 'session-1',
    tokenHash: 'hash:presented',
    expiresAt: new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1_000),
    consumedAt,
    createdAt: new Date(NOW.getTime() - 15 * 60 * 1_000),
  });

  const service = new AuthService(
    prisma as unknown as PrismaService,
    clock,
    stubTokens,
    { refreshGraceSeconds: GRACE_SECONDS },
  );

  return { prisma, clock, service, consumedAt };
}

const rotate = (service: AuthService) =>
  service.refresh('presented', { ip: '203.0.113.10', userAgent: 'jest' });

describe('AuthService.refresh — the § 5 decision procedure', () => {
  it('rejects a token that hashes to nothing', async () => {
    const { service } = buildScenario('active', 'unconsumed');

    // Step 1.
    await expect(service.refresh('never-issued', { ip: null, userAgent: null })).rejects.toThrow(
      expect.objectContaining({ code: 'REFRESH_TOKEN_INVALID' }),
    );
  });

  describe.each<SessionState>(['revoked', 'expired'])('against a %s session', (sessionState) => {
    it.each<TokenState>([
      'unconsumed',
      'consumedInsideGrace',
      'consumedOutsideGrace',
    ])('answers SESSION_EXPIRED for a %s token', async (tokenState) => {
      const { service, prisma } = buildScenario(sessionState, tokenState);

      // Step 2 runs before steps 3–5, so a refresh after logout-all is never
      // reported as theft — and an already-dead session is not re-revoked with
      // a misleading reason.
      await expect(rotate(service)).rejects.toThrow(
        expect.objectContaining({ code: 'SESSION_EXPIRED' }),
      );

      const session = prisma.sessions.get('session-1');
      if (sessionState === 'revoked') expect(session?.revokedReason).toBe('LOGOUT_ALL');
      expect(prisma.tokens.size).toBe(1); // no successor was minted
    });
  });

  describe('against an active session', () => {
    it('rotates an unconsumed token and issues a successor', async () => {
      const { service, prisma, clock } = buildScenario('active', 'unconsumed');

      // Step 5.
      const result = await rotate(service);
      expect(result.accessToken).toBe('access.jwt.value');

      const presented = prisma.tokens.get('token-1');
      expect(presented?.consumedAt).toEqual(clock.now());
      expect(prisma.tokens.size).toBe(2);

      const successor = [...prisma.tokens.values()].find((token) => token.id !== 'token-1');
      expect(successor?.sessionId).toBe('session-1');
      // The successor inherits the session's expiry verbatim (US-4.6).
      expect(successor?.expiresAt).toEqual(prisma.sessions.get('session-1')?.expiresAt);

      expect(prisma.sessions.get('session-1')?.lastUsedAt).toEqual(clock.now());
      expect(prisma.sessions.get('session-1')?.revokedAt).toBeNull();
    });

    it('rotates again inside the grace window without moving consumedAt', async () => {
      const { service, prisma, consumedAt } = buildScenario('active', 'consumedInsideGrace');

      // Step 3 — two tabs refreshing simultaneously both succeed (US-4.3).
      await expect(rotate(service)).resolves.toEqual(
        expect.objectContaining({ accessToken: 'access.jwt.value' }),
      );

      // US-4.5 — grace is measured from the *first* use and is never extended,
      // so a token cannot be kept alive by polling it every 9 seconds.
      expect(prisma.tokens.get('token-1')?.consumedAt).toEqual(consumedAt);
      expect(prisma.tokens.size).toBe(2);

      // The device is not replaced, which is what keeps `sid` stable.
      expect(prisma.sessions.size).toBe(1);
      expect(prisma.sessions.get('session-1')?.revokedAt).toBeNull();
    });

    it('revokes the session when a token is reused past the grace window', async () => {
      const { service, prisma, clock } = buildScenario('active', 'consumedOutsideGrace');

      // Step 4 — the detection signal for a stolen token (US-4.4).
      await expect(rotate(service)).rejects.toThrow(
        expect.objectContaining({ code: 'REFRESH_TOKEN_REUSED' }),
      );

      const session = prisma.sessions.get('session-1');
      expect(session?.revokedAt).toEqual(clock.now());
      expect(session?.revokedReason).toBe('REUSE_DETECTED');

      // Revoking the session kills every token in it; there is no per-token
      // revocation flag to keep in step, and no successor is issued.
      expect(prisma.tokens.size).toBe(1);
    });

    it('treats the grace boundary as inclusive', async () => {
      const { service, prisma } = buildScenario('active', 'unconsumed');

      await rotate(service);
      const consumedAt = prisma.tokens.get('token-1')?.consumedAt;

      // `now - consumedAt <= REFRESH_GRACE_SECONDS` (§ 5, step 3): exactly at
      // the boundary is still a grace rotation, not theft.
      const { service: boundary, prisma: boundaryPrisma } = buildScenario('active', 'unconsumed');
      boundaryPrisma.tokens.get('token-1')!.consumedAt = new Date(
        NOW.getTime() - GRACE_SECONDS * 1_000,
      );

      await expect(rotate(boundary)).resolves.toBeDefined();
      expect(consumedAt).toEqual(NOW);
    });
  });

  it('raises the documented errors as AppException, so the filter maps them', async () => {
    const { service } = buildScenario('active', 'consumedOutsideGrace');

    await expect(rotate(service)).rejects.toBeInstanceOf(AppException);
  });
});
