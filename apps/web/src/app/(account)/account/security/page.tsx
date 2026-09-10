import type { DeviceSessionList } from '@typing-game/contracts';

import { PasswordForm } from '@/features/account/password-form';
import { SessionsList } from '@/features/account/sessions-list';
import { apiFetch } from '@/lib/api-fetch';
import { getProfile } from '@/lib/profile';

/** Two independent panels: both concern credentials, and both revoke sessions (§ 6). */
export default async function SecurityPage(): Promise<React.ReactElement> {
  const [profile, sessions] = await Promise.all([
    getProfile(),
    apiFetch<DeviceSessionList>('/users/me/sessions'),
  ]);

  return (
    <div className="grid gap-8">
      <section className="rounded-md bg-surface-card p-6">
        <h1 className="text-xl font-bold tracking-display">Change password</h1>
        <PasswordForm />
      </section>

      <section className="rounded-md bg-surface-card p-6">
        <SessionsList
          sessions={sessions.ok ? sessions.data.data : []}
          passwordChangedAt={profile?.passwordChangedAt ?? null}
        />
      </section>
    </div>
  );
}
