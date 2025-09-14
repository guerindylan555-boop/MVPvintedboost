import { proxyAdmin } from "@/app/lib/admin-proxy";

export async function POST(request) {
  return proxyAdmin(request, { path: "/pose/describe", method: "POST" });
}
