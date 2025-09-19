"use client";

import { Loader2 } from "lucide-react";

export function AdminToolsCard({ busy, onInitDb }) {
  return (
    <div className="rounded-2xl border border-black/10 bg-black/5 p-4 text-sm dark:border-white/15 dark:bg-white/5">
      <h2 className="text-sm font-semibold">Admin tools</h2>
      <button
        type="button"
        onClick={onInitDb}
        disabled={busy}
        className={`mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold ${
          busy ? "opacity-60" : ""
        }`}
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
