import { auth } from "@/app/lib/auth";
import { getSessionBasics } from "@/app/lib/session";

// Helper to proxy admin-only requests from Next server routes to the Python backend.
// Performs: session check (isAdmin), resolves base URL + bearer, forwards body/query/headers.
export async function proxyAdmin(
  request,
  {
    path,
    method = "GET",
    passBody = false, // false | true | 'form'
    passQuery = false,
    includeUserId = false,
    cacheNoStore = false,
  } = {}
) {
  const session = await auth.api.getSession({ headers: request.headers });
  const { userId, isAdmin } = getSessionBasics(session);
  if (!isAdmin) return new Response("Forbidden", { status: 403 });

  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  const adminBearer = process.env.ADMIN_BEARER_TOKEN;
  if (!apiBase || !adminBearer) return new Response("Server not configured", { status: 500 });

  const url = new URL(`${apiBase}${path}`);
  if (passQuery) {
    const src = new URL(request.url);
    src.searchParams.forEach((v, k) => url.searchParams.set(k, v));
  }

  const headers = new Headers({ Authorization: `Bearer ${adminBearer}` });
  const contentType = request.headers.get("content-type");
  if (passBody && contentType && passBody !== "form") {
    headers.set("content-type", contentType);
  }
  if (includeUserId) {
    const uid = userId == null ? "" : String(userId);
    if (uid) headers.set("X-User-Id", uid);
  }

  let body = undefined;
  if (passBody === "form") {
    const form = await request.formData();
    body = form;
  } else if (passBody === true) {
    body = request.body;
  }

  const res = await fetch(url, {
    method,
    headers,
    body,
    cache: cacheNoStore ? "no-store" : undefined,
  });
  return new Response(await res.text(), { status: res.status, headers: res.headers });
}
