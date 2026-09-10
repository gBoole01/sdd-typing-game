import { vi } from 'vitest';

/**
 * Stand-ins for the three Next.js server APIs spec 001 § 6 turns on: the cookie
 * jar, the request headers, and `redirect()`.
 *
 * `cookies()` and `headers()` are async in Next 16, and `redirect()` throws
 * rather than returning — both are load-bearing here, because "a Server
 * Component may not write a cookie" (Q7) is the rule the whole refresh design
 * rests on.
 */

export interface RecordedCookie {
  name: string;
  value: string;
  options: Record<string, unknown>;
}

export interface FakeCookieStore {
  get(name: string): { name: string; value: string } | undefined;
  set(name: string, value: string, options?: Record<string, unknown>): void;
  delete(name: string): void;
  getAll(): Array<{ name: string; value: string }>;
  /** Every write, in order, so a test can assert attributes and not just presence. */
  readonly writes: RecordedCookie[];
  readonly deletes: string[];
}

export function fakeCookies(initial: Record<string, string> = {}): FakeCookieStore {
  const jar = new Map(Object.entries(initial));
  const writes: RecordedCookie[] = [];
  const deletes: string[] = [];

  return {
    get: (name) => (jar.has(name) ? { name, value: jar.get(name) as string } : undefined),
    set: (name, value, options = {}) => {
      jar.set(name, value);
      writes.push({ name, value, options });
    },
    delete: (name) => {
      jar.delete(name);
      deletes.push(name);
    },
    getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
    writes,
    deletes,
  };
}

export function fakeHeaders(initial: Record<string, string> = {}): Headers {
  return new Headers(initial);
}

/** `redirect()` throws in Next; tests assert on the thrown target. */
export class RedirectError extends Error {
  constructor(readonly target: string) {
    super(`NEXT_REDIRECT:${target}`);
    this.name = 'RedirectError';
  }
}

export const redirectMock = vi.fn((target: string): never => {
  throw new RedirectError(target);
});

export async function captureRedirect(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof RedirectError) return error.target;
    throw error;
  }

  throw new Error('expected a redirect, but the call returned normally');
}
