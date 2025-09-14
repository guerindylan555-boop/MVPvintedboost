import { proxyAdmin } from "@/app/lib/admin-proxy";

export async function GET(request) {
  return proxyAdmin(request, { path: "/env/defaults", method: "GET", cacheNoStore: true });
}

export async function POST(request) {
  return proxyAdmin(request, { path: "/env/defaults", method: "POST", passBody: "form", includeUserId: true });
}

export async function PATCH(request) {
  return proxyAdmin(request, { path: "/env/defaults", method: "PATCH", passBody: "form", includeUserId: true });
}

export async function DELETE(request) {
  return proxyAdmin(request, { path: "/env/defaults", method: "DELETE", passQuery: true, includeUserId: true });
}
