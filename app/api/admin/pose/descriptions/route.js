import { proxyAdmin } from "@/app/lib/admin-proxy";

export async function GET(request) {
  return proxyAdmin(request, { path: "/pose/descriptions", method: "GET", cacheNoStore: true });
}
