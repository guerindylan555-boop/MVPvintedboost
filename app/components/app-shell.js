"use client";

import { Toaster } from "react-hot-toast";
import TopNav from "./top-nav";

export default function AppShell({ children }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[var(--color-background)] text-[var(--color-foreground)]">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-1/2 top-[-20%] h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle_at_center,var(--color-accent)_0%,transparent_65%)] opacity-40 blur-3xl" />
        <div className="absolute inset-x-0 bottom-[-45%] mx-auto h-[620px] w-[620px] max-w-[90vw] rounded-full bg-[radial-gradient(circle_at_center,var(--color-accent-soft)_0%,transparent_70%)] opacity-60 blur-[160px]" />
      </div>
      <main className="relative z-10 mx-auto w-full max-w-5xl px-4 pb-28 pt-10">
        <div className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 shadow-[0_40px_120px_var(--color-border-strong)] backdrop-blur sm:p-10">
          {children}
        </div>
      </main>
      <TopNav />
      <Toaster
        position="top-center"
        toastOptions={{
          duration: 4000,
          style: {
            background: "var(--color-surface-strong)",
            color: "var(--color-foreground)",
            border: "1px solid var(--color-border)",
            boxShadow: "0 30px 70px var(--color-border-strong)",
          },
          success: {
            iconTheme: {
              primary: "var(--color-accent)",
              secondary: "var(--color-surface)",
            },
          },
        }}
      />
    </div>
  );
}
