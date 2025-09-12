import { auth } from "@/app/lib/auth";

export async function POST(request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user || session.user.isAdmin !== true) {
    return new Response("Forbidden", { status: 403 });
  }
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  const adminBearer = process.env.ADMIN_BEARER_TOKEN;
  if (!apiBase || !adminBearer) {
    return new Response("Server not configured", { status: 500 });
  }
  const formData = await request.formData();
  const res = await fetch(`${apiBase}/env/sources/upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminBearer}` },
    body: formData,
  });
  return new Response(await res.text(), { status: res.status, headers: res.headers });
}
