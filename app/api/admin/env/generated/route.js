import { proxyAdmin } from "@/app/lib/admin-proxy";

export async function DELETE(request) {
  return proxyAdmin(request, { path: "/env/generated", method: "DELETE", passQuery: true, includeUserId: true });
}
