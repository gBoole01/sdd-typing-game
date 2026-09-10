import type { Metadata } from 'next';

import { RegisterForm } from '@/features/auth/register-form';

export const metadata: Metadata = { title: 'Create an account · Typing Game' };
/** Dynamic only because of the guest-results banner (§ 6). */
export const dynamic = 'force-dynamic';

export default function RegisterPage(): React.ReactElement {
  // US-2.5's banner needs a count of the guest session's results, and spec 001
  // § 5 defines no endpoint that returns one — spec 003 owns result reads. The
  // form renders the banner whenever the count is above zero; until then it is
  // correctly hidden rather than guessed at.
  return (
    <>
      <h1 className="text-xl font-bold tracking-display">Create an account</h1>
      <RegisterForm guestResultCount={0} />
    </>
  );
}
