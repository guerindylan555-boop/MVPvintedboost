"use client";
import { useCallback } from "react";

export default function LoginPage() {
  const onGoogle = useCallback(() => {
    // Kick off Google OAuth via Better Auth
    const url = "/api/auth/sign-in/social?provider=google&callbackURL=/studio";
    window.location.assign(url);
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
