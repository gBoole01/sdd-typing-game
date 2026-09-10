import type { ReactNode } from 'react';

/** Prose container for `/terms` and `/privacy`. Fully static (§ 6). */
export default function LegalLayout({ children }: { children: ReactNode }): ReactNode {
  return (
    <main className="mx-auto w-full max-w-[var(--container-narrow)] px-[var(--gutter)] py-16">
      <div className="max-w-[var(--measure)] leading-normal text-content-secondary">{children}</div>
    </main>
  );
}
