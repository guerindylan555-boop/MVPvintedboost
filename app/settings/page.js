"use client";

import { useState } from "react";
import { toast } from "react-hot-toast";

import { authClient } from "@/app/lib/auth-client";

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
        <p className="mt-1 text-sm text-foreground/70">
          Update your account details or sign out. More controls are coming soon.
        </p>
      </header>

      <section className="rounded-2xl border border-black/10 bg-black/5 p-5 dark:border-white/15 dark:bg-white/5">
        <h2 className="text-lg font-semibold">Email</h2>
        <p className="mt-1 text-xs text-foreground/60">Keep your contact email up to date.</p>
        <form onSubmit={handleEmailSubmit} className="mt-4 flex flex-col gap-3 sm:max-w-md">
          <label className="text-xs text-foreground/70" htmlFor="settings-email">Email address</label>
          <input
            id="settings-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="h-10 w-full rounded-lg border border-foreground/15 bg-background/40 px-3 text-sm"
            placeholder="you@example.com"
          />
          <button
            type="submit"
            disabled={busy}
            className={`inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-semibold ${
              busy ? "bg-foreground/30 text-background/60" : "bg-foreground text-background"
            }`}
          >
            Save email
          </button>
        </form>
      </section>

      <section className="rounded-2xl border border-black/10 bg-black/5 p-5 dark:border-white/15 dark:bg-white/5">
        <h2 className="text-lg font-semibold">Password</h2>
        <p className="mt-1 text-xs text-foreground/60">Change your password to keep your account secure.</p>
        <form onSubmit={handlePasswordSubmit} className="mt-4 flex flex-col gap-3 sm:max-w-md">
          <label className="text-xs text-foreground/70" htmlFor="current-password">Current password</label>
          <input
            id="current-password"
            type="password"
            value={passwords.current}
            onChange={(event) => setPasswords((prev) => ({ ...prev, current: event.target.value }))}
            className="h-10 w-full rounded-lg border border-foreground/15 bg-background/40 px-3 text-sm"
            placeholder="••••••••"
          />
          <label className="text-xs text-foreground/70" htmlFor="new-password">New password</label>
          <input
            id="new-password"
            type="password"
            value={passwords.next}
            onChange={(event) => setPasswords((prev) => ({ ...prev, next: event.target.value }))}
            className="h-10 w-full rounded-lg border border-foreground/15 bg-background/40 px-3 text-sm"
            placeholder="••••••••"
          />
          <label className="text-xs text-foreground/70" htmlFor="confirm-password">Confirm new password</label>
          <input
            id="confirm-password"
            type="password"
            value={passwords.confirm}
            onChange={(event) => setPasswords((prev) => ({ ...prev, confirm: event.target.value }))}
            className="h-10 w-full rounded-lg border border-foreground/15 bg-background/40 px-3 text-sm"
            placeholder="••••••••"
          />
          <button
            type="submit"
            disabled={busy}
            className={`inline-flex h-10 items-center justify-center rounded-lg px-4 text-sm font-semibold ${
              busy ? "bg-foreground/30 text-background/60" : "bg-foreground text-background"
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
