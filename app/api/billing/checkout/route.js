import { auth } from "@/app/lib/auth";
import { getSessionBasics } from "@/app/lib/session";
import { getApiBase, withUserId } from "@/app/lib/api";

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

async function forwardToBackend({ userId, body }) {
  const baseUrl = getApiBase();
  const headers = withUserId({ "content-type": "application/json" }, userId);
  try {
    const res = await fetch(`${baseUrl}/billing/checkout`, {
      method: "POST",
      headers,
      body: JSON.stringify(body ?? {}),
      cache: "no-store",
    });
    const text = await res.text();
    const responseHeaders = new Headers();
    const contentType = res.headers.get("content-type") || "application/json";
    responseHeaders.set("content-type", contentType);
    return new Response(text, { status: res.status, headers: responseHeaders });
  } catch (error) {
    return new Response(JSON.stringify({ error: "checkout upstream unavailable" }), {
      status: 502,
      headers: { "content-type": "application/json" },
    });
  }
}

export async function POST(request) {
  const session = await auth.api.getSession({ headers: request.headers });
  const { userId } = getSessionBasics(session);
  if (!userId) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const body = await readJson(request);
  return forwardToBackend({ userId, body });
}

