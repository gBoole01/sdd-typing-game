import type { Session, User, UserSettings } from '@prisma/client';

/**
 * Ambient so every file sees it, rather than only the ones that happen to
 * import the module that declares it.
 */
declare global {
  namespace Express {
    interface Request {
      /** The address every per-IP limit is keyed on (spec 001 § 8). */
      clientIp: string;
      /** Resolved by `JwtAuthGuard` in one query on `sid`. */
      auth?: {
        user: User;
        session: Session;
        settings: UserSettings | null;
      };
    }
  }
}

export {};
