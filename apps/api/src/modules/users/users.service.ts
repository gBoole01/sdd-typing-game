import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  ChangePasswordInput,
  DeleteAccountInput,
  DeviceSessionList,
  Settings,
  UpdateProfileInput,
  UpdateSettings,
  UserProfile,
  UsernameAvailability,
} from '@typing-game/contracts';
import { checkUsername } from '@typing-game/contracts';

import type { AuthContext } from '../../common/auth/auth-context';
import { CLOCK, type Clock } from '../../common/clock/clock';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { CredentialsService } from '../auth/credentials.service';
import { PasswordService } from '../auth/password.service';
import { toDeviceSession, toProfile, toSettings } from './users.serializer';

const DAY_MS = 24 * 60 * 60 * 1_000;
/** US-7.3 — a username may change once every 30 days. */
const USERNAME_COOLDOWN_DAYS = 30;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly passwords: PasswordService,
    private readonly sessions: AuthService,
  ) {}

  profile(auth: AuthContext): UserProfile {
    // The guard already resolved user and settings in one query; re-reading here
    // would double the cost of every account page render.
    return toProfile(auth.user, auth.settings);
  }

  async updateProfile(auth: AuthContext, input: UpdateProfileInput): Promise<UserProfile> {
    if (input.username === undefined) return this.profile(auth);

    const normalized = CredentialsService.assertUsernameAvailableShape(input.username);
    const now = this.clock.now();
    const { usernameChangedAt } = auth.user;

    if (usernameChangedAt) {
      const retryAfter = new Date(usernameChangedAt.getTime() + USERNAME_COOLDOWN_DAYS * DAY_MS);

      if (now.getTime() < retryAfter.getTime()) {
        throw new AppException(
          'USERNAME_CHANGE_TOO_SOON',
          'You changed your username recently.',
          HttpStatus.TOO_MANY_REQUESTS,
          // `details[]` is the envelope's only structured slot, so `retryAfter`
          // rides in it as an ISO-8601 instant.
          [{ path: 'username', message: retryAfter.toISOString() }],
        );
      }
    }

    const taken = await this.prisma.user.findFirst({
      where: { usernameNormalized: normalized, id: { not: auth.user.id } },
      select: { id: true },
    });
    if (taken) throw CredentialsService.usernameTaken('TAKEN');

    const updated = await this.prisma.user.update({
      where: { id: auth.user.id },
      data: {
        username: input.username,
        usernameNormalized: normalized,
        usernameChangedAt: now,
      },
      include: { settings: true },
    });

    return toProfile(updated, updated.settings);
  }

  async changePassword(auth: AuthContext, input: ChangePasswordInput): Promise<void> {
    if (!(await this.passwords.verify(auth.user.passwordHash, input.currentPassword))) {
      throw CredentialsService.invalidCredentials();
    }

    // Q14 — this is the endpoint that keeps the check, because the caller has
    // already authenticated.
    if (await this.passwords.verify(auth.user.passwordHash, input.newPassword)) {
      throw new AppException(
        'PASSWORD_UNCHANGED',
        'The new password must differ from the current one.',
        HttpStatus.BAD_REQUEST,
        [{ path: 'newPassword', message: 'Must differ from the current password.' }],
      );
    }

    const passwordHash = await this.passwords.hash(input.newPassword);
    const now = this.clock.now();

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: auth.user.id },
        data: { passwordHash, passwordChangedAt: now },
      });

      // US-7.5 — every session but the caller's own, unambiguous now that a
      // session is a device.
      await this.sessions.revokeAllSessions(
        tx,
        auth.user.id,
        'PASSWORD_CHANGE',
        auth.session.id,
      );
    });
  }

  async updateSettings(auth: AuthContext, input: UpdateSettings): Promise<Settings> {
    const updated = await this.prisma.userSettings.update({
      where: { userId: auth.user.id },
      data: input,
    });

    return toSettings(updated);
  }

  /**
   * Lists live sessions only, ordered `current` first then `lastUsedAt`
   * descending. Capped at SESSION_MAX_ACTIVE by US-3.5, so `pageInfo` is always
   * empty — stated in § 5 because a reader is otherwise entitled to expect a
   * working cursor.
   */
  async listSessions(auth: AuthContext): Promise<DeviceSessionList> {
    const sessions = await this.prisma.session.findMany({
      where: {
        userId: auth.user.id,
        revokedAt: null,
        expiresAt: { gt: this.clock.now() },
      },
      orderBy: { lastUsedAt: 'desc' },
    });

    const rows = sessions.map((session) => toDeviceSession(session, auth.session.id));
    rows.sort((a, b) => Number(b.current) - Number(a.current));

    return { data: rows, pageInfo: { nextCursor: null, hasNextPage: false } };
  }

  /** US-5.4 — an unknown id, another user's id and an already-revoked one are one answer. */
  async revokeSession(auth: AuthContext, sessionId: string): Promise<{ wasCurrent: boolean }> {
    const session = await this.prisma.session.findFirst({
      where: { id: sessionId, userId: auth.user.id, revokedAt: null },
      select: { id: true },
    });

    if (!session) {
      throw new AppException(
        'SESSION_NOT_FOUND',
        'That session does not exist.',
        HttpStatus.NOT_FOUND,
      );
    }

    await this.prisma.$transaction((tx) =>
      this.sessions.revokeSession(tx, session.id, 'MANUAL_REVOKE'),
    );

    return { wasCurrent: session.id === auth.session.id };
  }

  async deleteAccount(auth: AuthContext, input: DeleteAccountInput): Promise<void> {
    if (!(await this.passwords.verify(auth.user.passwordHash, input.password))) {
      throw CredentialsService.invalidCredentials();
    }

    await this.prisma.$transaction(async (tx) => {
      // US-8.4 — deleted first, in the same transaction as the user row. Without
      // the checkbox, `onDelete: SetNull` anonymises them instead (US-8.3), so
      // leaderboard integrity survives.
      if (input.deleteResults) {
        await tx.testResult.deleteMany({ where: { userId: auth.user.id } });
      }

      await tx.user.delete({ where: { id: auth.user.id } });
    });
  }

  /** Rate-limited by design: it is the one endpoint that answers "does this exist". */
  async usernameAvailability(username: string): Promise<UsernameAvailability> {
    const result = checkUsername(username);

    if (!result.ok) return { available: false, reason: result.reason };

    const taken = await this.prisma.user.findUnique({
      where: { usernameNormalized: result.normalized },
      select: { id: true },
    });

    return taken ? { available: false, reason: 'TAKEN' } : { available: true, reason: null };
  }
}
