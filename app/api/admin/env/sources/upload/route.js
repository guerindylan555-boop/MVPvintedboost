import { proxyAdmin } from "@/app/lib/admin-proxy";

export async function POST(request) {
  return proxyAdmin(request, { path: "/env/sources/upload", method: "POST", passBody: "form" });
}
