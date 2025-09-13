"use client";
import { useCallback } from "react";
import { createAuthClient } from "better-auth/react";
const authClient = createAuthClient();

export default function LoginPage() {
  const onGoogle = useCallback(async () => {
    const { error } = await authClient.signIn.social({ provider: "google", callbackURL: "/studio" });
    if (error) alert(error.message || "Sign-in failed");
  }, []);

  return (
    <div className="p-6 max-w-sm mx-auto">
      <h1 className="text-xl font-semibold mb-4">Admin login</h1>
      <button
        onClick={onGoogle}
        className="w-full rounded bg-black text-white py-2"
      >
        Continue with Google
      </button>
    </div>
  );
}
