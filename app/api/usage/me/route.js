import { auth } from "@/app/lib/auth";
import { getSessionBasics } from "@/app/lib/session";
import { getApiBase, withUserId } from "@/app/lib/api";

async function proxyUsage(userId) {
  const baseUrl = getApiBase();
  const headers = withUserId({}, userId);

  const upstreams = [
    `${baseUrl}/usage/me`,
    `${baseUrl}/billing/usage`,
  ];

  for (const url of upstreams) {
    try {
      const res = await fetch(url, { method: "GET", headers, cache: "no-store" });
      if (res.status === 404 && url.endsWith("/usage/me")) {
        // try next fallback endpoint
        continue;
      }
      const text = await res.text();
      const responseHeaders = new Headers();
      responseHeaders.set("content-type", res.headers.get("content-type") || "application/json");
      return new Response(text, { status: res.status, headers: responseHeaders });
    } catch (error) {
      // try next fallback endpoint
      continue;
    }
  }

  return new Response(JSON.stringify({ error: "usage upstream unavailable" }), {
    status: 502,
    headers: { "content-type": "application/json" },
  });
}

export async function GET(request) {
  const session = await auth.api.getSession({ headers: request.headers });
  const { userId } = getSessionBasics(session);
  if (!userId) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  return proxyUsage(userId);
}
