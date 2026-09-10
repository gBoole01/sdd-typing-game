import { SettingsForm } from '@/features/account/settings-form';
import { getProfile } from '@/lib/profile';

export default async function SettingsPage(): Promise<React.ReactElement> {
  const profile = await getProfile();
  if (!profile) return <p>Settings are unavailable right now.</p>;

  return (
    <section className="rounded-md bg-surface-card p-6">
      <h1 className="text-xl font-bold tracking-display">Typing preferences</h1>
      <SettingsForm settings={profile.settings} />
    </section>
  );
}
