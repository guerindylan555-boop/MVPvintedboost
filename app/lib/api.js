export function getApiBase() {
  return process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
}

export function withUserId(headers = {}, user, extras = {}) {
  const h = new Headers(headers);
  const payload =
    user && typeof user === "object" && !Array.isArray(user)
      ? user
      : { userId: user };
  const userId =
    payload.userId ?? payload.id ?? extras.userId ?? extras.id ?? payload.email;
  if (userId) h.set("X-User-Id", String(userId));
  const email = payload.email ?? extras.email;
  if (email) h.set("X-User-Email", String(email).toLowerCase());
  const isAdmin = payload.isAdmin ?? extras.isAdmin;
  if (isAdmin) h.set("X-User-Is-Admin", "true");
  return h;
}

