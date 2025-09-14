import { proxyAdmin } from "@/app/lib/admin-proxy";

export async function GET(request) {
  return proxyAdmin(request, { path: "/env/sources", method: "GET", cacheNoStore: true });
}

export async function DELETE(request) {
  return proxyAdmin(request, { path: "/env/sources", method: "DELETE" });
}
