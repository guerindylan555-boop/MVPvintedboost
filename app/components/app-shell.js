"use client";

import { Toaster } from "react-hot-toast";
import TopNav from "./top-nav";

export default function AppShell({ children }) {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <TopNav />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-10 pt-6">
        {children}
      </main>
      <Toaster position="top-center" toastOptions={{ duration: 4000 }} />
    </div>
  );
}
