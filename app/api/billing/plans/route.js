import { auth } from "@/app/lib/auth";
import { getSessionBasics } from "@/app/lib/session";
import { getApiBase, withUserId } from "@/app/lib/api";

export async function GET(request) {
  const session = await auth.api.getSession({ headers: request.headers });
  const { userId } = getSessionBasics(session);
  const baseUrl = getApiBase();

  const headers = userId ? withUserId({}, userId) : {};
  const res = await fetch(`${baseUrl}/billing/plans`, {
    method: "GET",
    headers,
    cache: "no-store",
  });
  const text = await res.text();
  const responseHeaders = new Headers();
  responseHeaders.set("content-type", res.headers.get("content-type") || "application/json");
  return new Response(text, { status: res.status, headers: responseHeaders });
}
