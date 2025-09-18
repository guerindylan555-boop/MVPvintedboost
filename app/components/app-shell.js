"use client";

import { Toaster } from "react-hot-toast";
import TopNav from "./top-nav";

export default function AppShell({ children }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <main className="mx-auto w-full max-w-5xl px-4 pb-28 pt-6">
        {children}
      </main>
      <TopNav />
      <Toaster position="top-center" toastOptions={{ duration: 4000 }} />
    </div>
  );
}
