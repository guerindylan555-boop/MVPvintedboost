"use client";

import { Loader2 } from "lucide-react";

export function AdminToolsCard({ busy, onInitDb }) {
  const buttonClasses = busy
    ? "bg-[color:var(--color-accent)]/60 text-[color:var(--color-accent-contrast)]/80"
    : "bg-[color:var(--color-accent)] text-[color:var(--color-accent-contrast)]";

  return (
    <div className="rounded-2xl border border-[color:var(--color-border)] bg-[color:var(--color-surface-strong)] p-4 text-sm">
      <h2 className="text-sm font-semibold">Admin tools</h2>
      <button
        type="button"
        onClick={onInitDb}
        disabled={busy}
        className={`mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--color-background)] ${buttonClasses}`}
      >
        {busy ? (
          <>
            <Loader2 className="size-3 animate-spin" />
            Initializing…
          </>
        ) : (
          <>Init DB</>
        )}
      </button>
    </div>
  );
}
