import type { Metadata } from 'next';

import { LoginForm } from '@/features/auth/login-form';
import { safeNext } from '@/lib/action-state';

export const metadata: Metadata = { title: 'Log in · Typing Game' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const params = await searchParams;
  const next = safeNext(typeof params.next === 'string' ? params.next : null);

  return (
    <>
      <h1 className="text-xl font-bold tracking-display">Log in</h1>
      <LoginForm next={next ?? undefined} />
    </>
  );
}
