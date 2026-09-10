import type { Metadata } from 'next';

import { ForgotPasswordForm } from '@/features/auth/forgot-password-form';

export const metadata: Metadata = { title: 'Reset your password · Typing Game' };

export default function ForgotPasswordPage(): React.ReactElement {
  return (
    <>
      <h1 className="text-xl font-bold tracking-display">Reset your password</h1>
      <ForgotPasswordForm />
    </>
  );
}
