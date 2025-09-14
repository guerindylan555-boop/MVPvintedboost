import { proxyAdmin } from "@/app/lib/admin-proxy";

export async function GET(request) {
  return proxyAdmin(request, { path: "/model/defaults", method: "GET", cacheNoStore: true });
}

export async function POST(request) {
  return proxyAdmin(request, { path: "/model/defaults", method: "POST", passBody: "form" });
}

export async function PATCH(request) {
  return proxyAdmin(request, { path: "/model/defaults", method: "PATCH", passBody: "form" });
}

export async function DELETE(request) {
  return proxyAdmin(request, { path: "/model/defaults", method: "DELETE", passQuery: true });
}
