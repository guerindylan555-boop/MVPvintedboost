import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/app/lib/auth";

export default async function StudioLayout({ children }) {
  const h = await headers();
  // Ensure cookies are accessible (helps in some Next envs with Edge/runtime)
  try { await cookies(); } catch {}
  const session = await auth.api.getSession({ headers: h });
  if (!session?.user || session.user.isAdmin !== true) {
    redirect("/login");
  }
  return <>{children}</>;
}
