import { auth } from "@/app/lib/auth";

export async function GET(request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user || session.user.isAdmin !== true) {
    return new Response("Forbidden", { status: 403 });
  }
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  const adminBearer = process.env.ADMIN_BEARER_TOKEN;
  if (!apiBase || !adminBearer) {
    return new Response("Server not configured", { status: 500 });
  }
  const res = await fetch(`${apiBase}/model/defaults`, {
    headers: { Authorization: `Bearer ${adminBearer}` },
    cache: "no-store",
  });
  return new Response(await res.text(), { status: res.status, headers: res.headers });
}
