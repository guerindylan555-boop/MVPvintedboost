import { auth } from "@/app/lib/auth";

export async function GET(request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.isAdmin) return new Response("Forbidden", { status: 403 });
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  const adminBearer = process.env.ADMIN_BEARER_TOKEN;
  if (!apiBase || !adminBearer) return new Response("Server not configured", { status: 500 });
  const res = await fetch(`${apiBase}/env/defaults`, {
    headers: { Authorization: `Bearer ${adminBearer}` },
    cache: "no-store",
  });
  return new Response(await res.text(), { status: res.status, headers: res.headers });
}

export async function POST(request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.isAdmin) return new Response("Forbidden", { status: 403 });
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  const adminBearer = process.env.ADMIN_BEARER_TOKEN;
  if (!apiBase || !adminBearer) return new Response("Server not configured", { status: 500 });
  const formData = await request.formData();
  const res = await fetch(`${apiBase}/env/defaults`, {
    method: "POST",
    headers: { Authorization: `Bearer ${adminBearer}`, "X-User-Id": String(session.user.id || session.user.email) },
    body: formData,
  });
  return new Response(await res.text(), { status: res.status, headers: res.headers });
}

export async function PATCH(request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.isAdmin) return new Response("Forbidden", { status: 403 });
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  const adminBearer = process.env.ADMIN_BEARER_TOKEN;
  if (!apiBase || !adminBearer) return new Response("Server not configured", { status: 500 });
  const formData = await request.formData();
  const res = await fetch(`${apiBase}/env/defaults`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${adminBearer}`, "X-User-Id": String(session.user.id || session.user.email) },
    body: formData,
  });
  return new Response(await res.text(), { status: res.status, headers: res.headers });
}

export async function DELETE(request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.isAdmin) return new Response("Forbidden", { status: 403 });
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL;
  const adminBearer = process.env.ADMIN_BEARER_TOKEN;
  if (!apiBase || !adminBearer) return new Response("Server not configured", { status: 500 });
  const url = new URL(request.url);
  const qs = url.searchParams.toString();
  const res = await fetch(`${apiBase}/env/defaults${qs ? `?${qs}` : ""}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${adminBearer}`, "X-User-Id": String(session.user.id || session.user.email) },
  });
  return new Response(await res.text(), { status: res.status, headers: res.headers });
}
