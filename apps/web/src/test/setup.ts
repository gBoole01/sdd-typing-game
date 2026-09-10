import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, vi } from 'vitest';

import { server } from './msw';

/**
 * React Testing Library detects *Jest's* fake timers only: `waitFor` checks for
 * a global `jest` and then advances through it. Under Vitest's fake timers it
 * would instead poll on a real interval that a frozen clock never fires, so any
 * assertion made after `vi.useFakeTimers()` hangs until the test times out.
 *
 * Bridging the one method it calls is enough, and keeps the timer control in
 * `vi` where the tests expect it.
 */
Object.defineProperty(globalThis, 'jest', {
  value: { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) },
  writable: true,
  configurable: true,
});

/**
 * Spec 001 § 9 "Frontend — Vitest + React Testing Library, API mocked with MSW".
 *
 * The NestJS API is mocked at the network boundary rather than by stubbing the
 * fetchers, so `lib/api-fetch.ts` and `proxy.ts` are exercised as written —
 * cookie translation included, which is where the § 5 defects lived.
 */
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));

afterEach(() => {
  server.resetHandlers();
  cleanup();
  vi.useRealTimers();
});

afterAll(() => server.close());
