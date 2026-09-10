import type { Session, User, UserSettings } from '@prisma/client';
import type { DeviceSession, Settings, UserProfile } from '@typing-game/contracts';

/**
 * ISO-8601 with `Z`, always. The API never formats or localises a date
 * (CLAUDE.md § Data).
 */
const iso = (value: Date | null): string | null => value?.toISOString() ?? null;

/** Only the eight preference columns; never `userId` or `updatedAt`. */
export function toSettings(settings: UserSettings | null): Settings {
  return {
    caretStyle: settings?.caretStyle ?? 'SMOOTH',
    soundEnabled: settings?.soundEnabled ?? false,
    theme: settings?.theme ?? 'SYSTEM',
    defaultDuration: (settings?.defaultDuration ?? 30) as Settings['defaultDuration'],
    defaultMode: settings?.defaultMode ?? 'TIME',
    language: settings?.language ?? 'en',
    blindMode: settings?.blindMode ?? false,
    stopOnError: settings?.stopOnError ?? false,
  };
}

/** No `stats` key — aggregates are `GET /users/me/stats`, owned by spec 003 (Q15). */
export function toProfile(user: User, settings: UserSettings | null): UserProfile {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    createdAt: user.createdAt.toISOString(),
    lastLoginAt: iso(user.lastLoginAt),
    passwordChangedAt: iso(user.passwordChangedAt),
    settings: toSettings(settings),
  };
}

export function toAuthUser(user: User): {
  id: string;
  email: string;
  username: string;
  createdAt: string;
} {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    createdAt: user.createdAt.toISOString(),
  };
}

/** One row per device. Never token material, never a raw IP. */
export function toDeviceSession(session: Session, currentSessionId: string): DeviceSession {
  return {
    id: session.id,
    current: session.id === currentSessionId,
    userAgent: session.userAgent,
    createdAt: session.createdAt.toISOString(),
    lastUsedAt: session.lastUsedAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
  };
}
