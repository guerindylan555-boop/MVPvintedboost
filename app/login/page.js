"use client";
import { useCallback } from "react";

export default function LoginPage() {
  const onGoogle = useCallback(() => {
    // Better Auth's sign-in/social expects POST; submit a form to navigate
    const form = document.createElement("form");
    form.method = "POST";
    form.action = "/api/auth/sign-in/social";
    const provider = document.createElement("input");
    provider.type = "hidden";
    provider.name = "provider";
    provider.value = "google";
    form.appendChild(provider);
    const cb = document.createElement("input");
    cb.type = "hidden";
    cb.name = "callbackURL";
    cb.value = "/studio";
    form.appendChild(cb);
    document.body.appendChild(form);
    form.submit();
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
