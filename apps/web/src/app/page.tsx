import type { ReactNode } from 'react';

/**
 * Placeholder shell. The product surface arrives with spec 001 § 6; spec 002
 * needs an app here only so `web.Dockerfile` has something to build.
 */
export default function HomePage(): ReactNode {
  return (
    <main className="mx-auto max-w-2xl p-8 font-mono">
      <h1 className="text-2xl font-semibold">Typing Game</h1>
      <p className="mt-2 text-sm opacity-70">Infrastructure is up. The game arrives with spec 001.</p>
    </main>
  );
}
