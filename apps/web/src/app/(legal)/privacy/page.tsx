import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Privacy · Typing Game' };

export default function PrivacyPage(): React.ReactElement {
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold tracking-display text-content">Privacy notice</h1>
      <p className="mb-4">
        We store your email address, your username and the results of the tests you take. Your
        password is never stored — only an Argon2id hash of it.
      </p>

      <h2 className="mb-2 mt-8 text-xl font-semibold text-content">Playing without an account</h2>
      {/* Q2 — the guest cookie is treated as strictly necessary and disclosed here. */}
      <p className="mb-4">
        If you play without signing up, we set a cookie called <code>tgw_guest</code> so your results
        stay attached to your browser for 90 days. It is strictly necessary for that purpose, it is
        never used for analytics or advertising, and creating an account moves those results to it.
      </p>

      <h2 className="mb-2 mt-8 text-xl font-semibold text-content">Sessions and addresses</h2>
      <p className="mb-4">
        Signing in records the device description your browser sends and a one-way hash of your IP
        address, so you can review and revoke your active devices. Raw IP addresses are never stored.
      </p>

      <h2 className="mb-2 mt-8 text-xl font-semibold text-content">Deleting your account</h2>
      <p className="mb-4">
        Deleting your account removes your profile, sessions and settings. Your past results are kept
        without your name attached so leaderboards stay accurate, unless you ask for them to be
        deleted too.
      </p>
    </>
  );
}
