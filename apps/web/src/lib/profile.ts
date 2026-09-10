import 'server-only';

import type { UserProfile } from '@typing-game/contracts';
import { cache } from 'react';

import { apiFetch } from './api-fetch';

/**
 * `GET /users/me` once per render for the whole `(account)` group — the layout
 * fetches it and the child pages read it, rather than each re-fetching (§ 6).
 */
export const getProfile = cache(async (): Promise<UserProfile | null> => {
  const result = await apiFetch<UserProfile>('/users/me');
  return result.ok ? result.data : null;
});
