import { proxyAdmin } from "@/app/lib/admin-proxy";

export async function GET(request) {
  return proxyAdmin(request, {
    path: "/admin/usage/costs",
    cacheNoStore: true,
  });
}

export async function POST(request) {
  return proxyAdmin(request, {
    path: "/admin/usage/costs",
    method: "POST",
    passBody: true,
    cacheNoStore: true,
  });
}
