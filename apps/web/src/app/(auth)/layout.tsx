import type { ReactNode } from 'react';

/**
 * Centred narrow card. **No session read and no redirect** — that would make
 * every page in the group dynamic and would also fire on `/forgot-password` and
 * `/reset-password`, which a signed-in user is entitled to visit. `proxy.ts`
 * owns the redirect (Q17).
 */
export default function AuthLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <main className="glow-heading mx-auto w-full max-w-md px-[var(--gutter)] py-16">
      <div className="rounded-md bg-surface-card p-8 shadow-card">{children}</div>
    </main>
  );
}
