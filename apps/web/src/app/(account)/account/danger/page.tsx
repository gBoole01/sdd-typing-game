import { DeleteAccountForm } from '@/features/account/delete-account-form';

export default function DangerPage(): React.ReactElement {
  return (
    <section className="rounded-md border border-line-accent bg-surface-card p-6">
      <h1 className="text-xl font-bold tracking-display">Delete your account</h1>
      <DeleteAccountForm />
    </section>
  );
}
