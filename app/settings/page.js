"use client";

import { useState } from "react";
import { toast } from "react-hot-toast";
import { createAuthClient } from "better-auth/react";

const authClient = createAuthClient();

export default function SettingsPage() {
  const { data: session } = authClient.useSession();
  const initialEmail = session?.user?.email || "";
  const [email, setEmail] = useState(initialEmail);
  const [passwords, setPasswords] = useState({ current: "", next: "", confirm: "" });
  const [busy, setBusy] = useState(false);

  function handleEmailSubmit(event) {
    event.preventDefault();
    setBusy(true);
    toast("Email updates will be available soon.");
    setBusy(false);
  }

  function handlePasswordSubmit(event) {
    event.preventDefault();
    setBusy(true);
    toast("Password updates will be available soon.");
    setBusy(false);
  }

  async function handleSignOut() {
    try {
      await authClient.signOut();
    } catch (err) {
      console.error(err);
      toast.error("Failed to sign out");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Account settings</h1>
        <p className="mt-1 text-sm text-[color:var(--color-text-secondary)]">
          Update your account details or sign out. More controls are coming soon.
        </p>
      </header>

      <section className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-strong)] p-5">
        <h2 className="text-lg font-semibold">Email</h2>
        <p className="mt-1 text-xs text-[color:var(--color-text-secondary)]">Keep your contact email up to date.</p>
        <form onSubmit={handleEmailSubmit} className="mt-4 flex flex-col gap-3 sm:max-w-md">
          <label className="text-xs text-[color:var(--color-text-secondary)]" htmlFor="settings-email">
            Email address
          </label>
          <input
            id="settings-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="h-10 w-full rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent)] focus:ring-offset-2 focus:ring-offset-[color:var(--color-background)]"
            placeholder="you@example.com"
          />
          <button
            type="submit"
            disabled={busy}
            className={`inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--color-background)] ${
              busy
                ? "bg-[color:var(--color-accent)]/60 text-[color:var(--color-accent-contrast)]/80"
                : "bg-[color:var(--color-accent)] text-[color:var(--color-accent-contrast)]"
            }`}
          >
            Save email
          </button>
        </form>
      </section>

      <section className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-strong)] p-5">
        <h2 className="text-lg font-semibold">Password</h2>
        <p className="mt-1 text-xs text-[color:var(--color-text-secondary)]">Change your password to keep your account secure.</p>
        <form onSubmit={handlePasswordSubmit} className="mt-4 flex flex-col gap-3 sm:max-w-md">
          <label className="text-xs text-[color:var(--color-text-secondary)]" htmlFor="current-password">
            Current password
          </label>
          <input
            id="current-password"
            type="password"
            value={passwords.current}
            onChange={(event) => setPasswords((prev) => ({ ...prev, current: event.target.value }))}
            className="h-10 w-full rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent)] focus:ring-offset-2 focus:ring-offset-[color:var(--color-background)]"
            placeholder="••••••••"
          />
          <label className="text-xs text-[color:var(--color-text-secondary)]" htmlFor="new-password">
            New password
          </label>
          <input
            id="new-password"
            type="password"
            value={passwords.next}
            onChange={(event) => setPasswords((prev) => ({ ...prev, next: event.target.value }))}
            className="h-10 w-full rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent)] focus:ring-offset-2 focus:ring-offset-[color:var(--color-background)]"
            placeholder="••••••••"
          />
          <label className="text-xs text-[color:var(--color-text-secondary)]" htmlFor="confirm-password">
            Confirm new password
          </label>
          <input
            id="confirm-password"
            type="password"
            value={passwords.confirm}
            onChange={(event) => setPasswords((prev) => ({ ...prev, confirm: event.target.value }))}
            className="h-10 w-full rounded-lg border border-[color:var(--color-border)] bg-[color:var(--color-surface)] px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[color:var(--color-accent)] focus:ring-offset-2 focus:ring-offset-[color:var(--color-background)]"
            placeholder="••••••••"
          />
          <button
            type="submit"
            disabled={busy}
            className={`inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--color-background)] ${
              busy
                ? "bg-[color:var(--color-accent)]/60 text-[color:var(--color-accent-contrast)]/80"
                : "bg-[color:var(--color-accent)] text-[color:var(--color-accent-contrast)]"
            }`}
          >
            Save password
          </button>
        </form>
      </section>

      <section className="rounded-2xl border border-amber-200/60 bg-amber-200/10 p-5 text-sm text-amber-900 dark:border-amber-200/20 dark:bg-amber-200/5 dark:text-amber-200/80">
        <h2 className="text-lg font-semibold">Sign out</h2>
        <p className="mt-1 text-xs">
          Leaving? Sign out of VintedBoost on this device.
        </p>
        <button
          type="button"
          onClick={handleSignOut}
          className="mt-4 inline-flex h-10 items-center justify-center rounded-lg border border-amber-500 px-4 text-sm font-semibold text-amber-900 transition hover:bg-amber-500/10 dark:border-amber-200/40 dark:text-amber-200"
        >
          Sign out
        </button>
      </section>
    </div>
  );
}
