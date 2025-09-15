import { proxyAdmin } from "@/app/lib/admin-proxy";

export async function POST(request) {
  return proxyAdmin(request, { path: "/admin/init-db", method: "POST" });
}

