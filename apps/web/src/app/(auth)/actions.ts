'use server';

import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from '@typing-game/contracts';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { type ActionState, failure, safeNext, validationFailure } from '@/lib/action-state';
import { apiFetch } from '@/lib/api-fetch';
import { WEB_COOKIE } from '@/lib/cookies';

/**
 * Spec 001 § 6. Every action here may write cookies — that is what a Server
 * Action is for — so `refreshOnExpiry` is set and `apiFetch` translates the
 * API's `tg_*` response cookies onto the web origin as `tgw_*`.
 */

export async function loginAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  if (!parsed.success) return validationFailure(parsed.error);

  const result = await apiFetch('/auth/login', {
    method: 'POST',
    body: JSON.stringify(parsed.data),
    refreshOnExpiry: true,
  });

  if (!result.ok) return failure(result.code, result.message, result.details);

  redirect(safeNext(formData.get('next')) ?? '/account');
}

export async function registerAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const consent = formData.get('acceptedTerms');

  const parsed = registerSchema.safeParse({
    email: formData.get('email'),
    username: formData.get('username'),
    password: formData.get('password'),
    // A checkbox posts "on"; anything else is absence, and absence is not consent.
    acceptedTerms: consent === 'on' || consent === 'true' ? true : undefined,
  });

  if (!parsed.success) return validationFailure(parsed.error);

  const jar = await cookies();
  const guestId = jar.get(WEB_COOKIE.guest)?.value ?? null;

  const result = await apiFetch('/auth/register', {
    method: 'POST',
    body: JSON.stringify(parsed.data),
    refreshOnExpiry: true,
    guestId,
  });

  if (!result.ok) return failure(result.code, result.message, result.details);

  // US-2.5 — the guest cookie is spent; the account cookies replace it.
  if (guestId) jar.delete(WEB_COOKIE.guest);

  redirect('/account');
}

export async function forgotPasswordAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get('email') });
  if (!parsed.success) return validationFailure(parsed.error);

  const result = await apiFetch('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify(parsed.data),
  });

  if (!result.ok) return failure(result.code, result.message, result.details);

  // US-6.1 — the state carries nothing that could differ between a known and an
  // unknown address, because the UI must never branch on existence.
  return { ok: true };
}

export async function resetPasswordAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = resetPasswordSchema.safeParse({
    token: formData.get('token'),
    password: formData.get('password'),
  });

  if (!parsed.success) return validationFailure(parsed.error);

  const result = await apiFetch('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify(parsed.data),
    refreshOnExpiry: true,
  });

  if (!result.ok) return failure(result.code, result.message, result.details);

  // US-6.6 — signed in already; a forced login adds friction, not security.
  redirect('/account');
}
