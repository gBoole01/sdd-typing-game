import type { Session, User, UserSettings } from '@prisma/client';

/**
 * Resolved by `JwtAuthGuard` in one query and read by every protected handler.
 * The matching `Express.Request` augmentation lives in `src/types/express.d.ts`.
 */
export interface AuthContext {
  user: User;
  session: Session;
  settings: UserSettings | null;
}
