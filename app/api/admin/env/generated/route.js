import { auth } from "@/app/lib/auth";

export async function DELETE(request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.isAdmin) return new Response("Forbidden", { status: 403 });
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  const adminBearer = process.env.ADMIN_BEARER_TOKEN;
  if (!apiBase || !adminBearer) return new Response("Server not configured", { status: 500 });
  const url = new URL(request.url);
  const qs = url.searchParams.toString();
  const res = await fetch(`${apiBase}/env/generated${qs ? `?${qs}` : ""}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${adminBearer}` },
  });
  return new Response(await res.text(), { status: res.status, headers: res.headers });
}
