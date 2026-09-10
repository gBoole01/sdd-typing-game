'use server';

import {
  changePasswordSchema,
  deleteAccountSchema,
  updateProfileSchema,
  updateSettingsSchema,
  type UpdateSettings,
} from '@typing-game/contracts';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { type ActionState, failure, validationFailure } from '@/lib/action-state';
import { apiFetch } from '@/lib/api-fetch';
import { WEB_COOKIE } from '@/lib/cookies';

/** Spec 001 § 6 *Server Actions*, the `(account)` half. */

async function clearSessionCookies(): Promise<void> {
  const jar = await cookies();
  jar.delete(WEB_COOKIE.access);
  jar.delete(WEB_COOKIE.refresh);
}

export async function logoutAction(): Promise<never> {
  // Idempotent by contract: 204 even with no session, so a client holding a
  // stale token can always reach a clean state (US-5.1).
  await apiFetch('/auth/logout', { method: 'POST', refreshOnExpiry: true });
  await clearSessionCookies();

  revalidatePath('/', 'layout');
  redirect('/');
}

export async function logoutAllAction(): Promise<ActionState> {
  const result = await apiFetch('/auth/logout-all', { method: 'POST', refreshOnExpiry: true });
  if (!result.ok) return failure(result.code, result.message, result.details);

  await clearSessionCookies();
  redirect('/login');
}

export async function revokeSessionAction(sessionId: string): Promise<ActionState> {
  const result = await apiFetch(`/users/me/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    refreshOnExpiry: true,
  });

  if (!result.ok) return failure(result.code, result.message, result.details);

  revalidatePath('/account/security');
  return { ok: true };
}

export async function updateProfileAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = updateProfileSchema.safeParse({ username: formData.get('username') });
  if (!parsed.success) return validationFailure(parsed.error);

  const result = await apiFetch('/users/me', {
    method: 'PATCH',
    body: JSON.stringify(parsed.data),
    refreshOnExpiry: true,
  });

  if (!result.ok) return failure(result.code, result.message, result.details);

  revalidatePath('/account');
  return { ok: true };
}

export async function changePasswordAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get('currentPassword'),
    newPassword: formData.get('newPassword'),
  });

  if (!parsed.success) return validationFailure(parsed.error);

  const result = await apiFetch('/users/me/password', {
    method: 'PATCH',
    body: JSON.stringify(parsed.data),
    refreshOnExpiry: true,
  });

  if (!result.ok) return failure(result.code, result.message, result.details);

  // US-7.5 — the caller's own session survives, so there is nothing to clear.
  revalidatePath('/account/security');
  return { ok: true };
}

export async function updateSettingsAction(settings: UpdateSettings): Promise<ActionState> {
  const parsed = updateSettingsSchema.safeParse(settings);
  if (!parsed.success) return validationFailure(parsed.error);

  const result = await apiFetch('/users/me/settings', {
    method: 'PATCH',
    body: JSON.stringify(parsed.data),
    refreshOnExpiry: true,
  });

  if (!result.ok) return failure(result.code, result.message, result.details);

  revalidatePath('/account/settings');
  return { ok: true };
}

export async function deleteAccountAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = deleteAccountSchema.safeParse({
    password: formData.get('password'),
    confirm: formData.get('confirm'),
    // US-8.4 — a checkbox posts a string; the API schema wants a boolean.
    deleteResults: formData.get('deleteResults') === 'true',
  });

  if (!parsed.success) return validationFailure(parsed.error);

  const result = await apiFetch('/users/me', {
    method: 'DELETE',
    body: JSON.stringify(parsed.data),
    refreshOnExpiry: true,
  });

  if (!result.ok) return failure(result.code, result.message, result.details);

  await clearSessionCookies();
  redirect('/?deleted=1');
}
