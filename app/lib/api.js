export function getApiBase() {
  return process.env.NEXT_PUBLIC_API_BASE_URL || "http://localhost:8000";
}

export function withUserId(headers = {}, userId) {
  const h = new Headers(headers);
  if (userId) h.set("X-User-Id", String(userId));
  return h;
}

