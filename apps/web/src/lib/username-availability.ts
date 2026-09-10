import type { UsernameAvailability } from '@typing-game/contracts';

export interface UsernameAvailabilityResult extends UsernameAvailability {
  /** Present on MIXED_SCRIPT so the form can name both scripts (§ 4). */
  scripts?: string[];
}

/**
 * Advisory only — the authoritative check is the 409 on submit (§ 6). Goes
 * through a BFF route handler, because the browser never calls NestJS directly.
 */
export async function checkUsernameAvailability(
  username: string,
  signal?: AbortSignal,
): Promise<UsernameAvailabilityResult> {
  const response = await fetch(
    `/api/username-available?username=${encodeURIComponent(username)}`,
    { signal },
  );

  if (!response.ok) return { available: true, reason: null };
  return (await response.json()) as UsernameAvailabilityResult;
}
