import { checkUsername } from '@typing-game/contracts';
import { NextResponse, type NextRequest } from 'next/server';

import { apiFetch } from '@/lib/api-fetch';

/**
 * The BFF seam for the register form's debounced availability check. The
 * mixed-script detail is computed here rather than fetched: the API answers with
 * a reason, and naming *which* two scripts collided is a presentation concern
 * the shared contracts package can settle without a round trip.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const username = request.nextUrl.searchParams.get('username') ?? '';

  const local = checkUsername(username);
  if (!local.ok && local.reason === 'MIXED_SCRIPT') {
    return NextResponse.json({ available: false, reason: 'MIXED_SCRIPT', scripts: local.scripts });
  }

  const result = await apiFetch(
    `/users/username-available?username=${encodeURIComponent(username)}`,
  );

  if (!result.ok) return NextResponse.json({ available: true, reason: null });
  return NextResponse.json(result.data);
}
