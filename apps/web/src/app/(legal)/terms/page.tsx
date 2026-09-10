import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Terms · Typing Game' };

/** Accepted at registration (US-2.7), which is why this page has to exist. */
export default function TermsPage(): React.ReactElement {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold tracking-display text-content">Terms of use</h1>
      <p className="mb-4">
        Typing Game measures how quickly and accurately you type. You may use it for personal,
        non-commercial purposes.
      </p>
      <h2 className="mb-2 mt-8 text-xl font-semibold text-content">Your account</h2>
      <p className="mb-4">
        You are responsible for keeping your password confidential. Choose a password you do not use
        anywhere else. You may delete your account at any time from the account settings.
      </p>
      <h2 className="mb-2 mt-8 text-xl font-semibold text-content">Fair play</h2>
      <p className="mb-4">
        Results submitted from automated input are removed from leaderboards. Results recorded
        without an account, or within the first minute of a new sign-in, are not ranked.
      </p>
    </>
  );
}
